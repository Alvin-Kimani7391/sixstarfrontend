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

  if (!id) {
    content.innerHTML = `<div class="empty-state"><i class="fa-solid fa-circle-question"></i><h3>No product selected</h3><p><a href="product.html">Browse all products</a></p></div>`;
    return;
  }

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

  /* ---------------- share helpers ---------------- */

  // Canonical, shareable link for THIS product (drops any other query params
  // the page might have picked up, keeps just ?id=).
  function buildShareData(p) {
    const link = `${location.origin}${location.pathname}?id=${p.id}`;
    const price = ssFmtPrice(basePrice(p));
    const message = `Check out this product on Six Star Suppliers\n\n${p.name}\n${price}\n${link}`;
    const images = Array.isArray(p.images) && p.images.length ? p.images : [ssImg(p)];
    return { link, price, message, image: images[0] };
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

    document.title = `${p.name} — Six Star Suppliers`;

    content.innerHTML = `
      <div class="pd-wrap">
        <div>
          <div class="pd-gallery__main"><img id="pdMainImg" src="${images[0]}" alt="${p.name}"></div>
          ${images.length > 1 ? `<div class="pd-gallery__thumbs">
            ${images.map((img, i) => `<img src="${img}" class="${i === 0 ? "active" : ""}" data-i="${i}">`).join("")}
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

          <div class="pd-purchase-panel">
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
              <button class="btn btn-primary" id="addBtn" ${stock.level === "out" ? "disabled" : ""}><i class="fa-solid fa-cart-plus"></i> Add to cart</button>
              <button class="btn btn-dark" id="buyBtn" ${stock.level === "out" ? "disabled" : ""}><i class="fa-solid fa-bolt"></i> Buy now</button>
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
    `;

    bindGallery();
    bindDescriptionToggle();
    bindQty(p, wholesale, moq, stock);
    bindActions(p, wholesale, moq);
    bindReviewForm(p);
    bindShare(p);
    if (wholesale) updateWholesaleLive(p, moq, tiers, heavyWholesale);
    setupVariantPicker(p);
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

  /* ---------------- gallery ---------------- */

  function bindGallery() {
    content.querySelectorAll(".pd-gallery__thumbs img").forEach(img => {
      img.addEventListener("click", () => {
        document.getElementById("pdMainImg").src = img.src;
        content.querySelectorAll(".pd-gallery__thumbs img").forEach(t => t.classList.remove("active"));
        img.classList.add("active");
      });
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
    if (priceEl) priceEl.textContent = ssFmtPrice(basePrice(p) + (variant.priceAdjustment || 0));

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
    const addBtn = document.getElementById("addBtn");
    const buyBtn = document.getElementById("buyBtn");
    if (!addBtn || !buyBtn) return;
    if (!hasVariants) {
      const out = stockState(p).level === "out";
      addBtn.disabled = out;
      buyBtn.disabled = out;
      return;
    }
    const noStock = !selectedVariant || (Number(selectedVariant.stock) || 0) <= 0;
    addBtn.disabled = noStock;
    buyBtn.disabled = noStock;
  }

  /* ---------------- cart actions ---------------- */

  function bindActions(p, wholesale, moq) {
    const addBtn = document.getElementById("addBtn");
    const buyBtn = document.getElementById("buyBtn");
    if (!addBtn || !buyBtn) return;

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
          priceAdjustment: selectedVariant.priceAdjustment || 0
        }
      };
    }

    addBtn.addEventListener("click", () => {
      SS_CART.add(buildPayload(), qty);
      ssToast(`${p.name} added to cart${wholesale ? ` (${qty} units)` : ""}`, "fa-cart-shopping");
    });
    buyBtn.addEventListener("click", () => {
      SS_CART.add(buildPayload(), qty);
      location.href = "cart.html";
    });
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

    return `
      <div class="p-card ${wholesale ? "wholesale" : ""}" data-id="${p.id}">
        
        <div class="p-card__badges">
          ${hasDiscount ? `<div class="p-card__discount">-${p.discountPercent}%</div>` : "<span></span>"}
          ${p.isHotDeal ? `<div class="p-card__hot"><i class="fa-solid fa-fire"></i> Hot</div>` : ""}
        </div>
        <div class="p-card__img">
          <img src="${ssImg(p)}" alt="${p.name}" loading="lazy" onclick="location.href='product-detail.html?id=${p.id}'">
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

  /* ---------------- load ---------------- */

  async function load() {
    try {
      const p = await SS_API.getProduct(id);
      render(p.product || p);
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
          loadReviews();
          loadRelated(found);
          SS_API.trackProductView(id).catch(() => {});
          SS_API.trackProductViewCount(id).catch(() => {});
          return;
        }
        throw new Error("not found");
      } catch (_) {
        content.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><h3>Product not found</h3><p><a href="product.html">Back to all products</a></p></div>`;
      }
    }
  }

  load();
})();