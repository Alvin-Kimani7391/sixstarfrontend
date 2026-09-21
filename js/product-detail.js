/* ============================================================
   PRODUCT DETAIL PAGE
   Renders full retail + wholesale product info: gallery, price
   (with live tiered pricing for wholesalers), accurate stock
   state, MOQ, delivery terms, rating, reviews, product
   specifications (non-variant attributes) as a spec-sheet grid,
   a variant picker (Size/Color etc. from ProductVariant +
   CategoryAttribute defs), a unified purchase "buy box" (qty +
   add to cart / buy now), and a "related products" rail pulled
   from the same category.

   Wholesale delivery now branches on `deliveryType`:
     - 'simple' -> this product ships exactly like a normal retail
       item; standard regional transport fees apply at checkout,
       no MOQ-style delivery math is shown here.
     - 'heavy'  -> the classic wholesale delivery panel (free
       delivery / fixed / per-unit / negotiated) applies as before.

   Also renders a seller info line (name + role chip) and a share
   button (native Web Share API with image-file attachment where
   supported, falling back to a styled share popover with
   WhatsApp / Facebook / X / Telegram / Copy Link).

   GALLERY: the main image area is now a horizontally scrollable
   "track" holding every image, one per slide, with CSS scroll-
   snap. That gives free native swipe on touch devices. Desktop
   gets prev/next arrow buttons layered on top plus a counter
   ("2 / 5"). Thumbnails still work as click-to-jump, and stay in
   sync whether the user swipes, clicks an arrow, or clicks a
   thumb — whichever one moves, the others follow.

   LIGHTBOX: tapping the main image, or the small expand
   icon at its bottom-right, opens a full-screen viewer. It has
   its own scroll-snap track (same technique as the main gallery)
   so multi-image products can be swiped/scrolled through at full
   size, plus arrow buttons, a thumbnail strip, and a counter.
   Closing it syncs the main gallery to whatever image was left
   on screen.

   IMAGE QUALITY: gallery images go through Cloudinary transforms
   (ssCldTransform, from ui.js) instead of rendering the raw
   uploaded URL — the main slides request a large, dpr_auto,
   best-quality asset; thumbnails request a small cropped one;
   the lightbox requests an even larger asset since it fills the
   whole screen.

   SSR: api/product-detail.js server-renders real visible text
   above this content (see #ssrProductIntro in the template) and
   hands the already-fetched product object down via a
   #ssrProductData script tag, so this file can paint instantly
   instead of firing a first request at the Render API. It also
   toggles #pdWrap / #pdNotFound so a genuinely missing product
   actually looks like a 404 before this script even runs.

   ------------------------------------------------------------
   NEW IN THIS VERSION
   1. STICKY BUY BAR (#pdSticky). A floating "Add to cart / Buy
      now" bar that only slides in once the shopper has started
      scrolling AND the real purchase panel (#pdPurchasePanel) is
      off-screen. It slides away again the moment that panel comes
      back into view. It mirrors live state: price (variant/tier
      aware), qty, out-of-stock, and "pick a variant first".
   2. ADD-TO-CART OVERLAY. Adding to cart now fires ssShowCartAdded()
      (ui.js): a top overlay with a draining timer and
      "View cart" / "Continue shopping" — replaces the old
      bottom toast. The clicked buttons also morph to "Added ✓".
   3. WHATSAPP FLOAT. The floating WhatsApp button now opens a chat
      pre-filled with THIS product (name, current price, chosen
      option, qty, link). Built at tap time, so it always reflects
      the variant/qty the shopper has selected right then.
   4. BREADCRUMBS + BACK. A link trail (Home › All products ›
      category path › product) with a Back button. The category
      path is resolved from the category tree so every ancestor is
      a real link.
   ============================================================ */
(function () {
  const id = new URLSearchParams(location.search).get("id");
  const content = document.getElementById("pdContent");
  let qty = 1;
  let product = null;

  // Variant-picker state (only populated when the product's category has
  // variant-defining attributes, e.g. Size/Color).
  let selectedVariant = null;
  let selectedOptions = {};

  // NEW — extra state the sticky bar / WhatsApp message need.
  let variantRequired = false;   // true once we know the shopper MUST pick a variant
  let variantNames = [];         // e.g. ["Size", "Color"] — for "Select Size & Color"
  let cartActions = null;        // { add(), buy(btn) } — shared by main + sticky buttons
  let stickyCleanup = null;      // tears down observers/listeners on re-render

  // Reads the product object api/product-detail.js already fetched
  // server-side (see <!--SSR_PRODUCT_DATA--> in the template) so the page
  // can paint instantly instead of firing a first request at the same API.
  function ssReadSsrProductData() {
    const el = document.getElementById("ssrProductData");
    if (!el || !el.textContent) return null;
    try {
      const data = JSON.parse(el.textContent);
      return data && (data.id || data._id) ? data : null;
    } catch (_) {
      return null;
    }
  }

  function ssShowPdContent() {
    const wrap = document.getElementById("pdWrap");
    const notFound = document.getElementById("pdNotFound");
    if (wrap) wrap.style.display = "";
    if (notFound) notFound.style.display = "none";
  }

  function ssShowPdNotFound() {
    const wrap = document.getElementById("pdWrap");
    const notFound = document.getElementById("pdNotFound");
    if (wrap) wrap.style.display = "none";
    if (notFound) notFound.style.display = "block";
  }

  if (!id) {
    ssShowPdNotFound();
    return;
  }

  // Coming back to this page via the browser's back/forward cache would
  // otherwise leave a "Buy now" button stuck in its loading spinner.
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) document.querySelectorAll(".is-loading").forEach(b => b.classList.remove("is-loading"));
  });

  /* ---------------- helpers ---------------- */

  function starString(rating) {
    const r = Math.round(rating || 0);
    return "★".repeat(r) + "☆".repeat(5 - r);
  }

  function isWholesaler(p) {
    return p.sellerRole === "wholesaler";
  }

  // 'heavy' wholesale products carry their own negotiated/bulky transport terms.
  // 'simple' ones (the default for anything not explicitly flagged heavy) ship
  // just like a normal retail product — standard checkout delivery fee applies.
  function isHeavyWholesale(p) {
    return isWholesaler(p) && p.deliveryType === "heavy";
  }

  function sortedTiers(p) {
    return Array.isArray(p.pricingTiers) ? [...p.pricingTiers].sort((a, b) => a.minQty - b.minQty) : [];
  }

  // Base per-unit price before any wholesale tier is applied (i.e. the
  // "retail-facing" price: displayPrice if discounted, else finalPrice).
  function basePrice(p) {
    return p.displayPrice ?? p.finalPrice ?? 0;
  }

  // The price that actually applies at a given quantity. For a wholesaler
  // with pricing tiers, the highest tier whose minQty <= qty wins; a buyer
  // ordering below every tier threshold just pays the base price.
  function unitPriceAt(p, quantity) {
    const tiers = sortedTiers(p);
    if (!tiers.length) return basePrice(p);
    let applicable = null;
    for (const t of tiers) {
      if (quantity >= t.minQty) applicable = t;
    }
    return applicable ? applicable.price : basePrice(p);
  }

  function deliveryCostAt(p, quantity) {
    if (p.freeDelivery) return { label: "Free delivery", amount: 0, free: true };
    const dc = p.deliveryCharge || {};
    if (dc.chargeType === "quantity_based") {
      const amt = (dc.perUnitAmount || 0) * quantity;
      return { label: `${ssFmtPrice(dc.perUnitAmount || 0)} per unit`, amount: amt, free: false };
    }
    if (dc.chargeType === "negotiated") {
      return { label: dc.notes || "Contact seller for a delivery quote", amount: null, free: false };
    }
    // fixed (default)
    return { label: `Flat rate`, amount: dc.amount || 0, free: false };
  }

  function stockState(p) {
    const stock = Number(p.stock) || 0;
    if (stock <= 0) return { level: "out", label: "Out of stock", stock };
    if (stock <= 10) return { level: "low", label: `Only ${stock} left in stock`, stock };
    return { level: "in", label: "In stock", stock };
  }

  /* ---------------- attribute / spec helpers ---------------- */

  // Product-level attributes (Brand, Material, ...) — variant-defining
  // attributes (Size/Color) never land here; they live on ProductVariant.
  function nonVariantAttributes(p) {
    return Array.isArray(p.attributes) ? p.attributes.filter(a => a.attribute) : [];
  }

  function formatAttrValue(attr, value) {
    if (attr.type === "boolean") return value ? "Yes" : "No";
    if (Array.isArray(value)) return value.join(", ");
    if (value === undefined || value === null || value === "") return "—";
    return `${value}${attr.unit ? " " + attr.unit : ""}`;
  }

  // Renders specs as a clean two-column spec-sheet grid (label stacked
  // above/left of a bold value) rather than a cramped table — this is the
  // block buyers scan to compare products, so every row gets real breathing
  // room and a readable type size.
  function renderSpecsPanel(p) {
    const specs = nonVariantAttributes(p);
    if (!specs.length) return "";
    return `
      <div class="pd-specs">
        <div class="pd-section-label">Specifications</div>
        <div class="pd-specs__grid">
          ${specs.map(a => `
            <div class="pd-specs__item">
              <span class="pd-specs__label">${a.attribute.name}</span>
              <span class="pd-specs__value">${formatAttrValue(a.attribute, a.value)}</span>
            </div>`).join("")}
        </div>
      </div>`;
  }

  /* ---------------- image helpers (Cloudinary) ----------------
     ssCldTransform / ssImgSized live in ui.js, which loads before
     this file. If they're somehow unavailable, fall back to
     returning the URL as-is so the gallery still works, just
     unoptimized. */
  function cld(url, transform) {
    if (typeof ssCldTransform === "function") return ssCldTransform(url, transform);
    return url;
  }

  // Main gallery slides: large, best-quality, auto format (webp/avif
  // where supported), dpr_auto so retina screens get a 2x/3x asset
  // instead of an upscaled 1x one.
  function mainImgUrl(url) {
    return cld(url, "f_auto,q_auto:best,w_1200,dpr_auto");
  }

  // Thumbnails: small, hard-cropped square, lower quality bucket — no
  // reason to ship a full-size image for a ~64px thumb.
  function thumbImgUrl(url) {
    return cld(url, "f_auto,q_auto:good,w_160,h_160,c_fill,dpr_auto");
  }

  // Lightbox slides: larger than the main gallery image so it still looks
  // sharp filling the whole screen on big displays.
  function lightboxImgUrl(url) {
    return cld(url, "f_auto,q_auto:best,w_1800,dpr_auto");
  }

  /* ---------------- share helpers ---------------- */

  // Canonical, shareable link for THIS product (drops any other query params
  // the page might have picked up, keeps just ?id=).
  function buildShareData(p) {
    const refCode = (window.SS_REFERRAL && SS_REFERRAL.getCode()) || "";
    const link = `${location.origin}${location.pathname}?id=${p.id}${refCode ? `&ref=${encodeURIComponent(refCode)}` : ""}`;
    const price = ssFmtPrice(basePrice(p));
    const message = `Check out this product on Six Star Suppliers\n\n${p.name}\n${price}\n${link}`;
    const images = Array.isArray(p.images) && p.images.length ? p.images : [ssImg(p)];
    return { link, price, message, image: mainImgUrl(images[0]) };
  }

  /* ---------------- NEW: small UI micro-interactions ---------------- */

  // Material-style ripple that grows from the exact point of the tap.
  function attachRipple(el) {
    if (!el || el._rippleBound) return;
    el._rippleBound = true;
    el.addEventListener("pointerdown", (e) => {
      if (el.disabled) return;
      const r = el.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 2;
      const dot = document.createElement("span");
      dot.className = "pd-ripple";
      dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px;`;
      el.appendChild(dot);
      dot.addEventListener("animationend", () => dot.remove());
    });
  }

  // Morphs an add-to-cart button into a green "Added ✓" state for a moment,
  // then restores it exactly. Safe to call repeatedly (original label/icon
  // are captured once and reused).
  function flashAdded(btn) {
    if (!btn) return;
    const icon = btn.querySelector("i");
    const label = btn.querySelector(".pd-btn__label");
    if (!icon || !label) return;
    if (!btn.dataset.origLabel) {
      btn.dataset.origLabel = label.textContent;
      btn.dataset.origIcon = icon.className;
    }
    btn.classList.remove("is-added");
    void btn.offsetWidth; // restart the pop animation on rapid re-clicks
    btn.classList.add("is-added");
    icon.className = "fa-solid fa-check";
    label.textContent = "Added";
    clearTimeout(btn._addedT);
    btn._addedT = setTimeout(() => {
      btn.classList.remove("is-added");
      icon.className = btn.dataset.origIcon;
      label.textContent = btn.dataset.origLabel;
    }, 1700);
  }

  /* ---------------- NEW: breadcrumbs + back ---------------- */

  function crumbHref(node) {
    return `/category-explore.html?category=${encodeURIComponent(node._id || node.id)}`;
  }

  // `path` (optional) is the full category ancestor chain resolved from the
  // category tree. First paint uses just the product's own category; once
  // the tree loads we re-render (without replaying the entrance animation)
  // so every ancestor becomes a link too.
  function renderCrumbs(p, path) {
    const nav = document.getElementById("pdCrumbs");
    if (!nav) return;

    const trail = [
      { label: "Home", href: "/index.html", icon: "fa-house" },
      { label: "All products", href: "/product.html" }
    ];

    if (path && path.length) {
      path.forEach(n => trail.push({ label: n.name, href: crumbHref(n) }));
    } else {
      const cat = p.category;
      const catId = cat && typeof cat === "object" ? (cat._id || cat.id) : null;
      if (catId && cat.name) trail.push({ label: cat.name, href: crumbHref({ _id: catId }) });
    }
    trail.push({ label: p.name, current: true });

    // Back goes to the deepest category link if the shopper landed here cold
    // (shared link, search engine…), otherwise it's a real history.back().
    const fallbackHref = trail.length > 3 ? trail[trail.length - 2].href : "/product.html";

    nav.classList.toggle("is-static", !!path);
    nav.innerHTML = `
      <button type="button" class="pd-crumbs__back" id="pdCrumbBack" aria-label="Go back">
        <i class="fa-solid fa-arrow-left"></i><span>Back</span>
      </button>
      <ol class="pd-crumbs__list" id="pdCrumbList" itemscope itemtype="https://schema.org/BreadcrumbList">
        ${trail.map((c, i) => `
          <li class="pd-crumbs__item" style="--i:${i}" itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
            ${c.current
              ? `<span class="pd-crumbs__current" itemprop="name" aria-current="page" title="${ssEscapeHtml(c.label)}">${ssEscapeHtml(c.label)}</span>`
              : `<a class="pd-crumbs__link" href="${c.href}" itemprop="item">${c.icon ? `<i class="fa-solid ${c.icon}"></i>` : ""}<span itemprop="name">${ssEscapeHtml(c.label)}</span></a>`}
            <meta itemprop="position" content="${i + 1}">
            ${i < trail.length - 1 ? `<i class="fa-solid fa-chevron-right pd-crumbs__sep" aria-hidden="true"></i>` : ""}
          </li>`).join("")}
      </ol>`;

    document.getElementById("pdCrumbBack").addEventListener("click", () => {
      let canGoBack = false;
      try {
        canGoBack = history.length > 1 && !!document.referrer && new URL(document.referrer).origin === location.origin;
      } catch (_) {}
      if (canGoBack) history.back();
      else location.href = fallbackHref;
    });

    // On narrow screens a long trail scrolls sideways: start scrolled to the
    // end so the current product is visible, and fade whichever edge has more.
    const list = document.getElementById("pdCrumbList");
    function updateFades() {
      const max = list.scrollWidth - list.clientWidth;
      list.classList.toggle("fade-l", list.scrollLeft > 2);
      list.classList.toggle("fade-r", list.scrollLeft < max - 2);
    }
    list.addEventListener("scroll", updateFades, { passive: true });
    requestAnimationFrame(() => {
      list.scrollLeft = list.scrollWidth;
      updateFades();
    });
  }

  async function loadCrumbTrail(p) {
    const cat = p.category;
    const catId = cat && typeof cat === "object" ? (cat._id || cat.id) : cat;
    if (!catId || typeof ssFindCategoryPath !== "function") return;
    try {
      const data = await SS_API.getCategoryTree();
      const tree = Array.isArray(data) ? data : (data.categories || data.tree || []);
      const path = ssFindCategoryPath(tree, catId);
      if (path && path.length && product && product.id === p.id) renderCrumbs(p, path);
    } catch (_) {
      // keep the simple trail — the page works fine without the full path
    }
  }

  /* ---------------- NEW: WhatsApp message (built at tap time) ---------------- */

  function buildWhatsAppMessage() {
    if (!product) return "Hello, I want to inquire about a product on Six Star Suppliers";
    const p = product;
    const priceEl = document.getElementById("pdPrice");
    const price = (priceEl && priceEl.textContent.trim()) || ssFmtPrice(basePrice(p));
    const link = `${location.origin}${location.pathname}?id=${p.id}`;

    const lines = [
      "Hello Six Star Suppliers 👋",
      "I'd like to ask about this product:",
      "",
      `*${p.name}*`,
      `Price: ${price}`
    ];
    if (selectedVariant && selectedVariant.label) lines.push(`Option: ${selectedVariant.label}`);
    if (selectedVariant && selectedVariant.sku) lines.push(`SKU: ${selectedVariant.sku}`);
    if (qty > 1 || isWholesaler(p)) lines.push(`Quantity: ${qty}`);
    lines.push(`Link: ${link}`, "", "Is it available?");
    return lines.join("\n");
  }

  /* ---------------- main render ---------------- */

  function render(p) {
    product = p;
    window.__ssProductCache[p.id] = p;
    const images = Array.isArray(p.images) && p.images.length ? p.images : [ssImg(p)];

    const wholesale = isWholesaler(p);
    const heavyWholesale = isHeavyWholesale(p);
    const price = basePrice(p);
    const hasDiscount = (p.discountPercent || 0) > 0 && p.finalPrice && price < p.finalPrice;
    const moq = wholesale ? (p.minOrderQuantity || 1) : 1;
    const tiers = wholesale ? sortedTiers(p) : [];
    const stock = stockState(p);

    qty = wholesale ? moq : 1;

    // Reset variant-picker state on every render (fresh product load).
    selectedVariant = null;
    selectedOptions = {};
    variantRequired = false;
    variantNames = [];

    document.title = `${p.name} — Six Star Suppliers`;

    content.innerHTML = `
      <div class="pd-wrap">
        <div>
          <div class="pd-gallery__main">
            <div class="pd-gallery__track" id="pdGalleryTrack">
              ${images.map((img, i) => `
                <div class="pd-gallery__slide" data-i="${i}">
                  <img src="${mainImgUrl(img)}" alt="${p.name}" loading="${i === 0 ? "eager" : "lazy"}">
                </div>`).join("")}
            </div>
            ${images.length > 1 ? `
              <button type="button" class="pd-gallery__nav pd-gallery__nav--prev" id="pdGalleryPrev" aria-label="Previous image"><i class="fa-solid fa-chevron-left"></i></button>
              <button type="button" class="pd-gallery__nav pd-gallery__nav--next" id="pdGalleryNext" aria-label="Next image"><i class="fa-solid fa-chevron-right"></i></button>
              <div class="pd-gallery__counter" id="pdGalleryCounter">1 / ${images.length}</div>
            ` : ""}
            <button type="button" class="pd-gallery__expand" id="pdGalleryExpand" aria-label="View full size" title="View full size">
              <i class="fa-solid fa-expand"></i>
            </button>
          </div>
          ${images.length > 1 ? `<div class="pd-gallery__thumbs">
            ${images.map((img, i) => `<img src="${thumbImgUrl(img)}" data-i="${i}" class="${i === 0 ? "active" : ""}">`).join("")}
          </div>` : ""}
        </div>

        <div>
          <div class="pd-category">${p.category?.name || p.category || "Product"}</div>

          <div class="pd-badge-row">
            ${p.isHotDeal ? `<div class="pd-hotdeal-badge"><i class="fa-solid fa-fire"></i> Hot deal</div>` : ""}
            ${wholesale ? `<div class="pd-wholesale-badge"><i class="fa-solid fa-boxes-stacked"></i> Wholesale</div>` : ""}
          </div>

          <div class="pd-title-row">
            <h1 class="pd-title">${p.name}</h1>
            <button class="pd-share-btn" id="shareBtn" aria-label="Share this product" title="Share this product">
              <i class="fa-solid fa-share-nodes"></i><span>Share</span>
            </button>
          </div>

          <div class="review-stars" id="pdRatingSummary">
            ${p.ratingsCount
              ? `<span class="pd-rating-num">${(p.ratingsAverage || 0).toFixed(1)}</span>${starString(p.ratingsAverage)} <span style="color:var(--ink-soft);font-weight:400;">(${p.ratingsCount} review${p.ratingsCount === 1 ? "" : "s"})</span>`
              : `<span class="form-hint">No reviews yet</span>`}
          </div>

          <div class="pd-price-row">
            <span class="price-tag lg" id="pdPrice">${ssFmtPrice(price)}</span>
            ${hasDiscount ? `<span class="pd-old">${ssFmtPrice(p.finalPrice)}</span><span class="pd-discount-chip">-${p.discountPercent}%</span>` : ""}
          </div>
          ${wholesale ? `<div class="form-hint" style="margin-top:4px;">Unit price shown is for single-unit purchase. Bulk pricing applies below.</div>` : ""}

          <div class="pd-stock-row ${stock.level}">
            <span class="pd-stock-dot ${stock.level}"></span>
            <span>${stock.label}</span>
          </div>

          <div class="pd-description-card">
            <div class="pd-section-label">Product overview</div>
            <p class="pd-desc" id="pdDesc">${p.description || "No description provided for this product yet."}</p>
            <button type="button" class="pd-desc-toggle" id="pdDescToggle">
              <span>Read more</span><i class="fa-solid fa-chevron-down"></i>
            </button>
          </div>

          ${renderSpecsPanel(p)}

          ${wholesale ? renderWholesalePanel(p, moq, tiers, heavyWholesale) : ""}

          <div id="pdVariantPicker"></div>

          <div class="pd-purchase-panel" id="pdPurchasePanel">
            <div class="qty-row">
              <div class="qty-stepper">
                <button id="qtyMinus" aria-label="Decrease quantity">−</button>
                <span id="qtyVal">${qty}</span>
                <button id="qtyPlus" aria-label="Increase quantity">+</button>
              </div>
              <span class="form-hint">${wholesale ? `Minimum order: ${moq} units` : (stock.stock ? stock.stock + " in stock" : "")}</span>
            </div>

            ${wholesale ? `
              <div class="pd-unit-note" id="pdUnitNote"></div>
              <div class="pd-total-line" id="pdTotalLine"></div>
            ` : ""}
            ${stock.level === "out" ? `<div class="pd-stock-warn">This product is currently out of stock.</div>` : ""}
            <div class="pd-stock-warn" id="pdMoqStockWarn" style="display:none;"></div>

            <div class="pd-actions">
              <button class="btn btn-primary" id="addBtn" ${stock.level === "out" ? "disabled" : ""}><i class="fa-solid fa-cart-plus"></i><span class="pd-btn__label">Add to cart</span></button>
              <button class="btn btn-dark" id="buyBtn" ${stock.level === "out" ? "disabled" : ""}><i class="fa-solid fa-bolt"></i><span class="pd-btn__label">Buy now</span></button>
            </div>

            <div class="trust-row">
              <div><i class="fa-solid fa-truck-fast"></i> Countrywide delivery</div>
              <div><i class="fa-solid fa-shield-halved"></i> 1-year warranty</div>
              <div><i class="fa-solid fa-rotate-left"></i> Easy returns</div>
            </div>
          </div>
        </div>
      </div>

      <section class="reviews">
        <div class="sec-head"><h2>Customer reviews</h2></div>
        <div id="reviewsList"><div class="skel skeleton-card" style="height:90px;"></div></div>

        <form class="review-form" id="reviewForm">
          <h3 style="margin-bottom:12px;">Write a review</h3>
          <div class="alert alert-error" id="reviewError"></div>
          <div class="alert alert-success" id="reviewSuccess"></div>
          <div class="form-grid">
            <div class="form-field">
              <label for="revRating">Rating</label>
              <select id="revRating">
                <option value="5">★★★★★ Excellent</option>
                <option value="4">★★★★☆ Good</option>
                <option value="3">★★★☆☆ Okay</option>
                <option value="2">★★☆☆☆ Not great</option>
                <option value="1">★☆☆☆☆ Poor</option>
              </select>
            </div>
            <div class="form-field">
              <label for="revComment">Your review</label>
              <textarea id="revComment" placeholder="Tell other buyers what you liked or didn't..." required></textarea>
            </div>
            <button class="btn btn-dark" type="submit">Submit review</button>
            <p class="form-hint">You need a confirmed order for this product to leave a review.</p>
          </div>
        </form>
      </section>

      <section class="pd-related" id="pdRelated" style="display:none;">
        <div class="sec-head"><h2>You may also like</h2></div>
        <div class="pd-related-grid" id="pdRelatedGrid"></div>
      </section>

      <div class="pd-share-popover" id="sharePopover" hidden>
        <div class="pd-share-popover__backdrop" id="shareBackdrop"></div>
        <div class="pd-share-popover__card">
          <div class="pd-share-popover__head">
            <span>Share this product</span>
            <button id="shareCloseBtn" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div class="pd-share-preview">
            <img id="sharePreviewImg" src="" alt="">
            <div>
              <div class="pd-share-preview__name" id="sharePreviewName"></div>
              <div class="pd-share-preview__price" id="sharePreviewPrice"></div>
            </div>
          </div>
          <div class="pd-share-options">
            <button class="pd-share-opt" data-share="whatsapp"><i class="fa-brands fa-whatsapp"></i><span>WhatsApp</span></button>
            <button class="pd-share-opt" data-share="facebook"><i class="fa-brands fa-facebook"></i><span>Facebook</span></button>
            <button class="pd-share-opt" data-share="twitter"><i class="fa-brands fa-x-twitter"></i><span>X</span></button>
            <button class="pd-share-opt" data-share="telegram"><i class="fa-brands fa-telegram"></i><span>Telegram</span></button>
            <button class="pd-share-opt" data-share="copy"><i class="fa-solid fa-link"></i><span>Copy link</span></button>
          </div>
        </div>
      </div>

      <div class="pd-lightbox" id="pdLightbox" hidden>
        <div class="pd-lightbox__backdrop" id="pdLightboxBackdrop"></div>
        <div class="pd-lightbox__topbar">
          <span class="pd-lightbox__counter" id="pdLightboxCounter">1 / ${images.length}</span>
          <button type="button" class="pd-lightbox__close" id="pdLightboxClose" aria-label="Close full screen view"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="pd-lightbox__track" id="pdLightboxTrack">
          ${images.map((img, i) => `
            <div class="pd-lightbox__slide" data-i="${i}">
              <img src="${lightboxImgUrl(img)}" alt="${p.name}" loading="${i === 0 ? "eager" : "lazy"}">
            </div>`).join("")}
        </div>
        ${images.length > 1 ? `
          <button type="button" class="pd-lightbox__nav pd-lightbox__nav--prev" id="pdLightboxPrev" aria-label="Previous image"><i class="fa-solid fa-chevron-left"></i></button>
          <button type="button" class="pd-lightbox__nav pd-lightbox__nav--next" id="pdLightboxNext" aria-label="Next image"><i class="fa-solid fa-chevron-right"></i></button>
          <div class="pd-lightbox__thumbs" id="pdLightboxThumbs">
            ${images.map((img, i) => `<img src="${thumbImgUrl(img)}" data-i="${i}" class="${i === 0 ? "active" : ""}">`).join("")}
          </div>
        ` : ""}
      </div>
    `;

    renderCrumbs(p);
    loadCrumbTrail(p);

    bindGallery();
    bindLightbox(images);
    bindDescriptionToggle();
    bindQty(p, wholesale, moq, stock);
    bindActions(p, wholesale, moq);
    bindReviewForm(p);
    bindShare(p);
    if (wholesale) updateWholesaleLive(p, moq, tiers, heavyWholesale);
    initStickyBar(p, images);
    setupVariantPicker(p);

    // Point the floating WhatsApp button at THIS product (ui.js).
    if (typeof ssSetWhatsAppProvider === "function") {
      ssSetWhatsAppProvider(buildWhatsAppMessage, { tip: "Ask about this product" });
    }
  }

  function renderWholesalePanel(p, moq, tiers, heavyWholesale) {
    return `
      <div class="pd-wholesale-panel">
        <div class="pd-wholesale-panel__head">
          <h3><i class="fa-solid fa-boxes-stacked"></i> Wholesale terms</h3>
          <span class="pd-moq-chip"><i class="fa-solid fa-box"></i> Min. order: ${moq} units</span>
        </div>
        <div class="pd-wholesale-panel__body">
          ${tiers.length ? `
            <table class="pd-tier-table" id="pdTierTable">
              <thead><tr><th>Order quantity</th><th style="text-align:right;">Price per unit</th></tr></thead>
              <tbody>
                ${tiers.map(t => `
                  <tr data-min="${t.minQty}">
                    <td class="tier-qty">${t.minQty}+ units</td>
                    <td class="tier-price">${ssFmtPrice(t.price)}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          ` : `<p class="form-hint" style="margin-bottom:14px;">This seller doesn't offer extra bulk discounts beyond the listed price — the minimum order quantity still applies.</p>`}

          <div class="pd-delivery-info ${heavyWholesale && p.freeDelivery ? "free" : ""}" id="pdDeliveryInfo">
            <i class="fa-solid fa-truck-fast"></i>
            <div>${deliveryLine(p, moq, heavyWholesale)}</div>
          </div>
        </div>
      </div>
    `;
  }

  function deliveryLine(p, quantity, heavyWholesale) {
    if (!heavyWholesale) {
      return `<strong>Delivery:</strong> Ships like a standard product — regular delivery rates apply at checkout based on your location`;
    }
    if (p.freeDelivery) return `<strong>Free delivery</strong> on this order`;
    const d = deliveryCostAt(p, quantity);
    if (d.amount === null) return `<strong>Delivery:</strong> ${d.label}`;
    return `<strong>Delivery:</strong> ${ssFmtPrice(d.amount)} (${d.label})`;
  }

  function updateWholesaleLive(p, moq, tiers, heavyWholesale) {
    const unit = unitPriceAt(p, qty);
    const total = unit * qty;

    const priceEl = document.getElementById("pdPrice");
    if (priceEl) priceEl.textContent = ssFmtPrice(unit);

    const noteEl = document.getElementById("pdUnitNote");
    if (noteEl) {
      const tierNote = tiers.length ? `at <strong>${ssFmtPrice(unit)}</strong> per unit for ${qty} units` : `<strong>${ssFmtPrice(unit)}</strong> per unit`;
      noteEl.innerHTML = `<i class="fa-solid fa-tags"></i> ${tierNote}`;
    }

    const totalEl = document.getElementById("pdTotalLine");
    if (totalEl) totalEl.innerHTML = `Order total: <span>${ssFmtPrice(total)}</span>`;

    // highlight the active tier row
    document.querySelectorAll("#pdTierTable tr[data-min]").forEach(row => {
      row.classList.toggle("active-tier", qty >= Number(row.dataset.min));
    });

    // delivery updates with quantity for quantity-based charges (heavy only)
    const delInfo = document.getElementById("pdDeliveryInfo");
    if (delInfo) delInfo.innerHTML = `<i class="fa-solid fa-truck-fast"></i><div>${deliveryLine(p, qty, heavyWholesale)}</div>`;

    // warn if stock can't cover the minimum order
    const warn = document.getElementById("pdMoqStockWarn");
    if (warn) {
      const stock = Number(p.stock) || 0;
      if (stock > 0 && stock < moq) {
        warn.style.display = "block";
        warn.textContent = `Only ${stock} units in stock — below this seller's minimum order of ${moq}. Contact the seller before ordering.`;
      } else {
        warn.style.display = "none";
      }
    }
  }

  /* ---------------- gallery ----------------
     The main image is a horizontally-scrolling track (CSS scroll-snap)
     holding every image as its own slide. That alone gives native
     swipe on touch devices — no JS needed for the swipe gesture itself.
     On top of that:
       - prev/next arrow buttons for desktop/mouse users
       - a "2 / 5" counter
       - thumbnails that jump the track to a given slide on click
     All three stay in sync: whichever one moves the gallery (swipe,
     arrow click, or thumb click), the other two update to match. */
  function bindGallery() {
    const track = document.getElementById("pdGalleryTrack");
    if (!track) return;

    const slides = Array.from(track.querySelectorAll(".pd-gallery__slide"));
    const total = slides.length;
    const thumbs = Array.from(content.querySelectorAll(".pd-gallery__thumbs img"));
    const prevBtn = document.getElementById("pdGalleryPrev");
    const nextBtn = document.getElementById("pdGalleryNext");
    const counterEl = document.getElementById("pdGalleryCounter");

    let current = 0;
    let isSyncingFromScroll = false;

    function updateControls() {
      thumbs.forEach(t => t.classList.toggle("active", Number(t.dataset.i) === current));
      if (counterEl) counterEl.textContent = `${current + 1} / ${total}`;
      if (prevBtn) prevBtn.disabled = current === 0;
      if (nextBtn) nextBtn.disabled = current === total - 1;
      track.dataset.current = String(current);
    }

    // Moves to `index` by scrolling the track — used by arrows and thumbs.
    // The track's own scroll listener below keeps `current` in sync when
    // the user swipes directly instead. `smooth=false` does an instant
    // jump — used when syncing back from the lightbox on close.
    function goTo(index, smooth = true) {
      current = Math.max(0, Math.min(total - 1, index));
      isSyncingFromScroll = true;
      track.scrollTo({ left: slides[current].offsetLeft, behavior: smooth ? "smooth" : "auto" });
      updateControls();
      // release the guard once the smooth-scroll settles, so a real user
      // swipe right after isn't ignored
      clearTimeout(track._syncGuard);
      track._syncGuard = setTimeout(() => { isSyncingFromScroll = false; }, 400);
    }
    track._goTo = goTo; // exposed so bindLightbox() can sync the main gallery on close

    prevBtn?.addEventListener("click", () => goTo(current - 1));
    nextBtn?.addEventListener("click", () => goTo(current + 1));

    thumbs.forEach(img => {
      img.addEventListener("click", () => goTo(Number(img.dataset.i)));
    });

    // Swipe / manual scroll support: whenever the track settles after a
    // scroll (debounced), figure out which slide is now most in view and
    // sync the thumbnails/arrows/counter to it.
    let scrollTimer = null;
    track.addEventListener("scroll", () => {
      if (isSyncingFromScroll) return; // this scroll was triggered by goTo(), not a swipe
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        const idx = Math.round(track.scrollLeft / track.clientWidth);
        current = Math.max(0, Math.min(total - 1, idx));
        updateControls();
      }, 90);
    }, { passive: true });

    // Keyboard support when the gallery has focus (left/right arrows).
    track.setAttribute("tabindex", "0");
    track.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") { e.preventDefault(); goTo(current - 1); }
      if (e.key === "ArrowRight") { e.preventDefault(); goTo(current + 1); }
    });

    updateControls();
  }

  /* ---------------- full-screen lightbox ----------------
     Opens when the shopper taps the main image or the small expand
     icon — several product photos are hard to make out at the small
     gallery size, so this gives a real full-screen view. Its own
     horizontally-scrolling track (same scroll-snap technique as the
     main gallery) gives native swipe between every image. Closing it
     syncs the main gallery to whichever image was left on screen. */
  function bindLightbox(images) {
    const lightbox = document.getElementById("pdLightbox");
    const mainTrack = document.getElementById("pdGalleryTrack");
    if (!lightbox || !mainTrack) return;

    const track = document.getElementById("pdLightboxTrack");
    const slides = Array.from(track.querySelectorAll(".pd-lightbox__slide"));
    const total = slides.length;
    const thumbs = Array.from(lightbox.querySelectorAll(".pd-lightbox__thumbs img"));
    const counterEl = document.getElementById("pdLightboxCounter");
    const prevBtn = document.getElementById("pdLightboxPrev");
    const nextBtn = document.getElementById("pdLightboxNext");
    const closeBtn = document.getElementById("pdLightboxClose");
    const backdrop = document.getElementById("pdLightboxBackdrop");
    const expandBtn = document.getElementById("pdGalleryExpand");

    let current = 0;
    let isSyncingFromScroll = false;

    function updateControls() {
      thumbs.forEach(t => t.classList.toggle("active", Number(t.dataset.i) === current));
      if (counterEl) counterEl.textContent = `${current + 1} / ${total}`;
      if (prevBtn) prevBtn.disabled = current === 0;
      if (nextBtn) nextBtn.disabled = current === total - 1;
    }

    function goTo(index, smooth = true) {
      current = Math.max(0, Math.min(total - 1, index));
      isSyncingFromScroll = true;
      track.scrollTo({ left: slides[current].offsetLeft, behavior: smooth ? "smooth" : "auto" });
      updateControls();
      clearTimeout(track._syncGuard);
      track._syncGuard = setTimeout(() => { isSyncingFromScroll = false; }, 400);
    }

    function open(startIndex) {
      lightbox.hidden = false;
      document.body.classList.add("pd-lightbox-open");
      // The track has zero size while [hidden], so jump to the right
      // slide (instantly) only once it's actually laid out, then fade
      // the overlay in.
      requestAnimationFrame(() => {
        goTo(startIndex, false);
        lightbox.classList.add("open");
      });
    }

    function close() {
      lightbox.classList.remove("open");
      document.body.classList.remove("pd-lightbox-open");
      setTimeout(() => { lightbox.hidden = true; }, 220);
      if (typeof mainTrack._goTo === "function") mainTrack._goTo(current, false);
    }

    expandBtn?.addEventListener("click", () => {
      open(Number(mainTrack.dataset.current || 0));
    });

    // Tapping the main product image itself also opens the lightbox —
    // handy on mobile where the expand icon is small.
    mainTrack.querySelectorAll(".pd-gallery__slide").forEach(slide => {
      slide.addEventListener("click", () => open(Number(slide.dataset.i)));
    });

    closeBtn?.addEventListener("click", close);
    backdrop?.addEventListener("click", close);
    prevBtn?.addEventListener("click", () => goTo(current - 1));
    nextBtn?.addEventListener("click", () => goTo(current + 1));
    thumbs.forEach(img => img.addEventListener("click", () => goTo(Number(img.dataset.i))));

    let scrollTimer = null;
    track.addEventListener("scroll", () => {
      if (isSyncingFromScroll) return;
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        const idx = Math.round(track.scrollLeft / track.clientWidth);
        current = Math.max(0, Math.min(total - 1, idx));
        updateControls();
      }, 90);
    }, { passive: true });

    document.addEventListener("keydown", (e) => {
      if (lightbox.hidden) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") goTo(current - 1);
      if (e.key === "ArrowRight") goTo(current + 1);
    });
  }

  /* ---------------- description read-more ---------------- */

  // Only show the toggle when the description actually overflows the
  // 4-line clamp — short descriptions render fully with no dead button.
  function bindDescriptionToggle() {
    const desc = document.getElementById("pdDesc");
    const toggle = document.getElementById("pdDescToggle");
    if (!desc || !toggle) return;

    desc.classList.add("clamped");

    requestAnimationFrame(() => {
      if (desc.scrollHeight > desc.clientHeight + 2) {
        toggle.classList.add("show");
      }
    });

    toggle.addEventListener("click", () => {
      const isOpen = desc.classList.toggle("clamped") === false;
      toggle.classList.toggle("open", isOpen);
      toggle.querySelector("span").textContent = isOpen ? "Show less" : "Read more";
    });
  }

  /* ---------------- quantity ---------------- */

  function bindQty(p, wholesale, moq, stock) {
    const qtyVal = document.getElementById("qtyVal");
    const minusBtn = document.getElementById("qtyMinus");
    const plusBtn = document.getElementById("qtyPlus");
    const floor = wholesale ? moq : 1;

    function refresh() {
      qtyVal.textContent = qty;
      minusBtn.disabled = qty <= floor;
      if (wholesale) updateWholesaleLive(p, moq, sortedTiers(p), isHeavyWholesale(p));
      syncPurchaseUi();
    }

    minusBtn.addEventListener("click", () => {
      qty = Math.max(floor, qty - 1);
      refresh();
    });
    plusBtn.addEventListener("click", () => {
      qty += 1;
      refresh();
    });

    refresh();
  }

  /* ---------------- variant picker (Size / Color etc.) ---------------- */

  // Fetches the category's variant-defining attribute defs so we can label
  // each picker group ("Size", "Color") and unit-suffix the option buttons.
  // Positionally zips defs (sorted by displayOrder) against each variant's
  // `combination` array, which the backend builds in that same order at
  // product-creation/edit time.
  async function setupVariantPicker(p) {
    const mount = document.getElementById("pdVariantPicker");
    if (!mount) return;

    const variants = Array.isArray(p.variants) ? p.variants.filter(v => v.isActive !== false) : [];
    if (!variants.length) {
      mount.innerHTML = "";
      refreshActionState(p, false);
      return;
    }

    const categoryId = p.category?._id || p.category?.id || p.category;
    let defs = [];
    try {
      const res = await SS_API.getCategoryAttributes(categoryId);
      defs = res.attributes || res.data || (Array.isArray(res) ? res : []);
    } catch (_) {
      defs = [];
    }

    const variantDefs = defs
      .filter(d => d.isVariantAttribute)
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));

    if (!variantDefs.length) {
      mount.innerHTML = "";
      refreshActionState(p, false);
      return;
    }

    variantNames = variantDefs.map(d => d.name);

    // Collect the distinct option values available at each position, in
    // first-seen order.
    const optionsByIndex = variantDefs.map(() => []);
    variants.forEach(v => {
      (v.combination || []).forEach((c, i) => {
        if (optionsByIndex[i] && !optionsByIndex[i].includes(c.value)) {
          optionsByIndex[i].push(c.value);
        }
      });
    });

    selectedOptions = {};
    selectedVariant = null;

    function findMatch() {
      if (variantDefs.some((_, i) => !selectedOptions[i])) return null;
      return variants.find(v =>
        (v.combination || []).every((c, i) => c.value === selectedOptions[i])
      ) || null;
    }

    function applySelection() {
      selectedVariant = findMatch();
      renderVariantFeedback(p, selectedVariant, variantDefs.length);
      refreshActionState(p, true);
    }

    mount.innerHTML = variantDefs.map((def, i) => `
      <div class="pd-variant-group">
        <div class="pd-variant-group__label">${def.name}</div>
        <div class="pd-variant-group__opts">
          ${optionsByIndex[i].map(val => `
            <button type="button" class="pd-variant-opt" data-i="${i}" data-val="${val}">${val}${def.unit ? " " + def.unit : ""}</button>
          `).join("")}
        </div>
      </div>`).join("") + `<div class="pd-variant-status" id="pdVariantStatus">Select an option for each attribute above</div>`;

    mount.querySelectorAll(".pd-variant-opt").forEach(btn => {
      btn.addEventListener("click", () => {
        const i = btn.dataset.i;
        selectedOptions[i] = btn.dataset.val;
        mount.querySelectorAll(`.pd-variant-opt[data-i="${i}"]`).forEach(b => b.classList.toggle("active", b === btn));
        applySelection();
      });
    });

    applySelection();
  }

  function renderVariantFeedback(p, variant, totalAttrCount) {
    const statusEl = document.getElementById("pdVariantStatus");
    const priceEl = document.getElementById("pdPrice");
    const chosenCount = Object.keys(selectedOptions).length;

    if (!variant) {
      if (statusEl) {
        statusEl.textContent = chosenCount < totalAttrCount
          ? "Select an option for each attribute above"
          : "This combination is not available";
        statusEl.className = "pd-variant-status" + (chosenCount >= totalAttrCount ? " error" : "");
      }
      if (priceEl) priceEl.textContent = ssFmtPrice(basePrice(p));
      updateStockDisplay(stockState(p));
      return;
    }

    if (statusEl) {
      statusEl.className = "pd-variant-status ok";
      statusEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> Selected: ${variant.label || ""}${variant.sku ? ` (SKU: ${variant.sku})` : ""}`;
    }

    // NEW — a variant flagged useCustomPrice ignores priceAdjustment
    // entirely and uses its own fixed customPrice instead.
    const variantPrice = (variant.useCustomPrice && variant.customPrice != null)
      ? variant.customPrice
      : basePrice(p) + (variant.priceAdjustment || 0);
    if (priceEl) priceEl.textContent = ssFmtPrice(variantPrice);

    updateStockDisplay(stockState({ stock: variant.stock }));
  }

  function updateStockDisplay(stock) {
    const row = document.querySelector(".pd-stock-row");
    const dot = document.querySelector(".pd-stock-dot");
    const label = document.querySelector(".pd-stock-row span:last-child");
    if (!row || !dot || !label) return;
    row.classList.remove("in", "low", "out"); row.classList.add(stock.level);
    dot.classList.remove("in", "low", "out"); dot.classList.add(stock.level);
    label.textContent = stock.label;
  }

  // hasVariants = false -> fall back to the plain product-level stock check
  // (used both when there's no variant scheme, and by the initial static
  // template markup before setupVariantPicker resolves).
  function refreshActionState(p, hasVariants) {
    variantRequired = !!hasVariants;

    const addBtn = document.getElementById("addBtn");
    const buyBtn = document.getElementById("buyBtn");
    if (addBtn && buyBtn) {
      if (!hasVariants) {
        const out = stockState(p).level === "out";
        addBtn.disabled = out;
        buyBtn.disabled = out;
      } else {
        const noStock = !selectedVariant || (Number(selectedVariant.stock) || 0) <= 0;
        addBtn.disabled = noStock;
        buyBtn.disabled = noStock;
      }
    }
    syncPurchaseUi();
  }

  /* ---------------- cart actions ---------------- */

  function bindActions(p, wholesale, moq) {
    const addBtn = document.getElementById("addBtn");
    const buyBtn = document.getElementById("buyBtn");
    if (!addBtn || !buyBtn) return;

    attachRipple(addBtn);
    attachRipple(buyBtn);

    // If a variant is selected, tag it onto the cart payload so downstream
    // cart/checkout code can price and identify it correctly. NOTE: SS_CART
    // and the checkout/order pipeline still need to be updated to actually
    // read/persist `selectedVariant` — this only prepares the payload.
    function buildPayload() {
      if (!selectedVariant) return p;
      return {
        ...p,
        selectedVariant: {
          id: selectedVariant._id,
          label: selectedVariant.label,
          sku: selectedVariant.sku,
          priceAdjustment: selectedVariant.priceAdjustment || 0,
          // NEW — pass the special-price flag/value through to the cart so
          // it's available if/when SS_CART's pricing logic is updated to
          // read it (it currently derives price the same way it always has).
          useCustomPrice: !!selectedVariant.useCustomPrice,
          customPrice: selectedVariant.customPrice ?? null
        }
      };
    }

    // Shared by the main button AND the sticky bar's button.
    function addToCart() {
      SS_CART.add(buildPayload(), qty);

      flashAdded(document.getElementById("addBtn"));
      flashAdded(document.getElementById("stickyAdd"));

      const priceEl = document.getElementById("pdPrice");
      if (typeof ssShowCartAdded === "function") {
        ssShowCartAdded({
          name: p.name,
          image: typeof ssImgSized === "function"
            ? ssImgSized(p, "f_auto,q_auto:good,w_160,h_160,c_fill,dpr_auto")
            : ssImg(p),
          qty,
          priceText: priceEl ? priceEl.textContent.trim() : ssFmtPrice(basePrice(p)),
          variantLabel: selectedVariant ? (selectedVariant.label || "") : ""
        });
      } else {
        ssToast(`${p.name} added to cart${wholesale ? ` (${qty} units)` : ""}`, "fa-cart-shopping");
      }
    }

    function buyNow(btn) {
      if (btn && btn.classList.contains("is-loading")) return; // no double-fire
      // We're about to leave for the cart — don't flash the "Added to cart"
      // overlay (ui.js shows it automatically for every SS_CART.add) just
      // before navigating. Reset in case the navigation is cancelled.
      window.__ssSuppressCartToast = true;
      setTimeout(() => { window.__ssSuppressCartToast = false; }, 3000);
      SS_CART.add(buildPayload(), qty);
      if (btn) btn.classList.add("is-loading");
      location.href = "cart.html";
    }

    cartActions = { add: addToCart, buy: buyNow };

    addBtn.addEventListener("click", () => addToCart());
    buyBtn.addEventListener("click", () => buyNow(buyBtn));
  }

  /* ---------------- NEW: sticky buy bar ----------------
     Shown only when BOTH are true:
       1. the shopper has started scrolling (scrollY > 24), and
       2. the real purchase panel (#pdPurchasePanel) is NOT on screen.
     An IntersectionObserver watches the panel so the bar hides the
     instant the shopper reaches it — no scroll-math, no jank — and
     comes back if they scroll past it again. (Falls back to a
     getBoundingClientRect check where IntersectionObserver is missing.)
     FOOTER: the same observer also watches #site-footer. While the
     footer is on screen the bar hides as the shopper scrolls DOWN and
     reappears as soon as they scroll UP (see initStickyBar).
     Tapping a button while a variant hasn't been chosen scrolls to the
     picker and nudges it instead of failing silently. */

  function actionStatus() {
    if (!product) return { kind: "ok" };
    if (variantRequired) {
      if (!selectedVariant) return { kind: "pick" };
      return (Number(selectedVariant.stock) || 0) <= 0 ? { kind: "out" } : { kind: "ok" };
    }
    return stockState(product).level === "out" ? { kind: "out" } : { kind: "ok" };
  }

  function nudgeVariantPicker() {
    const picker = document.getElementById("pdVariantPicker");
    if (!picker) return;
    picker.scrollIntoView({ behavior: "smooth", block: "center" });
    picker.classList.remove("pd-nudge");
    void picker.offsetWidth;
    picker.classList.add("pd-nudge");
    setTimeout(() => picker.classList.remove("pd-nudge"), 1000);
    ssToast(variantNames.length ? `Please select ${variantNames.join(" & ")} first` : "Please choose an option first", "fa-hand-pointer");
  }

  function onStickyAction(kind, btn) {
    const status = actionStatus();
    if (status.kind === "pick") { nudgeVariantPicker(); return; }
    if (status.kind === "out" || !cartActions) return;
    if (kind === "add") cartActions.add();
    else cartActions.buy(btn);
  }

  // Keeps everything that mirrors purchase state (sticky bar + WhatsApp link)
  // in step with the main panel. Cheap enough to call on every change.
  function syncPurchaseUi() {
    syncStickyBar();
    if (typeof ssRefreshWhatsApp === "function") ssRefreshWhatsApp();
  }

  function syncStickyBar() {
    const bar = document.getElementById("pdSticky");
    if (!bar || !bar.dataset.ready || !product) return;

    // price — re-triggers a small "tick" animation whenever it changes
    const priceEl = document.getElementById("pdPrice");
    const sp = document.getElementById("pdStickyPrice");
    if (priceEl && sp && sp.textContent !== priceEl.textContent) {
      sp.textContent = priceEl.textContent;
      sp.classList.remove("tick");
      void sp.offsetWidth;
      sp.classList.add("tick");
    }

    const status = actionStatus();
    const note = document.getElementById("pdStickyNote");
    let text = "";
    if (status.kind === "pick") text = variantNames.length ? `Select ${variantNames.join(" & ")}` : "Select options";
    else if (status.kind === "out") text = "Out of stock";
    else if (selectedVariant && selectedVariant.label) text = selectedVariant.label;
    else if (isWholesaler(product) || qty > 1) text = `Qty ${qty}`;

    if (note) {
      note.textContent = text;
      note.hidden = !text;
      note.className = "pd-sticky__note" + (status.kind !== "ok" ? ` pd-sticky__note--${status.kind}` : "");
    }

    bar.dataset.state = status.kind;
    const out = status.kind === "out";
    const add = document.getElementById("stickyAdd");
    const buy = document.getElementById("stickyBuy");
    if (add) add.disabled = out;
    if (buy) buy.disabled = out;
  }

  function initStickyBar(p, images) {
    if (stickyCleanup) { stickyCleanup(); stickyCleanup = null; }

    const bar = document.getElementById("pdSticky");
    const panel = document.getElementById("pdPurchasePanel");
    if (!bar || !panel) return;

    const priceEl = document.getElementById("pdPrice");
    const startPrice = priceEl ? priceEl.textContent : ssFmtPrice(basePrice(p));

    bar.innerHTML = `
      <div class="pd-sticky__inner" role="region" aria-label="Quick purchase">
        <span class="pd-sticky__edge" aria-hidden="true"></span>
        <div class="pd-sticky__product">
          <img class="pd-sticky__thumb" src="${thumbImgUrl(images[0])}" alt="" width="46" height="46">
          <div class="pd-sticky__meta">
            <div class="pd-sticky__name">${ssEscapeHtml(p.name)}</div>
            <div class="pd-sticky__priceline">
              <span class="pd-sticky__price" id="pdStickyPrice">${ssEscapeHtml(startPrice)}</span>
              <span class="pd-sticky__note" id="pdStickyNote" hidden></span>
            </div>
          </div>
        </div>
        <div class="pd-sticky__actions">
          <button type="button" class="pd-sticky__btn pd-sticky__btn--add" id="stickyAdd"><i class="fa-solid fa-cart-plus"></i><span class="pd-btn__label">Add to cart</span></button>
          <button type="button" class="pd-sticky__btn pd-sticky__btn--buy" id="stickyBuy"><i class="fa-solid fa-bolt"></i><span class="pd-btn__label">Buy now</span></button>
        </div>
      </div>`;
    bar.dataset.ready = "1";

    const addBtn = document.getElementById("stickyAdd");
    const buyBtn = document.getElementById("stickyBuy");
    attachRipple(addBtn);
    attachRipple(buyBtn);
    addBtn.addEventListener("click", () => onStickyAction("add", addBtn));
    buyBtn.addEventListener("click", () => onStickyAction("buy", buyBtn));

    // Footer zone: once the site footer is on screen the bar stays out of the
    // way while the shopper keeps scrolling DOWN, and slides straight back in
    // the moment they scroll UP. Direction is tracked with a small threshold
    // (and the scroll position is clamped to the page) so a touch jitter or
    // an iOS rubber-band bounce at the very bottom can't make it flicker.
    const footerEl = document.getElementById("site-footer");
    const state = {
      scrolled: window.scrollY > 24,
      panelVisible: false,
      footerVisible: false,
      scrollingUp: false
    };
    let lastY = window.scrollY;

    function apply() {
      const footerHides = state.footerVisible && !state.scrollingUp;
      const show = state.scrolled && !state.panelVisible && !footerHides;
      bar.classList.toggle("is-visible", show);
      bar.toggleAttribute("inert", !show);
      bar.setAttribute("aria-hidden", show ? "false" : "true");
      document.body.classList.toggle("pd-sticky-active", show);
    }

    function rectVisible(el) {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.top < window.innerHeight && r.bottom > 0;
    }

    // One observer watches both the purchase panel and the footer.
    let io = null;
    if ("IntersectionObserver" in window) {
      io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.target === panel) state.panelVisible = entry.isIntersecting;
          else if (entry.target === footerEl) state.footerVisible = entry.isIntersecting;
        });
        apply();
      }, { threshold: 0 });
      io.observe(panel);
      if (footerEl) io.observe(footerEl);
    } else {
      state.panelVisible = rectVisible(panel);
      state.footerVisible = rectVisible(footerEl);
    }

    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;

        const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        const y = Math.max(0, Math.min(window.scrollY, maxY));   // ignore rubber-band overscroll
        const dy = y - lastY;
        if (Math.abs(dy) >= 4) {          // accumulate small moves before deciding a direction
          state.scrollingUp = dy < 0;
          lastY = y;
        }

        state.scrolled = y > 24;
        if (!io) {
          state.panelVisible = rectVisible(panel);
          state.footerVisible = rectVisible(footerEl);
        }
        apply();
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    // Price can change from several places (variant pick, wholesale tier,
    // qty) — watching the element itself keeps the bar honest without
    // wiring every one of them.
    let mo = null;
    if (priceEl && "MutationObserver" in window) {
      mo = new MutationObserver(syncStickyBar);
      mo.observe(priceEl, { childList: true, characterData: true, subtree: true });
    }

    stickyCleanup = () => {
      if (io) io.disconnect();
      if (mo) mo.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      document.body.classList.remove("pd-sticky-active");
    };

    syncStickyBar();
    apply();
  }

  /* ---------------- share ---------------- */

  function bindShare(p) {
    const shareBtn = document.getElementById("shareBtn");
    const popover = document.getElementById("sharePopover");
    if (!shareBtn || !popover) return;

    const backdrop = document.getElementById("shareBackdrop");
    const closeBtn = document.getElementById("shareCloseBtn");
    const { link, price, message, image } = buildShareData(p);

    const previewImg = document.getElementById("sharePreviewImg");
    const previewName = document.getElementById("sharePreviewName");
    const previewPrice = document.getElementById("sharePreviewPrice");
    if (previewImg) previewImg.src = image;
    if (previewName) previewName.textContent = p.name;
    if (previewPrice) previewPrice.textContent = price;

    function openPopover() {
      popover.hidden = false;
      requestAnimationFrame(() => popover.classList.add("open"));
    }
    function closePopover() {
      popover.classList.remove("open");
      setTimeout(() => { popover.hidden = true; }, 220);
    }

    shareBtn.addEventListener("click", async () => {
      if (navigator.share) {
        const shareData = {
          title: `${p.name} — Six Star Suppliers`,
          text: `Check out this product on Six Star Suppliers\n\n${p.name}\n${price}`,
          url: link
        };

        // Best-effort: attach the actual product image as a file. Only
        // supported on some mobile browsers (Web Share API Level 2) — if it
        // fails for any reason we just share text + link instead.
        try {
          const resp = await fetch(image);
          const blob = await resp.blob();
          const file = new File([blob], `product-${p.id}.jpg`, { type: blob.type || "image/jpeg" });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            shareData.files = [file];
          }
        } catch (_) {
          // ignore — falls back to text + link share below
        }

        try {
          await navigator.share(shareData);
          return;
        } catch (err) {
          if (err && err.name === "AbortError") return; // user cancelled, do nothing
          // any other failure -> fall through to the popover
        }
      }
      openPopover();
    });

    closeBtn?.addEventListener("click", closePopover);
    backdrop?.addEventListener("click", closePopover);

    popover.querySelectorAll(".pd-share-opt").forEach(btn => {
      btn.addEventListener("click", () => {
        const kind = btn.dataset.share;
        const encodedText = encodeURIComponent(`Check out this product on Six Star Suppliers\n\n${p.name}\n${price}`);
        const encodedLink = encodeURIComponent(link);
        let url = "";

        switch (kind) {
          case "whatsapp":
            url = `https://wa.me/?text=${encodedText}%0A${encodedLink}`;
            break;
          case "facebook":
            url = `https://www.facebook.com/sharer/sharer.php?u=${encodedLink}`;
            break;
          case "twitter":
            url = `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedLink}`;
            break;
          case "telegram":
            url = `https://t.me/share/url?url=${encodedLink}&text=${encodedText}`;
            break;
          case "copy":
            navigator.clipboard.writeText(message)
              .then(() => {
                ssToast("Product details copied to clipboard", "fa-copy");
                closePopover();
              })
              .catch(() => ssToast("Couldn't copy — please try again", "fa-triangle-exclamation"));
            return;
        }

        window.open(url, "_blank", "noopener,noreferrer");
        closePopover();
      });
    });
  }

  /* ---------------- reviews ---------------- */

  function bindReviewForm(p) {
    const form = document.getElementById("reviewForm");
    if (!form) return;
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const errBox = document.getElementById("reviewError");
      const okBox = document.getElementById("reviewSuccess");
      errBox.classList.remove("show"); okBox.classList.remove("show");
      try {
        await SS_API.postReview(p.id, {
          rating: Number(document.getElementById("revRating").value),
          comment: document.getElementById("revComment").value.trim()
        });
        okBox.textContent = "Thanks! Your review was submitted.";
        okBox.classList.add("show");
        e.target.reset();
        loadReviews();
      } catch (err) {
        errBox.textContent = err.message || "Could not submit your review.";
        errBox.classList.add("show");
      }
    });
  }

  async function loadReviews() {
    const list = document.getElementById("reviewsList");
    if (!list || !product) return;
    try {
      const res = await SS_API.getProductReviews(product.id);
      const reviews = res.reviews || res.data || (Array.isArray(res) ? res : []);
      list.innerHTML = reviews.length
        ? reviews.map(r => `
            <div class="review-card">
              <div class="review-card__head">
                <span>${r.userName || r.name || "Verified buyer"}</span>
                <span class="review-stars">${starString(r.rating)}</span>
              </div>
              <p style="margin-top:8px;color:var(--ink-soft);font-size:.9rem;">${r.comment || ""}</p>
            </div>`).join("")
        : `<p class="form-hint">No reviews yet — be the first to share your experience.</p>`;
    } catch (err) {
      list.innerHTML = `<p class="form-hint">Couldn't load reviews.</p>`;
    }
  }

  /* ---------------- related products (same category) ---------------- */

  function relatedCardHtml(p) {
    const wholesale = isWholesaler(p);
    const price = basePrice(p);
    const hasDiscount = (p.discountPercent || 0) > 0 && p.finalPrice && price < p.finalPrice;
    const cardImg = typeof ssImgSized === "function"
      ? ssImgSized(p, "f_auto,q_auto:good,w_400,h_400,c_fill,dpr_auto")
      : ssImg(p);

    return `
      <div class="p-card ${wholesale ? "wholesale" : ""}" data-id="${p.id}">
        
        <div class="p-card__badges">
          ${hasDiscount ? `<div class="p-card__discount">-${p.discountPercent}%</div>` : "<span></span>"}
          ${p.isHotDeal ? `<div class="p-card__hot"><i class="fa-solid fa-fire"></i> Hot</div>` : ""}
        </div>
        <div class="p-card__img">
          <img src="${cardImg}" alt="${p.name}" loading="lazy" onclick="location.href='product-detail.html?id=${p.id}'">
        </div>
        <div class="p-card__body">
          <div class="p-card__name">${p.name}</div>

          <div class="pd-seller-line">
            <i class="fa-regular fa-store"></i>
            <span class="role-chip">${wholesale ? "Wholesaler" : "Retailer"}</span>
          </div>

          ${wholesale ? `<span class="moq-badge"><i class="fa-solid fa-box"></i> Min: ${p.minOrderQuantity || 1} units</span>` : ""}
          ${p.ratingsCount ? `<div class="p-card__rating"><i class="fa-solid fa-star"></i> ${(p.ratingsAverage || 0).toFixed(1)} <span>(${p.ratingsCount})</span></div>` : ""}
          ${hasDiscount ? `<div class="p-card__old">${ssFmtPrice(p.finalPrice)}</div>` : ""}
          <div class="p-card__foot">
            <span class="price-tag">${ssFmtPrice(price)}</span>
            <button class="p-card__add" title="Add to cart" onclick="event.stopPropagation(); ssQuickAdd('${p.id}')">
              <i class="fa-solid fa-plus"></i>
            </button>
          </div>
        </div>
      </div>`;
  }

  async function loadRelated(p) {
    const section = document.getElementById("pdRelated");
    const grid = document.getElementById("pdRelatedGrid");
    if (!section || !grid) return;

    const categoryId = p.category?._id || p.category?.id || p.category;
    if (!categoryId) return;

    try {
      const res = await SS_API.getProducts({ category: categoryId, limit: 9 });
      const list = res.products || res.data || (Array.isArray(res) ? res : []);
      const related = list.filter(x => String(x.id) !== String(p.id)).slice(0, 8);

      if (!related.length) return; // keep section hidden

      related.forEach(r => { window.__ssProductCache[r.id] = r; });
      grid.innerHTML = related.map(relatedCardHtml).join("");
      section.style.display = "block";
    } catch (_) {
      // silently omit the section if it fails — not critical to the page
    }
  }

  /* ---------------- load ----------------
     Checks for the SSR-fetched product first (dropped in by
     api/product-detail.js via #ssrProductData) so the page paints
     instantly. Falls back to the normal client fetch, then the
     full-list fallback, exactly as before — only the final "couldn't
     find it anywhere" branch now toggles #pdNotFound instead of
     overwriting #pdContent's innerHTML. */

  async function load() {
    const ssrProduct = ssReadSsrProductData();
    if (ssrProduct) {
      render(ssrProduct);
      ssShowPdContent();
      loadReviews();
      loadRelated(ssrProduct);
      SS_API.trackProductView(id).catch(() => {}); // best-effort: adds to buyer's recently-viewed
      SS_API.trackProductViewCount(id).catch(() => {}); // best-effort: feeds seller analytics
      return;
    }

    try {
      const p = await SS_API.getProduct(id);
      render(p.product || p);
      ssShowPdContent();
      loadReviews();
      loadRelated(p.product || p);
      SS_API.trackProductView(id).catch(() => {}); // best-effort: adds to buyer's recently-viewed
      SS_API.trackProductViewCount(id).catch(() => {}); // best-effort: feeds seller analytics
    } catch (_) {
      // fallback: pull from the full list and find it client-side
      try {
        const res = await SS_API.getProducts({ page: 1, limit: 200 });
        const list = res.products || res.data || (Array.isArray(res) ? res : []);
        const found = list.find(x => String(x.id) === String(id));
        if (found) {
          render(found);
          ssShowPdContent();
          loadReviews();
          loadRelated(found);
          SS_API.trackProductView(id).catch(() => {});
          SS_API.trackProductViewCount(id).catch(() => {});
          return;
        }
        throw new Error("not found");
      } catch (_) {
        ssShowPdNotFound();
      }
    }
  }

  load();
})();