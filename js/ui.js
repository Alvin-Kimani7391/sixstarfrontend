/* ============================================================
   UI — header/footer injection + small shared helpers used by
   every page (toast, price formatting, product card markup).
   ============================================================ */

function ssFmtPrice(n) {
  const num = Number(n) || 0;
  return "KSh " + num.toLocaleString("en-KE");
}

function ssImg(product) {
  if (Array.isArray(product.images) && product.images.length) return product.images[0];
  if (product.image) return product.image;
  return "https://placehold.co/400x400/F3F4F8/15161A?text=Six+Star";
}

// Fisher-Yates shuffle — used to randomize ad/category/product order on
// every load without mutating the array that was passed in.
function ssShuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function ssToast(message, icon = "fa-circle-check") {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<i class="fa-solid ${icon}"></i><span>${message}</span>`;
  toast.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove("show"), 2600);
}

// Renders one product card, used everywhere (home rails, product.html
// grid, category.html grid, recently-viewed, etc). Shows every field
// the backend actually sends: price + discount, hot deal, rating,
// stock state, and — when the seller is a wholesaler — the MOQ, bulk
// pricing tiers and free-delivery tag, matching wholesale.html.
function ssProductCard(p) {
  // Backend field names (Product model): finalPrice, discountPercent,
  // displayPrice (virtual = discounted price), isHotDeal, ratingsAverage,
  // ratingsCount, stock, sellerRole, minOrderQuantity, pricingTiers,
  // freeDelivery.

  // Cache every product the moment its card is built so ssQuickAdd()
  // (the + button) works from ANY rail/grid, not just search results.
  window.__ssProductCache = window.__ssProductCache || {};
  if (p && p.id) window.__ssProductCache[p.id] = p;

  const price = p.displayPrice ?? p.finalPrice ?? 0;
  const hasDiscount = (p.discountPercent || 0) > 0 && p.finalPrice && price < p.finalPrice;
  const discount = hasDiscount ? p.discountPercent : 0;

  const wholesale = p.sellerRole === "wholesaler";
  const stock = Number.isFinite(p.stock) ? p.stock : Number(p.stock) || 0;
  const outOfStock = stock <= 0;
  const lowStock = !outOfStock && stock <= 10;

  let wholesaleBlock = "";
  if (wholesale) {
    const moq = p.minOrderQuantity || 1;
    const tiers = Array.isArray(p.pricingTiers) ? [...p.pricingTiers].sort((a, b) => a.minQty - b.minQty) : [];

    let tierDisplay = "";
    if (tiers.length) {
      tierDisplay = tiers.slice(0, 2).map(t =>
        `<span class="bulk-price">${t.minQty}+ ${ssFmtPrice(t.price)}</span>`
      ).join(" ");
      if (tiers.length > 2) tierDisplay += `<span class="tier-more">+${tiers.length - 2} more</span>`;
    }

    wholesaleBlock = `
      <div class="seller-info"><i class="fa-regular fa-store"></i> Wholesale</div>
      <div class="wholesale-details">
        <span class="moq-badge"><i class="fa-solid fa-box"></i> Min: ${moq} units</span>
        ${p.freeDelivery ? `<span class="free-delivery-tag"><i class="fa-solid fa-truck-fast"></i> Free Delivery</span>` : ""}
      </div>
      ${tierDisplay ? `<div class="wholesale-details">${tierDisplay}</div>` : ""}
    `;
  }

  return `
    <div class="p-card ${wholesale ? "wholesale" : ""} ${outOfStock ? "out-of-stock" : ""}" data-id="${p.id}">
      <div class="p-card__badges">
        ${discount ? `<div class="p-card__discount">-${discount}%</div>` : "<span></span>"}
        ${p.isHotDeal ? `<div class="p-card__hot"><i class="fa-solid fa-fire"></i> Hot</div>` : ""}
      </div>
      <div class="p-card__img">
        <img src="${ssImg(p)}" alt="${p.name}" loading="lazy" onclick="location.href='product-detail.html?id=${p.id}'">
        ${outOfStock ? `<div class="p-card__oos-overlay">Out of stock</div>` : ""}
      </div>
      <div class="p-card__body">
        <div class="p-card__name">${p.name}</div>
        ${wholesaleBlock}
        ${p.ratingsCount ? `<div class="p-card__rating"><i class="fa-solid fa-star"></i> ${(p.ratingsAverage || 0).toFixed(1)} <span>(${p.ratingsCount})</span></div>` : ""}
        ${hasDiscount ? `<div class="p-card__old">${ssFmtPrice(p.finalPrice)}</div>` : ""}
        <div class="p-card__foot">
          <span class="price-tag">${ssFmtPrice(price)}</span>
          <button class="p-card__add" title="Add to cart" ${outOfStock ? "disabled" : ""} onclick="event.stopPropagation(); ssQuickAdd('${p.id}')">
            <i class="fa-solid fa-plus"></i>
          </button>
        </div>
        ${lowStock ? `<div class="p-card__stock-note">Only ${stock} left</div>` : ""}
      </div>
    </div>`;
}

// Used by pages that only have the list (no full product object) at hand.
window.__ssProductCache = window.__ssProductCache || {};
function ssQuickAdd(id) {
  const p = window.__ssProductCache[id];
  if (!p) { location.href = `product-detail.html?id=${id}`; return; }
  if ((Number(p.stock) || 0) <= 0) { ssToast("This product is out of stock", "fa-circle-exclamation"); return; }
  const qty = p.sellerRole === "wholesaler" ? (p.minOrderQuantity || 1) : 1;
  SS_CART.add(p, qty);
  ssToast(`${p.name} added to cart${qty > 1 ? ` (${qty} units)` : ""}`, "fa-cart-shopping");
}

function ssSkeletonCards(n = 6) {
  return Array.from({ length: n }).map(() => `<div class="p-card skel skeleton-card"></div>`).join("");
}

/* ---------- header / footer ---------- */
function ssRenderHeader(active = "") {
  const el = document.getElementById("site-header");
  if (!el) return;
  const link = (href, label, icon) =>
    `<a href="${href}" class="${active === href ? "active" : ""}"><i class="fa-solid ${icon}"></i> ${label}</a>`;

  el.innerHTML = `
    <div class="top-bar">
      <div class="top-bar__row">
        <a href="register.html" class="top-bar__sell"><i class="fa-solid fa-store"></i> Sell With Us</a>
        <div class="top-bar__links">
          <a href="track-order.html"><i class="fa-solid fa-truck-fast"></i> Track Order</a>
          <a href="contact.html"><i class="fa-regular fa-circle-question"></i> Help</a>
          <a href="https://wa.me/254794327798" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i> Order on WhatsApp</a>
        </div>
      </div>
    </div>

    <div class="ticker">
      <div class="ticker__track">
        <span><i class="fa-solid fa-fire"></i> New deals dropped daily</span>
        <span><i class="fa-solid fa-truck-fast"></i> Fast delivery countrywide</span>
        <span><i class="fa-solid fa-money-bill-wave"></i> Pay via Paybill or on delivery</span>
        <span><i class="fa-solid fa-shield-halved"></i> 1-year warranty on every order</span>
        <span><i class="fa-brands fa-whatsapp"></i> Order in seconds on WhatsApp</span>
      </div>
    </div>

    <div class="header-row">
      <button class="iconbtn nav-toggle" id="drawerOpenBtn" aria-label="Open menu"><i class="fa-solid fa-bars"></i></button>

      <a href="index.html" class="brand">
        <div class="brand-mark"><img src="images/logo.jpg" alt="Six Star Suppliers logo"></div>
        <div>
          <div class="brand-name"><span class="brand-name__line1">Six Star</span><span class="brand-name__line2">Suppliers</span></div>
          <div class="brand-tag">Quality · Affordable</div>
        </div>
      </a>

      <div class="search-bar">
        <form id="headerSearchForm" role="search">
          <input type="text" id="headerSearchInput" placeholder="Search products, brands and categories..." autocomplete="off">
          <button type="submit" aria-label="Search"><i class="fa-solid fa-magnifying-glass"></i></button>
        </form>
        <div id="headerSuggestions" class="search-suggestions"></div>
      </div>

      <div class="header-actions">
         <a class="action-link" href="profile.html" aria-label="Profile">
          <i class="fa-solid fa-user"></i> Account
        </a>
        <a class="action-link" href="contact.html" aria-label="Help">
          <i class="fa-regular fa-circle-question"></i> Help
        </a>
        <button class="action-link" id="cartBtn" aria-label="Cart">
          <i class="fa-solid fa-cart-shopping"></i> Cart
          <span class="cart-count js-cart-count">0</span>
        </button>
      </div>
    </div>

    <nav class="main-nav">
      ${link("index.html", "Home", "fa-house")}
      ${link("product.html", "All Products", "fa-bag-shopping")}
      ${link("about.html", "About", "fa-circle-info")}
      ${link("track-order.html", "Track Order", "fa-truck-fast")}
      ${link("contact.html", "Contact", "fa-phone")}
    </nav>
  `;

  document.getElementById("cartBtn").addEventListener("click", () => location.href = "cart.html");
  document.getElementById("headerSearchForm").addEventListener("submit", e => {
    e.preventDefault();
    const q = document.getElementById("headerSearchInput").value.trim();
    document.getElementById("headerSuggestions").style.display = "none";
    location.href = `product.html?search=${encodeURIComponent(q)}`;
  });

  ssBindSearchSuggestions(
    document.getElementById("headerSearchInput"),
    document.getElementById("headerSuggestions")
  );

  // mobile drawer
  const overlay = document.createElement("div");
  overlay.className = "drawer-overlay";
  overlay.id = "drawerOverlay";
  const drawer = document.createElement("div");
  drawer.className = "drawer";
  drawer.id = "drawer";
  drawer.innerHTML = `
    <button class="drawer-close" id="drawerCloseBtn" aria-label="Close menu">&times;</button>
    <div class="drawer-links">
      ${link("index.html", "Home", "fa-house")}
      ${link("product.html", "All Products", "fa-bag-shopping")}
      ${link("wholesale.html", "Wholesale", "fa-boxes-stacked")}
      
      ${link("about.html", "About", "fa-circle-info")}
   
      ${link("login.html", "Login", "fa-right-to-bracket")}
      ${link("register.html", "Sell With Us", "fa-store")}
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.appendChild(drawer);

  const open = () => { overlay.classList.add("active"); drawer.classList.add("active"); };
  const close = () => { overlay.classList.remove("active"); drawer.classList.remove("active"); };
  document.getElementById("drawerOpenBtn").addEventListener("click", open);
  
  document.getElementById("drawerCloseBtn").addEventListener("click", close);
  overlay.addEventListener("click", close);

  SS_CART.updateBadge();
}

/* ---------- search suggestions dropdown ----------
   Attaches live search-as-you-type suggestions to any text input.
   Debounces requests, hits the real product search endpoint,
   highlights the matched text, and clicking a result goes straight
   to product-detail.html?id=... Clicking "see all results" goes to
   the full filtered product.html listing.
------------------------------------------------- */
function ssBindSearchSuggestions(inputEl, boxEl) {
  if (!inputEl || !boxEl) return;

  let debounceTimer = null;
  let requestToken = 0; // guards against a slow older request overwriting a newer one

  function escapeHtml(str = "") {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function highlight(text, query) {
    const safe = escapeHtml(text);
    const q = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!q) return safe;
    const re = new RegExp(`(${q})`, "ig");
    return safe.replace(re, "<em>$1</em>");
  }

  function renderResults(products, query, total) {
    if (!products.length) {
      boxEl.innerHTML = `
        <div class="sug-empty">
          <strong>No products found</strong>
          <span>Try a different keyword</span>
        </div>`;
      boxEl.style.display = "block";
      return;
    }

    const items = products.slice(0, 6).map(p => {
      const price = p.displayPrice ?? p.finalPrice ?? 0;
      const hasDiscount = (p.discountPercent || 0) > 0 && p.finalPrice && price < p.finalPrice;
      const badge = hasDiscount
        ? `<span class="sug-badge sug-badge--discount">-${p.discountPercent}%</span>`
        : p.isHotDeal
        ? `<span class="sug-badge sug-badge--hot"><i class="fa-solid fa-fire"></i> Hot</span>`
        : "";
      const wholesaleChip = p.sellerRole === "wholesaler"
        ? `<span class="sug-badge sug-badge--wholesale">Wholesale · Min ${p.minOrderQuantity || 1}</span>`
        : "";
      return `
        <div class="sug-item" data-id="${p.id}">
          <img class="sug-thumb" src="${ssImg(p)}" alt="" loading="lazy" onerror="this.style.opacity='0'">
          <div class="sug-info">
            <p class="sug-name">${highlight(p.name, query)}</p>
            <div class="sug-meta">
              <span class="sug-price">${ssFmtPrice(price)}</span>
              ${badge}
              ${wholesaleChip}
            </div>
          </div>
          <i class="fa-solid fa-chevron-right sug-chevron"></i>
        </div>`;
    }).join("");

    boxEl.innerHTML = `
      <div class="sug-header-bar">
        <span>${total} result${total === 1 ? "" : "s"}</span>
        <button type="button" id="sugClearBtn">Clear</button>
      </div>
      ${items}
      <div class="sug-footer-row" id="sugSeeAll">
        <i class="fa-solid fa-magnifying-glass"></i>
        <span>See all results for "<b>${escapeHtml(query)}</b>"</span>
      </div>`;
    boxEl.style.display = "block";

    boxEl.querySelectorAll(".sug-item").forEach(item => {
      item.addEventListener("click", () => {
        location.href = `product-detail.html?id=${item.dataset.id}`;
      });
    });

    document.getElementById("sugSeeAll").addEventListener("click", () => {
      location.href = `product.html?search=${encodeURIComponent(query)}`;
    });

    document.getElementById("sugClearBtn").addEventListener("click", () => {
      inputEl.value = "";
      boxEl.style.display = "none";
      inputEl.focus();
    });
  }

  async function runSearch(query) {
    const token = ++requestToken;
    try {
      const res = await SS_API.getProducts({ search: query, limit: 8 });
      if (token !== requestToken) return; // a newer keystroke already superseded this
      const products = res.products || res.data || (Array.isArray(res) ? res : []);
      const total = res.total ?? res.count ?? products.length;
      products.forEach(p => { window.__ssProductCache[p.id] = p; });
      renderResults(products, query, total);
    } catch (_) {
      if (token !== requestToken) return;
      boxEl.innerHTML = `<div class="sug-empty"><strong>Couldn't search right now</strong><span>Check your connection</span></div>`;
      boxEl.style.display = "block";
    }
  }

  inputEl.addEventListener("input", () => {
    const q = inputEl.value.trim();
    clearTimeout(debounceTimer);
    if (!q) { boxEl.style.display = "none"; return; }
    debounceTimer = setTimeout(() => runSearch(q), 250);
  });

  inputEl.addEventListener("focus", () => {
    const q = inputEl.value.trim();
    if (q) runSearch(q);
  });

  document.addEventListener("click", (e) => {
    if (!boxEl.contains(e.target) && e.target !== inputEl) {
      boxEl.style.display = "none";
    }
  });

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") boxEl.style.display = "none";
  });
}

function ssRenderFooter() {
  const el = document.getElementById("site-footer");
  if (!el) return;
  const c = window.SS_CONFIG;
  el.innerHTML = `
    <div class="footer-grid">
      <div>
        <h4>Customer Service</h4>
        <a href="contact.html">Contact Us / Visit Us</a>
        <a href="about.html">FAQs</a>
        <a href="track-order.html">Track My Order</a>
      </div>
      <div>
        <h4>About Us</h4>
        <a href="about.html">Our Story</a>
        <a href="contact.html">Our Depot</a>
        <a href="product.html">Our Products</a>
      </div>
      <div>
        <h4>Sell With Us</h4>
        <a href="register.html">Become a Retailer</a>
        <a href="register.html">Become a Wholesaler</a>
        <a href="login.html">Seller Login</a>
      </div>
      <div>
        <h4>Get in Touch</h4>
        <a><i class="fa-solid fa-phone"></i> ${c.PHONE_1}</a>
        <a>${c.PHONE_2}</a>
        <a href="mailto:${c.EMAIL}"><i class="fa-regular fa-envelope"></i> ${c.EMAIL}</a>
        <div class="footer-social">
          <a href="${c.SOCIALS.facebook}" target="_blank" rel="noopener"><i class="fa-brands fa-facebook-f"></i></a>
          <a href="https://wa.me/${c.WHATSAPP_NUMBER}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i></a>
          <a href="${c.SOCIALS.tiktok}" target="_blank" rel="noopener"><i class="fa-brands fa-tiktok"></i></a>
          <a href="${c.SOCIALS.instagram}" target="_blank" rel="noopener"><i class="fa-brands fa-instagram"></i></a>
          <a href="${c.SOCIALS.x}" target="_blank" rel="noopener"><i class="fa-brands fa-square-x-twitter"></i></a>
        </div>
      </div>
    </div>
    <div class="footer-bottom">&copy; <span id="ssYear"></span> Six Star Suppliers. All rights reserved.</div>
  `;
  document.getElementById("ssYear").textContent = new Date().getFullYear();
}

function ssRenderWhatsApp() {
  const el = document.getElementById("wa-float");
  if (!el) return;
  el.href = `https://wa.me/${window.SS_CONFIG.WHATSAPP_NUMBER}?text=${encodeURIComponent("Hello, I want to inquire about")}`;
  el.target = "_blank";
  el.innerHTML = `<i class="fa-brands fa-whatsapp"></i>`;
}

function ssHideLoader() {
  const l = document.getElementById("pageLoader");
  if (l) setTimeout(() => l.classList.add("hide"), 150);
}

/* ---------- categories (used on homepage grid + listing filter) ---------- */
async function ssLoadCategories() {
  try {
    const data = await SS_API.getCategories();
    const list = Array.isArray(data) ? data : (data.categories || []);
    if (list.length) return list;
  } catch (_) { /* fall through to fallback */ }
  return window.SS_CONFIG.FALLBACK_CATEGORIES;
}

// Renders the "Shop by category" tile grid in a fresh random order
// every time the page loads. Pass `limit` to cap how many show.
function ssRenderCategoryGrid(targetId, limit = null) {
  const el = document.getElementById(targetId);
  if (!el) return;
  ssLoadCategories().then(cats => {
    let list = ssShuffle(cats);
    if (limit) list = list.slice(0, limit);
    el.innerHTML = list.map(c => `
      <a class="cat-item" href="category.html?slug=${encodeURIComponent(c.slug)}">
        <div class="cat-thumb"><img src="${c.image || 'https://placehold.co/300/F3F4F8/15161A?text=' + encodeURIComponent(c.name)}" alt="${c.name}"></div>
        <span>${c.name}</span>
      </a>`).join("");
  });
}

/* ---------- Jumia-style category sidebar with hover flyout ---------- */
async function ssRenderMegaMenu(targetId) {
  const el = document.getElementById(targetId);
  if (!el) return;

  let tree = [];
  try {
    const data = await SS_API.getCategoryTree();
    tree = Array.isArray(data) ? data : (data.categories || data.tree || []);
  } catch (_) {
    el.style.display = "none";
    return;
  }

  if (!tree.length) {
    el.style.display = "none";
    return;
  }

  const catLink = (cat) => `product.html?category=${encodeURIComponent(cat._id || cat.id)}`;

  el.innerHTML = `
    <div class="mega-menu__sidebar">
      ${tree.map((cat, i) => `
        <a class="mega-menu__item ${i === 0 ? "active" : ""}"
           href="${catLink(cat)}"
           data-index="${i}">
          <span>${cat.name}</span>
          <i class="fa-solid fa-chevron-right"></i>
        </a>
      `).join("")}
    </div>
    <div class="mega-menu__panel">
      ${tree.map((cat, i) => `
        <div class="mega-menu__panel-content ${i === 0 ? "active" : ""}" data-panel="${i}">
          ${renderMegaColumns(cat)}
        </div>
      `).join("")}
    </div>
  `;

  function renderMegaColumns(cat) {
    const children = cat.children || [];
    if (!children.length) {
      return `<div class="mega-menu__empty">
        <a href="${catLink(cat)}" class="btn btn-outline btn-sm">
          Browse all ${cat.name}
        </a>
      </div>`;
    }
    return `<div class="mega-menu__cols">
      ${children.map(sub => `
        <div class="mega-menu__col">
          <a class="mega-menu__col-head" href="${catLink(sub)}">${sub.name}</a>
          ${(sub.children || []).length ? `<ul>
            ${sub.children.map(leaf => `
              <li><a href="${catLink(leaf)}">${leaf.name}</a></li>
            `).join("")}
          </ul>` : ""}
        </div>
      `).join("")}
    </div>`;
  }

  const items = el.querySelectorAll(".mega-menu__item");
  const panels = el.querySelectorAll(".mega-menu__panel-content");

  function activate(index) {
    items.forEach(it => it.classList.toggle("active", it.dataset.index === String(index)));
    panels.forEach(p => p.classList.toggle("active", p.dataset.panel === String(index)));
  }

  items.forEach(item => {
    item.addEventListener("mouseenter", () => activate(item.dataset.index));
    item.addEventListener("focus", () => activate(item.dataset.index));
  });
}

/* ---------- generic rotating ad slot ----------
   Fetches ALL active ads for a placement and renders them as a
   rotating carousel: fade transition, prev/next arrows, dots,
   click tracking, pause-on-hover, and swipe on mobile. Ad order
   is shuffled on every load so the first slide isn't always the
   same ad.
   Usage: ssRenderAdSlot("heroAd", "homepage_hero", { interval: 5000, aspect: "21/9" });
------------------------------------------------- */
async function ssRenderAdSlot(targetId, placement, opts = {}) {
  const el = document.getElementById(targetId);
  if (!el) return;

  const interval = opts.interval || 5000;
  const aspect = opts.aspect || null;

  let ads = [];
  try {
    const data = await SS_API.getAds(placement);
    ads = Array.isArray(data) ? data : (data.ads || []);
  } catch (_) {
    el.style.display = "none";
    return;
  }

  if (!ads.length) {
    el.style.display = "none";
    return;
  }

  ads = ssShuffle(ads);

  el.style.display = "block";
  el.classList.add("ad-slot");
  if (aspect) el.style.setProperty("--ad-aspect", aspect);

  const multi = ads.length > 1;

  el.innerHTML = `
    <div class="ad-slot__track">
      ${ads.map((ad, i) => `
        <a class="ad-slide ${i === 0 ? "active" : ""}"
           href="javascript:void(0)"
           data-ad-id="${ad._id}"
           data-link="${ad.linkUrl || ""}">
          <img src="${ad.image}" alt="${ad.title || "Promotion"}" loading="lazy">
        </a>
      `).join("")}
    </div>
    ${multi ? `
      <button class="ad-nav ad-nav--prev" aria-label="Previous ad" type="button"><i class="fa-solid fa-chevron-left"></i></button>
      <button class="ad-nav ad-nav--next" aria-label="Next ad" type="button"><i class="fa-solid fa-chevron-right"></i></button>
      <div class="ad-slot__dots">
        ${ads.map((_, i) => `<span class="ad-dot ${i === 0 ? "active" : ""}" data-go="${i}"></span>`).join("")}
      </div>
    ` : ""}
  `;

  const slides = el.querySelectorAll(".ad-slide");
  const dots = el.querySelectorAll(".ad-dot");
  let current = 0;
  let timer = null;

  function goTo(index) {
    slides[current].classList.remove("active");
    if (dots[current]) dots[current].classList.remove("active");
    current = (index + slides.length) % slides.length;
    slides[current].classList.add("active");
    if (dots[current]) dots[current].classList.add("active");
  }

  function next() { goTo(current + 1); }
  function prev() { goTo(current - 1); }

  function startAutoRotate() {
    if (slides.length <= 1) return;
    stopAutoRotate();
    timer = setInterval(next, interval);
  }
  function stopAutoRotate() {
    if (timer) clearInterval(timer);
  }

  slides.forEach((slide) => {
    slide.addEventListener("click", () => {
      const adId = slide.dataset.adId;
      const link = slide.dataset.link;
      SS_API.trackAdClick(adId).catch(() => {});
      if (link) window.open(link, link.startsWith("http") ? "_blank" : "_self");
    });
  });

  dots.forEach((dot) => {
    dot.addEventListener("click", () => { goTo(Number(dot.dataset.go)); startAutoRotate(); });
  });

  const prevBtn = el.querySelector(".ad-nav--prev");
  const nextBtn = el.querySelector(".ad-nav--next");
  if (prevBtn) prevBtn.addEventListener("click", (e) => { e.stopPropagation(); prev(); startAutoRotate(); });
  if (nextBtn) nextBtn.addEventListener("click", (e) => { e.stopPropagation(); next(); startAutoRotate(); });

  el.addEventListener("mouseenter", stopAutoRotate);
  el.addEventListener("mouseleave", startAutoRotate);

  let touchStartX = 0;
  el.addEventListener("touchstart", (e) => { touchStartX = e.touches[0].clientX; stopAutoRotate(); }, { passive: true });
  el.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) { dx < 0 ? next() : prev(); }
    startAutoRotate();
  }, { passive: true });

  startAutoRotate();
}






/* ---------- flash-sale style countdown timer ----------
   Counts down to the next midnight and loops daily. Purely a
   visual urgency cue for the Hot Deals rail — no backend timestamp
   required. Usage: ssRenderCountdown("hotDealsTimer");
------------------------------------------------- */
function ssRenderCountdown(targetId) {
  const el = document.getElementById(targetId);
  if (!el) return;

  function tick() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    let diff = Math.max(0, midnight - now);

    const h = String(Math.floor(diff / 3600000)).padStart(2, "0");
    const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, "0");
    const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, "0");

    el.innerHTML = `<i class="fa-regular fa-clock"></i> ${h}h : ${m}m : ${s}s`;
  }

  tick();
  setInterval(tick, 1000);
}

document.addEventListener("DOMContentLoaded", () => {
  ssRenderHeader(document.body.dataset.page || "");
  ssRenderFooter();
  ssRenderWhatsApp();
  ssHideLoader();
});


