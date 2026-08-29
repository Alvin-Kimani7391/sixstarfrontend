/* ============================================================
   UI — header/footer injection + small shared helpers used by
   every page (toast, price formatting, product card markup).
   All internal links/assets are root-relative (leading "/") so
   this works correctly no matter what URL depth the page is
   served at (e.g. /shop/miamii-bags as well as /shops.html).
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

/* ---------- image optimization (Cloudinary) ----------
   Every image on the site was being rendered at whatever raw
   resolution/format it was uploaded at, with no resizing and no
   DPR handling — the #1 cause of images looking soft compared to
   platforms like Jumia, which always request a size-appropriate,
   retina-aware asset per slot.

   ssCldTransform() inserts a Cloudinary transformation string right
   after `/upload/` in a delivery URL. It's a no-op for anything that
   isn't a Cloudinary URL (e.g. the placehold.co fallback), so it's
   always safe to wrap around ssImg()'s result without checking the
   source first.

   ssImgSized() is a convenience wrapper for the common "product
   card" case. Callers needing a different size/crop (banners,
   small thumbnails, the product-detail gallery) should build their
   own transform string and call ssCldTransform() directly.
------------------------------------------------- */
function ssCldTransform(url, transform) {
  if (typeof url !== "string" || !url.includes("/upload/")) return url;
  return url.replace("/upload/", `/upload/${transform}/`);
}

function ssImgSized(product, transform = "f_auto,q_auto:good,w_500,c_limit,dpr_auto") {
  return ssCldTransform(ssImg(product), transform);
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

// Small reusable HTML-escape helper (kept top-level so both the search
// suggestions box, the drawer user card, and the drawer category
// accordion can use it safely).
function ssEscapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* ---------- auth state helpers ----------
   auth.js is cookie-based: the backend sets an httpOnly cookie on
   login/register, and SS_AUTH just keeps a non-authoritative copy of
   the user object in localStorage under "ss_user" for UI purposes.
   There is no token to check — SS_AUTH.get() returning a user IS the
   "logged in" signal. We call straight into the real SS_AUTH module
   (get/clear), with a same-key localStorage fallback only in case
   ui.js ever loads on a page before auth.js has run.
------------------------------------------------- */
function ssAuthState() {
  if (window.SS_AUTH && typeof window.SS_AUTH.get === "function") {
    const user = window.SS_AUTH.get();
    return { loggedIn: !!user, user };
  }

  let user = null;
  const rawUser = localStorage.getItem("ss_user");
  if (rawUser) {
    try { user = JSON.parse(rawUser); } catch (_) { user = null; }
  }

  return { loggedIn: !!user, user };
}

function ssLogout() {
  if (window.SS_AUTH && typeof window.SS_AUTH.clear === "function") {
    window.SS_AUTH.clear();
  } else {
    localStorage.removeItem("ss_user");
  }
  // If you add a backend logout route later (to also clear the httpOnly
  // cookie), call it here too, e.g.: SS_API.logout().catch(() => {});
  ssToast("You've been logged out", "fa-circle-check");
  setTimeout(() => { location.href = "/index.html"; }, 500);
}

// Renders one product card, used everywhere (home rails, product.html
// grid, category.html grid, recently-viewed, etc). Shows every field
// the backend actually sends: price + discount, hot deal, rating, and
// a role tag (Retail / Wholesale) so buyers instantly know what
// they're looking at. Wholesale gets its MOQ / bulk pricing / free
// delivery details; retail gets a matching "Single unit" badge in the
// same style, just orange instead of violet.
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

  let sellerBlock = "";
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

    sellerBlock = `
      <div class="seller-info seller-info--wholesale"><i class="fa-solid fa-boxes-stacked"></i> Wholesale seller</div>
      <div class="wholesale-details">
        <span class="moq-badge moq-badge--wholesale"><i class="fa-solid fa-box"></i> Min: ${moq} units</span>
        ${p.freeDelivery ? `<span class="free-delivery-tag"><i class="fa-solid fa-truck-fast"></i> Free Delivery</span>` : ""}
      </div>
      ${tierDisplay ? `<div class="wholesale-details">${tierDisplay}</div>` : ""}
    `;
  } else {
    sellerBlock = `
      <div class="seller-info seller-info--retail"><i class="fa-solid fa-store"></i> Retail seller</div>
      <div class="wholesale-details">
        <span class="moq-badge moq-badge--retail"><i class="fa-solid fa-box"></i> Single unit</span>
      </div>
    `;
  }

  return `
    <div class="p-card ${wholesale ? "wholesale" : "retail"} ${outOfStock ? "out-of-stock" : ""}" data-id="${p.id}">
      <div class="p-card__badges">
        ${discount ? `<div class="p-card__discount">-${discount}%</div>` : "<span></span>"}
        ${p.isHotDeal ? `<div class="p-card__hot"><i class="fa-solid fa-fire"></i> Hot</div>` : ""}
      </div>
      <div class="p-card__img">
        <img src="${ssImgSized(p)}" alt="${p.name}" loading="lazy" onclick="location.href='/product-detail.html?id=${p.id}'">
        ${outOfStock ? `<div class="p-card__oos-overlay">Out of stock</div>` : ""}
      </div>
      <div class="p-card__body">
        <div class="p-card__name">${p.name}</div>
        ${sellerBlock}
        ${p.ratingsCount ? `<div class="p-card__rating"><i class="fa-solid fa-star"></i> ${(p.ratingsAverage || 0).toFixed(1)} <span>(${p.ratingsCount})</span></div>` : ""}
        ${hasDiscount ? `<div class="p-card__old">${ssFmtPrice(p.finalPrice)}</div>` : ""}
        <div class="p-card__foot">
          <span class="price-tag">${ssFmtPrice(price)}</span>
          <button class="p-card__add" title="Add to cart" ${outOfStock ? "disabled" : ""} onclick="event.stopPropagation(); ssQuickAdd('${p.id}')">
            <i class="fa-solid fa-plus"></i>
          </button>
        </div>
      </div>
    </div>`;
}



// Used by pages that only have the list (no full product object) at hand.
window.__ssProductCache = window.__ssProductCache || {};
function ssQuickAdd(id) {
  const p = window.__ssProductCache[id];
  if (!p) { location.href = `/product-detail.html?id=${id}`; return; }
  if ((Number(p.stock) || 0) <= 0) { ssToast("This product is out of stock", "fa-circle-exclamation"); return; }
  const qty = p.sellerRole === "wholesaler" ? (p.minOrderQuantity || 1) : 1;
  SS_CART.add(p, qty);
  ssToast(`${p.name} added to cart${qty > 1 ? ` (${qty} units)` : ""}`, "fa-cart-shopping");
}

//skeleton cards for loading state
function ssSkeletonCards(n = 6) {
  const card = `
    <div class="p-card skel-card" aria-hidden="true">
      <div class="skel-card__img skel-shimmer"></div>
      <div class="skel-card__body">
        <div class="skel-line skel-shimmer" style="width:92%"></div>
        <div class="skel-line skel-shimmer" style="width:60%"></div>
        <div class="skel-pill skel-shimmer"></div>
        <div class="skel-card__foot">
          <div class="skel-price skel-shimmer"></div>
          <div class="skel-btn skel-shimmer"></div>
        </div>
      </div>
    </div>`;
  return Array.from({ length: n }).map(() => card).join("");
}



/* ---------- header / footer ---------- */
function ssRenderHeader(active = "") {
  const el = document.getElementById("site-header");
  if (!el) return;
  const link = (href, label, icon) =>
    `<a href="${href}" class="${active === href ? "active" : ""}"><i class="fa-solid ${icon}"></i> ${label}</a>`;

  const auth = ssAuthState();

  el.innerHTML = `
    <div class="top-bar">
      <div class="top-bar__row">
        <a href="/register.html" class="top-bar__sell"><i class="fa-solid fa-store"></i> Sell With Us</a>
        <div class="top-bar__links">
          <a href="/track-order.html"><i class="fa-solid fa-truck-fast"></i> Track Order</a>
          <a href="/contact.html"><i class="fa-regular fa-circle-question"></i> Help</a>
          <a href="https://wa.me/254794327798" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i> Order on WhatsApp</a>
        </div>
      </div>
    </div>

    <div class="ticker">
      <div class="ticker__track">
        <span><i class="fa-solid fa-fire"></i> New deals dropped daily</span>
        <span><i class="fa-solid fa-handshake"></i> Sell with us</span>
        <span><i class="fa-solid fa-shop"></i> Own a shop at Six Star Suppliers</span>
        <span><i class="fa-solid fa-truck-fast"></i> Fast delivery countrywide</span>
        <span><i class="fa-solid fa-money-bill-wave"></i> Pay via Paybill or on delivery</span>
        <span><i class="fa-solid fa-shield-halved"></i> 1-year warranty on every order</span>
        <span><i class="fa-brands fa-whatsapp"></i> Order in seconds on WhatsApp</span>

      </div>
    </div>

    <div class="header-row">
      <button class="iconbtn nav-toggle hamburger-btn" id="drawerOpenBtn" aria-label="Open menu" aria-expanded="false">
        <span class="hamburger-icon"><span></span><span></span><span></span></span>
      </button>

      <a href="/index.html" class="brand">
        <div class="brand-mark"><img src="/images/logo.jpg" alt="Six Star Suppliers logo"></div>
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
         <a class="action-link" href="/profile.html" aria-label="Profile">
          <i class="fa-solid fa-user"></i> Account
        </a>
        <a class="action-link" href="/contact.html" aria-label="Help">
          <i class="fa-regular fa-circle-question"></i> Help
        </a>
        <button class="action-link" id="cartBtn" aria-label="Cart">
          <i class="fa-solid fa-cart-shopping"></i> Cart
          <span class="cart-count js-cart-count">0</span>
        </button>
      </div>
    </div>

    <nav class="main-nav">
      ${link("/index.html", "Home", "fa-house")}
      ${link("/product.html", "All Products", "fa-bag-shopping")}
      ${link("/about.html", "About", "fa-circle-info")}
      ${link("/track-order.html", "Track Order", "fa-truck-fast")}
      ${link("/contact.html", "Contact", "fa-phone")}
    </nav>
  `;

  document.getElementById("cartBtn").addEventListener("click", () => location.href = "/cart.html");
  document.getElementById("headerSearchForm").addEventListener("submit", e => {
    e.preventDefault();
    const q = document.getElementById("headerSearchInput").value.trim();
    document.getElementById("headerSuggestions").style.display = "none";
    location.href = `/product.html?search=${encodeURIComponent(q)}`;
  });

  ssBindSearchSuggestions(
    document.getElementById("headerSearchInput"),
    document.getElementById("headerSuggestions")
  );

  /* ---------- mobile drawer: full-page, auth-aware ---------- */
  const overlay = document.createElement("div");
  overlay.className = "drawer-overlay";
  overlay.id = "drawerOverlay";

  const drawer = document.createElement("div");
  drawer.className = "drawer";
  drawer.id = "drawer";

  const initial = (auth.user && (auth.user.name || auth.user.username || auth.user.email) || "?")
    .toString().trim().charAt(0).toUpperCase();

  const userCardHtml = auth.loggedIn && auth.user ? `
    <div class="drawer-user">
      <div class="drawer-user__avatar">${initial}</div>
      <div class="drawer-user__welcome">Welcome, ${ssEscapeHtml(auth.user.name || auth.user.username || "there")}</div>
      ${auth.user.email ? `<div class="drawer-user__email"><i class="fa-regular fa-envelope"></i> ${ssEscapeHtml(auth.user.email)}</div>` : ""}
    </div>
  ` : "";

  const authLinkHtml = auth.loggedIn
    ? `<a href="#" id="drawerLogoutBtn" class="drawer-links__logout"><i class="fa-solid fa-right-from-bracket"></i> Logout</a>`
    : link("/login.html", "Login", "fa-right-to-bracket");

  drawer.innerHTML = `
    <button class="drawer-close" id="drawerCloseBtn" aria-label="Close menu">&times;</button>
    ${userCardHtml}
        <div class="drawer-links">
      ${link("/index.html", "Home", "fa-house")}
      ${link("/product.html", "All Products", "fa-bag-shopping")}

            <!-- ---- Expandable "Shop by Category" accordion + View All ---- -->
      <div class="drawer-cat-head">
        <button type="button" class="drawer-cat-toggle" id="drawerCatToggle">
          <span><i class="fa-solid fa-layer-group"></i> Shop by Category</span>
          <i class="fa-solid fa-chevron-down drawer-cat-toggle__chevron"></i>
        </button>
        <a href="/category.html" class="drawer-cat-viewall">View All</a>
      </div>
      <div class="drawer-cat-list" id="drawerCatList">
        <div class="drawer-cat-list__inner"></div>
      </div>

      
      ${link("/shop.html", "Shops", "fa-solid fa-shop")}
      ${link("/wholesale.html", "Wholesale", "fa-boxes-stacked")}

      <a href="/chat.html" class="${active === "/chat.html" ? "active" : ""} drawer-links__chat">
        <i class="fa-solid fa-comments"></i> Chat
        <span class="drawer-badge" id="drawerChatBadge" style="display:none;">0</span>
      </a>

      <a href="/rfq.html" id="drawerRfqLink" class="drawer-links__rfq">
        <i class="fa-solid fa-file-signature"></i> Request a Quote
        <span class="drawer-pill-new">New</span>
      </a>

      ${link("/about.html", "About", "fa-circle-info")}
      ${authLinkHtml}
      ${link("/register.html", "Sell With Us", "fa-store")}
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.appendChild(drawer);

  const openBtn = document.getElementById("drawerOpenBtn");

  const open = () => {
    overlay.classList.add("active");
    drawer.classList.add("active");
    openBtn.classList.add("active");
    openBtn.setAttribute("aria-expanded", "true");
    document.body.classList.add("drawer-lock");
  };
  const close = () => {
    overlay.classList.remove("active");
    drawer.classList.remove("active");
    openBtn.classList.remove("active");
    openBtn.setAttribute("aria-expanded", "false");
    document.body.classList.remove("drawer-lock");
  };

  openBtn.addEventListener("click", () => {
    drawer.classList.contains("active") ? close() : open();
  });
  document.getElementById("drawerCloseBtn").addEventListener("click", close);
  overlay.addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  const logoutBtn = document.getElementById("drawerLogoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", (e) => {
      e.preventDefault();
      close();
      ssLogout();
    });
  }

  /* ---- "Request a Quote" drawer row: shows an educational modal
     the first time, then goes straight to rfq.html for anyone who
     ticked "Don't show this again". ---- */
  const drawerRfqLink = document.getElementById("drawerRfqLink");
  if (drawerRfqLink) {
    drawerRfqLink.addEventListener("click", (e) => {
      e.preventDefault();
      close();
      let skip = false;
      try { skip = localStorage.getItem("ss-rfq-intro-dismissed") === "1"; } catch (_) {}
      if (skip) {
        location.href = "/rfq.html";
      } else {
        setTimeout(() => ssShowRfqIntroModal(), 260); // let the drawer finish closing first
      }
    });
  }

  /* ---------- wire up the category accordion toggle ----------
     Lazy-loads the tree only the first time it's opened, so the
     drawer never fires an extra API call for shoppers who don't
     touch this section. */
  const catToggleBtn = document.getElementById("drawerCatToggle");
  const catListPanel = document.getElementById("drawerCatList");
  if (catToggleBtn && catListPanel) {
    catToggleBtn.addEventListener("click", () => {
      const opening = !catListPanel.classList.contains("open");
      catListPanel.classList.toggle("open", opening);
      catToggleBtn.classList.toggle("open", opening);
      if (opening && !catListPanel.dataset.loaded) {
        catListPanel.dataset.loaded = "1";
        ssRenderDrawerCategories("drawerCatList");
      }
    });
  }

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
    return ssEscapeHtml(str);
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
          <img class="sug-thumb" src="${ssImgSized(p, "f_auto,q_auto:good,w_120,h_120,c_fill,dpr_auto")}" alt="" loading="lazy" onerror="this.style.opacity='0'">
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
        location.href = `/product-detail.html?id=${item.dataset.id}`;
      });
    });

    document.getElementById("sugSeeAll").addEventListener("click", () => {
      location.href = `/product.html?search=${encodeURIComponent(query)}`;
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

  // Dynamic "Sell With Us" column: what it shows depends on who's looking.
  //   guest / buyer          -> Become a Seller, Own a Shop (learn more), Seller Login
  //   retailer/wholesaler    -> Seller Dashboard, Manage My Shop, Logout stays in the drawer
  const { loggedIn, user } = ssAuthState();
  const isSeller = loggedIn && user && (user.role === "wholesaler" || user.role === "retailer");

  const sellWithUsHtml = isSeller ? `
    <h4>Sell With Us</h4>
    <a href="/six-star-suppliers/seller-dashboard.html"><i class="fa-solid fa-gauge"></i> Seller Dashboard</a>
    <a href="/six-star-suppliers/seller-dashboard.html#shop"><i class="fa-solid fa-store"></i> Manage My Shop</a>
    <a href="/about.html#own-a-shop">How shop ownership works</a>
  ` : `
    <h4>Sell With Us</h4>
    <a href="/about.html#becoming-a-seller">Become a Seller</a>
    <a href="/about.html#own-a-shop">Own a Shop</a>
    <a href="/six-star-suppliers/login.html ">Seller Login</a>
  `;

  el.innerHTML = `
    <div class="footer-grid">
      <div>
        <h4>Customer Service</h4>
        <a href="/contact.html">Contact Us / Visit Us</a>
        <a href="/about.html#faq">FAQs</a>
        <a href="/profile.html#panel-orders">Track My Order</a>
      </div>
      <div>
        <h4>About Us</h4>
        <a href="/about.html#our-story">Our Story</a>
        <a href="/contact.html">Our Depot</a>
        <a href="/product.html">Our Products</a>
      </div>
      <div>
        ${sellWithUsHtml}
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

/* ---------- scroll-to-top button ----------
   Small round button pinned bottom-left (mirrors the WhatsApp float on
   the bottom-right). Hidden until the page has scrolled a bit, fades/
   slides in past that point, and smooth-scrolls back to the top on
   click. Injected once per page load from the same DOMContentLoaded
   hook that renders the header/footer, so it's available site-wide
   with zero per-page markup required.
------------------------------------------------- */
function ssRenderScrollTop() {
  if (document.getElementById("scrollTopBtn")) return; // guard against double-init

  const btn = document.createElement("button");
  btn.className = "scroll-top-btn";
  btn.id = "scrollTopBtn";
  btn.type = "button";
  btn.setAttribute("aria-label", "Back to top");
  btn.innerHTML = `<i class="fa-solid fa-chevron-up"></i>`;
  document.body.appendChild(btn);

  btn.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
  btn.blur(); // clears any lingering focus/hover state so the icon
              // returns to black instead of staying orange on mobile
});

  const toggle = () => {
    btn.classList.toggle("show", window.scrollY > 400);
  };

  window.addEventListener("scroll", toggle, { passive: true });
  toggle(); // in case the page loads already scrolled (back/forward nav)
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

/* ---------- cascading category tree (used by product.html's sidebar filter) ----------
   Two building blocks:

   1. ssFindCategoryPath(tree, id) — walks the full category tree and
      returns the ancestor chain (root ... target, inclusive) for a given
      category id, or null if it isn't in the tree. Used to pre-select the
      cascade correctly when a user lands with a category already in the
      URL (mega-menu click, drawer accordion link, category banner,
      browser back/forward).

   2. ssRenderCategoryCascade(container, tree, opts) — renders ONE <select>
      per tree depth actually in use: main category, then (only if the
      chosen one has children) its sub-categories, then (only if THAT has
      children) its sub-sub-categories. Nothing beyond the deepest node
      the user has drilled into is ever shown, and it adapts automatically
      to however many levels a given branch actually has — 1, 2, 3, or
      more — with zero hardcoded depth.

   These are separate from ssRenderDrawerCategories() below (the mobile
   nav's tap-to-expand accordion) — that one is for browsing/navigating
   into a category from the drawer, this one is for filtering the already-
   open product.html listing without leaving the page.
------------------------------------------------- */
function ssFindCategoryPath(tree, id, trail = []) {
  if (!id) return null;
  for (const node of (tree || [])) {
    const nodeId = node._id || node.id;
    const nextTrail = trail.concat([node]);
    if (nodeId === id) return nextTrail;
    if (node.children && node.children.length) {
      const found = ssFindCategoryPath(node.children, id, nextTrail);
      if (found) return found;
    }
  }
  return null;
}

function ssRenderCategoryCascade(container, tree, opts = {}) {
  if (!container) return;
  const { selectedId = "", onChange = () => {} } = opts;

  const catId = (c) => c._id || c.id;

  // Figure out which node is selected at each depth, so re-renders
  // (e.g. after a URL/back-nav change) restore the full drill-down path.
  let path = selectedId ? (ssFindCategoryPath(tree, selectedId) || []) : [];

  function levelLabel(depth, parentName) {
    if (depth === 0) return "All categories";
    return `All in ${parentName}`;
  }

  function render() {
    container.innerHTML = "";
    let levelNodes = tree || [];
    let depth = 0;
    let parentName = "";

    while (levelNodes && levelNodes.length) {
      const selectedNode = path[depth] || null;

      const select = document.createElement("select");
      select.className = "cat-cascade__select";
      select.dataset.depth = String(depth);

      const options = [`<option value="">${levelLabel(depth, parentName)}</option>`]
        .concat(levelNodes.map(n => {
          const id = catId(n);
          const isSelected = selectedNode && catId(selectedNode) === id;
          return `<option value="${id}" ${isSelected ? "selected" : ""}>${n.name}</option>`;
        }));
      select.innerHTML = options.join("");

      select.addEventListener("change", () => {
        const val = select.value;
        // Keep the path up to (not including) this depth, then extend it
        // with the newly chosen node — anything deeper is now stale and
        // gets rebuilt by render().
        const truncated = path.slice(0, depth);
        if (val) {
          const chosen = levelNodes.find(n => catId(n) === val);
          if (chosen) truncated.push(chosen);
        }
        path = truncated;
        render();
        const leaf = path[path.length - 1];
        onChange(leaf ? catId(leaf) : "");
      });

      container.appendChild(select);

      if (!selectedNode) break; // nothing chosen at this depth yet — stop, don't guess further
      parentName = selectedNode.name;
      levelNodes = selectedNode.children || [];
      depth++;
    }

    if (!container.children.length) {
      container.innerHTML = `<p class="cat-cascade__empty">No categories available</p>`;
    }
  }

  render();
}

// Renders the "Shop by category" tile grid in a fresh random order
// every time the page loads. Pass `limit` to cap how many show.
// Each tile now sends the shopper straight into product.html pre-filtered
// to that category (same "category" query param the mega menu already
// uses), instead of the old dedicated category.html page.
function ssRenderCategoryGrid(targetId, limit = null) {
  const el = document.getElementById(targetId);
  if (!el) return;
  ssLoadCategories().then(cats => {
    let list = ssShuffle(cats);
    if (limit) list = list.slice(0, limit);
    el.innerHTML = list.map(c => {
      const catRef = c._id || c.id || c.slug;
      const rawImg = c.image || 'https://placehold.co/300/F3F4F8/15161A?text=' + encodeURIComponent(c.name);
      const img = ssCldTransform(rawImg, "f_auto,q_auto:good,w_300,h_300,c_fill,dpr_auto");
      return `
      <a class="cat-item" href="/category-explore.html?category=${encodeURIComponent(catRef)}"">
        <div class="cat-thumb"><img src="${img}" alt="${c.name}"></div>
        <span>${c.name}</span>
      </a>`;
    }).join("");
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

  // In ssRenderMegaMenu():
// OLD: const catLink = (cat) => `/product.html?category=${encodeURIComponent(cat._id || cat.id)}`;
// NEW:
const catLink = (cat) => `/category-explore.html?category=${encodeURIComponent(cat._id || cat.id)}`;

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

/* ============================================================
   DRAWER CATEGORY ACCORDION — mobile-menu only.
   Mirrors the same 3-level category tree used by ssRenderMegaMenu
   (Parent -> Category -> Sub-category), but rendered as a nested,
   tap-to-expand accordion instead of a hover flyout, since hover
   doesn't exist on touch devices.

   Behaviour:
   - Top-level categories: name is a direct link into product.html
     (?category=id); the chevron button next to it only expands/
     collapses that category's sub-categories — it never navigates.
   - Sub-categories: same pattern one level deeper, expanding to the
     leaf sub-categories.
   - Leaf items are plain links (nothing left to expand).
   - Falls back to the flat category list (ssLoadCategories) if the
     tree endpoint has nothing yet, so the accordion is never empty.
   ============================================================ */
async function ssRenderDrawerCategories(targetId) {
  const wrap = document.getElementById(targetId);
  if (!wrap) return;
  const inner = wrap.querySelector(".drawer-cat-list__inner");
  if (!inner) return;

  // Skeleton while the tree loads
  inner.innerHTML = Array.from({ length: 5 })
    .map(() => `<div class="drawer-cat-skel"></div>`)
    .join("");

  let tree = [];
  try {
    const data = await SS_API.getCategoryTree();
    tree = Array.isArray(data) ? data : (data.categories || data.tree || []);
  } catch (_) {
    tree = [];
  }

  // Fallback: flat category list with no nested levels, so the
  // accordion still shows *something* browsable.
  if (!tree.length) {
    try {
      const flat = await ssLoadCategories();
      tree = flat.map(c => ({ _id: c._id || c.id || c.slug, name: c.name, children: [] }));
    } catch (_) {
      tree = [];
    }
  }

  if (!tree.length) {
    inner.innerHTML = `<div class="drawer-cat-empty">No categories available right now</div>`;
    return;
  }

  const catLink = (cat) => `/product.html?category=${encodeURIComponent(cat._id || cat.id)}`;

  inner.innerHTML = tree.map((cat, i) => {
    const kids = cat.children || [];
    const hasKids = kids.length > 0;
    const panelId = `drawer-cat-${i}`;

    return `
      <div class="drawer-cat-item">
        <div class="drawer-cat-item__row">
          <a href="${catLink(cat)}" class="drawer-cat-item__link">${ssEscapeHtml(cat.name)}</a>
          ${hasKids ? `
            <button type="button" class="drawer-cat-item__expand" data-target="${panelId}" aria-label="Expand ${ssEscapeHtml(cat.name)}" aria-expanded="false">
              <i class="fa-solid fa-chevron-down"></i>
            </button>` : ""}
        </div>
        ${hasKids ? `
          <div class="drawer-cat-item__sub" id="${panelId}">
            <div class="drawer-cat-item__sub-inner">
              ${kids.map((sub, j) => {
                const leaves = sub.children || [];
                const hasLeaves = leaves.length > 0;
                const leafPanelId = `${panelId}-${j}`;
                return `
                  <div class="drawer-subcat-item">
                    <div class="drawer-subcat-item__row">
                      <a href="${catLink(sub)}" class="drawer-subcat-item__link">${ssEscapeHtml(sub.name)}</a>
                      ${hasLeaves ? `
                        <button type="button" class="drawer-subcat-item__expand" data-target="${leafPanelId}" aria-label="Expand ${ssEscapeHtml(sub.name)}" aria-expanded="false">
                          <i class="fa-solid fa-chevron-down"></i>
                        </button>` : ""}
                    </div>
                    ${hasLeaves ? `
                      <div class="drawer-subcat-item__leaf" id="${leafPanelId}">
                        <div class="drawer-subcat-item__leaf-inner">
                          ${leaves.map(leaf => `<a href="${catLink(leaf)}" class="drawer-leaf-link">${ssEscapeHtml(leaf.name)}</a>`).join("")}
                        </div>
                      </div>` : ""}
                  </div>`;
              }).join("")}
            </div>
          </div>` : ""}
      </div>`;
  }).join("");

  // Event delegation for every expand chevron (both nesting levels)
  inner.querySelectorAll(".drawer-cat-item__expand, .drawer-subcat-item__expand").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const panel = document.getElementById(btn.dataset.target);
      if (!panel) return;
      const opening = !panel.classList.contains("open");
      panel.classList.toggle("open", opening);
      btn.classList.toggle("rotated", opening);
      btn.setAttribute("aria-expanded", opening ? "true" : "false");
    });
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
          <img src="${ssCldTransform(ad.image, "f_auto,q_auto:good,w_1600,c_limit,dpr_auto")}" alt="${ad.title || "Promotion"}" loading="lazy">
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



/* ============================================================
   FLASH SALE — real backend-driven rail.
   Talks to GET /api/flash-sales/active (SS_API.getActiveFlashSales),
   which already re-derives "is this live right now?" server-side on
   every call. This function:
     - shows live products with a real "ends in" countdown to the
       shared midnight endAt when something is active
     - shows an empty state with a real "starts in" countdown to the
       next 2:00 PM when nothing is
     - re-fetches itself automatically the instant either countdown
       hits zero, so the rail flips live/ends without a page reload
   ============================================================ */

window.__ssFlashSaleCache = window.__ssFlashSaleCache || {};
window.__ssFlashSaleCountdownTimer = window.__ssFlashSaleCountdownTimer || null;

// Formats a millisecond duration as "HHh : MMm : SSs", floored at 0.
function ssFmtCountdown(diffMs) {
  const totalSec = Math.max(0, Math.floor(diffMs / 1000));
  const h = String(Math.floor(totalSec / 3600)).padStart(2, "0");
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  return `${h}h : ${m}m : ${s}s`;
}

// Next occurrence of 2:00 PM local time (today if we haven't hit it yet,
// otherwise tomorrow). Mirrors FLASH_SALE_START_HOUR = 14 on the backend.
function ssNextFlashSaleStart() {
  const now = new Date();
  const start = new Date(now);
  start.setHours(14, 0, 0, 0);
  if (now >= start) start.setDate(start.getDate() + 1);
  return start;
}

// Renders one Flash Sale product card. Distinct from ssProductCard() —
// Flash Sale pricing/stock lives on the FlashSale document, not the
// Product document, so this reads flashSalePrice/originalPrice/
// discountPercent/stockAllocated/stockSold instead.
// Renders one Flash Sale product card. isLive=false renders a locked card:
// same visual language as out-of-stock (dimmed image, overlay, disabled +
// button) but the overlay reads "Starts at 2:00 PM" instead of "Sold out",
// so shoppers can browse and plan without being able to buy yet.
function ssFlashSaleCard(fs) {
  window.__ssFlashSaleCache = window.__ssFlashSaleCache || {};
  const fsId = fs.id || fs._id;
  if (fsId) window.__ssFlashSaleCache[fsId] = fs;

  const product = fs.product || {};
  const productId = product.id || product._id || "";
  const allocated = Number(fs.stockAllocated) || 0;
  const sold = Number(fs.stockSold) || 0;
  const remaining = fs.remainingStock != null ? Number(fs.remainingStock) : Math.max(0, allocated - sold);
  const isLive = fs.isLive !== undefined ? !!fs.isLive : true; // /active items are always live
  const soldOut = isLive && remaining <= 0;
  const locked = !isLive;
  const claimedPct = allocated ? Math.min(100, Math.round((sold / allocated) * 100)) : 0;
  const lowStock = isLive && !soldOut && remaining <= Math.max(3, Math.round(allocated * 0.1));

  let overlay = "";
  if (locked) overlay = `<div class="p-card__oos-overlay fs-card__lock-overlay"><i class="fa-solid fa-lock"></i> Starts at 2:00 PM</div>`;
  else if (soldOut) overlay = `<div class="p-card__oos-overlay">Sold out</div>`;

  let stockLabel;
  if (locked) {
    stockLabel = `<span class="fs-card__pending-label"><i class="fa-regular fa-clock"></i> Not started yet</span>`;
  } else if (soldOut) {
    stockLabel = `<span class="fs-card__soldout-label">Sold out</span>`;
  } else if (lowStock) {
    stockLabel = `<span class="fs-card__lowstock-label"><i class="fa-solid fa-fire"></i> Only ${remaining} left</span>`;
  } else {
    stockLabel = `<span>${claimedPct}% claimed</span>`;
  }

  const disabled = locked || soldOut;

  return `
    <div class="p-card fs-card ${soldOut ? "out-of-stock" : ""} ${locked ? "fs-card--locked" : ""}" data-fsid="${fsId}">
      <div class="p-card__badges">
        <div class="p-card__discount fs-card__discount">-${fs.discountPercent}%</div>
        <div class="p-card__hot fs-card__flash-badge"><i class="fa-solid fa-bolt"></i> Flash</div>
      </div>
      <div class="p-card__img">
        <img src="${ssImgSized(product)}" alt="${product.name || "Product"}" loading="lazy" onclick="location.href='/product-detail.html?id=${productId}'">
        ${overlay}
      </div>
      <div class="p-card__body">
        <div class="p-card__name">${product.name || ""}</div>
        <div class="p-card__old">${ssFmtPrice(fs.originalPrice)}</div>
        <div class="p-card__foot">
          <span class="price-tag fs-card__price">${ssFmtPrice(fs.flashSalePrice)}</span>
          <button class="p-card__add" title="${locked ? "Available at 2:00 PM" : "Add to cart"}" ${disabled ? "disabled" : ""} onclick="event.stopPropagation(); ssQuickAddFlashSale('${fsId}')">
            <i class="fa-solid ${locked ? "fa-lock" : "fa-plus"}"></i>
          </button>
        </div>
        <div class="fs-card__stockbar"><div class="fs-card__stockbar-fill" style="width:${locked ? 0 : claimedPct}%"></div></div>
        <div class="fs-card__stocklabel">${stockLabel}</div>
      </div>
    </div>`;
}

function ssQuickAddFlashSale(fsId) {
  const fs = (window.__ssFlashSaleCache || {})[fsId];
  if (!fs) return;
  if (fs.isLive === false) { ssToast("This Flash Sale hasn't started yet — come back at 2:00 PM", "fa-lock"); return; }

  const product = fs.product || {};
  const allocated = Number(fs.stockAllocated) || 0;
  const sold = Number(fs.stockSold) || 0;
  const remaining = fs.remainingStock != null ? Number(fs.remainingStock) : Math.max(0, allocated - sold);

  if (remaining <= 0) { ssToast("This Flash Sale item is sold out", "fa-circle-exclamation"); return; }

  const cartProduct = {
    ...product,
    id: product.id || product._id,
    finalPrice: fs.flashSalePrice,
    displayPrice: fs.flashSalePrice,
    discountPercent: fs.discountPercent,
    stock: remaining,
    isFlashDeal: true,
    flashSaleId: fsId,
  };

  window.__ssProductCache = window.__ssProductCache || {};
  window.__ssProductCache[cartProduct.id] = cartProduct;

  SS_CART.add(cartProduct, 1);
  ssToast(`${product.name || "Item"} added to cart`, "fa-cart-shopping");
}

// Fetches /flash-sales/today (live + locked-upcoming) and renders the rail.
// Section shows whenever ANYTHING is scheduled for today, live or not.
// Countdown badge: "Ends in" (to midnight) if anything is live right now,
// otherwise "Starts in" (to the earliest startAt among today's items).
async function ssRenderFlashSale(sectionId, listId, timerId) {
  const section = document.getElementById(sectionId);
  const list = document.getElementById(listId);
  const timerEl = document.getElementById(timerId);
  if (!section || !list) return;

  if (window.__ssFlashSaleCountdownTimer) {
    clearInterval(window.__ssFlashSaleCountdownTimer);
    window.__ssFlashSaleCountdownTimer = null;
  }

  list.innerHTML = ssSkeletonCards(4);
  section.style.display = "block";

  let flashSales = [];
  try {
    const res = await SS_API.getTodayFlashSales();
    flashSales = res.flashSales || res.data || res || [];
    console.debug("[flash-sale] /flash-sales/today ->", res);
  } catch (err) {
    console.error("[flash-sale] fetch failed:", err);
    section.style.display = "none";
    return;
  }

  if (!flashSales.length) {
    console.debug("[flash-sale] endpoint reachable but returned 0 items for today");
    section.style.display = "none";
    return;
  }

  flashSales.forEach(fs => { const p = fs.product; if (p && (p.id || p._id)) window.__ssProductCache[p.id || p._id] = p; });
  list.innerHTML = flashSales.map(ssFlashSaleCard).join("");

  const liveOnes = flashSales.filter(fs => fs.isLive);

  if (timerEl) {
    if (liveOnes.length) {
      timerEl.classList.remove("deal-timer--pending");
      const endAt = new Date(liveOnes[0].endAt);
      const tick = () => {
        const diff = endAt - new Date();
        if (diff <= 0) { ssRenderFlashSale(sectionId, listId, timerId); return; }
        timerEl.innerHTML = `<i class="fa-regular fa-clock"></i> Ends in ${ssFmtCountdown(diff)}`;
      };
      tick();
      window.__ssFlashSaleCountdownTimer = setInterval(tick, 1000);
    } else {
      timerEl.classList.add("deal-timer--pending");
      const startAt = new Date(flashSales[0].startAt); // sorted by startAt from backend
      const tick = () => {
        const diff = startAt - new Date();
        if (diff <= 0) { ssRenderFlashSale(sectionId, listId, timerId); return; }
        timerEl.innerHTML = `<i class="fa-regular fa-clock"></i> Starts in ${ssFmtCountdown(diff)}`;
      };
      tick();
      window.__ssFlashSaleCountdownTimer = setInterval(tick, 1000);
    }
  }
}


// Flattens the full Parent Category -> Category -> Sub Category tree down to
// just the leaf-level sub-categories (the actual "children.children" nodes),
// so the homepage can show real sub-categories instead of broad parent
// categories. Falls back to an empty array (never throws) if the tree
// endpoint fails or a branch has no sub-categories yet.
function ssFlattenSubcategories(tree) {
  const leaves = [];
  (tree || []).forEach(parent => {
    (parent.children || []).forEach(category => {
      (category.children || []).forEach(sub => {
        leaves.push(sub);
      });
    });
  });
  return leaves;
}

// Renders the homepage "Shop by category" tile grid using real
// sub-categories (leaf nodes of the category tree), not top-level parent
// categories. Picks `count` at random on every page load — a fresh mix
// each time, never a fixed static six. Each tile still routes into
// product.html pre-filtered to that sub-category, same as before.
async function ssRenderSubcategoryGrid(targetId, count = 6) {
  const el = document.getElementById(targetId);
  if (!el) return;

  el.innerHTML = Array.from({ length: count })
    .map(() => `<div class="cat-item skel-cat"><div class="cat-thumb skeleton-card"></div></div>`)
    .join("");

  let tree = [];
  try {
    const data = await SS_API.getCategoryTree();
    tree = Array.isArray(data) ? data : (data.categories || data.tree || []);
  } catch (_) {
    tree = [];
  }

  let subs = ssFlattenSubcategories(tree);

  // Fallback: if the tree has no leaf sub-categories yet (still being
  // built out), don't leave the section empty — fall back to whatever
  // flat category list is available so the homepage never shows a gap.
  if (!subs.length) {
    subs = await ssLoadCategories();
  }

  if (!subs.length) {
    el.innerHTML = "";
    return;
  }

  const picks = ssShuffle(subs).slice(0, count);

  el.innerHTML = picks.map(c => {
    const catRef = c._id || c.id || c.slug;
    const rawImg = c.image || 'https://placehold.co/300/F3F4F8/15161A?text=' + encodeURIComponent(c.name);
    const img = ssCldTransform(rawImg, "f_auto,q_auto:good,w_300,h_300,c_fill,dpr_auto");
    return `
    <a class="cat-item" href="/category-explore.html?category=${encodeURIComponent(catRef)}">
      <div class="cat-thumb"><img src="${img}" alt="${c.name}"></div>
      <span>${c.name}</span>
    </a>`;
  }).join("");
}




/* ============================================================
   RFQ INTRO MODAL — a one-time (dismissible) explainer shown the
   first time a buyer taps "Request a Quote" in the drawer. Built
   lazily and cached on document.body so repeat opens are instant.
   ============================================================ */
function ssEnsureRfqIntroModal() {
  let overlay = document.getElementById("rfqIntroOverlay");
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.className = "rfq-intro-overlay";
  overlay.id = "rfqIntroOverlay";
  overlay.innerHTML = `
    <div class="rfq-intro-modal" role="dialog" aria-modal="true" aria-labelledby="rfqIntroTitle">
      <button type="button" class="rfq-intro-modal__close" id="rfqIntroClose" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>

      <div class="rfq-intro-modal__hero">
        <div class="rfq-intro-modal__hero-ico"><i class="fa-solid fa-file-signature"></i></div>
        <span class="rfq-intro-modal__eyebrow">New on Six Star Suppliers</span>
        <h2 id="rfqIntroTitle">Can't find it? Just ask for it.</h2>
        <p>Post exactly what you need and your budget — verified sellers come to you with real offers.</p>
      </div>

      <div class="rfq-intro-modal__features">
        <div class="rfq-intro-feature">
          <div class="rfq-intro-feature__ico"><i class="fa-solid fa-bolt"></i></div>
          <div><strong>Get offers fast</strong><span>Verified sellers start sending quotes within minutes of you posting a request.</span></div>
        </div>
        <div class="rfq-intro-feature">
          <div class="rfq-intro-feature__ico"><i class="fa-solid fa-comments"></i></div>
          <div><strong>Chat in real time</strong><span>Message sellers directly to compare offers, ask questions, and negotiate before you commit.</span></div>
        </div>
        <div class="rfq-intro-feature">
          <div class="rfq-intro-feature__ico"><i class="fa-solid fa-shield-halved"></i></div>
          <div><strong>Only verified sellers</strong><span>Every offer comes from a vetted seller — your contact details stay private throughout.</span></div>
        </div>
      </div>

      <label class="rfq-intro-modal__dontshow">
        <input type="checkbox" id="rfqIntroDontShow">
        <span>Don't show this again</span>
      </label>

      <div class="rfq-intro-modal__actions">
        <button type="button" class="btn btn-outline" id="rfqIntroLater">Maybe later</button>
        <a href="/rfq.html" class="btn btn-primary" id="rfqIntroCta"><i class="fa-solid fa-paper-plane"></i> Request a Quote</a>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.classList.remove("active");
  overlay.querySelector("#rfqIntroClose").addEventListener("click", close);
  overlay.querySelector("#rfqIntroLater").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#rfqIntroCta").addEventListener("click", () => {
    const dontShow = overlay.querySelector("#rfqIntroDontShow");
    if (dontShow && dontShow.checked) {
      try { localStorage.setItem("ss-rfq-intro-dismissed", "1"); } catch (_) {}
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("active")) close();
  });

  return overlay;
}

function ssShowRfqIntroModal() {
  const overlay = ssEnsureRfqIntroModal();
  overlay.classList.add("active");
}


/* ============================================================
   LOADING OVERLAY — small, curved, nested arcs rotating in
   opposite directions (like a reload icon), centered on screen,
   with a very light dim so products stay visible underneath.
   Reused by product.html's infinite scroll and index.html's
   "Browse All Products" button.
   ============================================================ */
function ssEnsureLoadingOverlay() {
  let el = document.getElementById("ssLoadingOverlay");
  if (el) return el;

  el = document.createElement("div");
  el.className = "ss-loading-overlay";
  el.id = "ssLoadingOverlay";
  el.innerHTML = `
    <div class="ss-spinner" role="status" aria-label="Loading">
      <span class="ss-spinner__arc ss-spinner__arc--outer"></span>
      <span class="ss-spinner__arc ss-spinner__arc--inner"></span>
    </div>`;
  document.body.appendChild(el);
  return el;
}

function ssShowLoadingOverlay() {
  ssEnsureLoadingOverlay().classList.add("show");
}

function ssHideLoadingOverlay() {
  const el = document.getElementById("ssLoadingOverlay");
  if (el) el.classList.remove("show");
}
/* ============================================================
   Drawer badges — currently just the Chat link's "active
   quotes/bids" count: total offers received across the buyer's
   still-open Request-a-Quote posts.
   ============================================================ */
async function ssLoadDrawerBadges() {
  const badgeEl = document.getElementById("drawerChatBadge");
  if (!badgeEl) return;

  // Public count — mirrors chat.html's own "Open" filter chip, so the
  // number in the drawer always matches what someone sees once they
  // open the board. No login required, since chat.html itself is public.
  try {
    const { rfqs } = await SS_API.getRFQs();
    const openCount = (rfqs || []).filter((r) => r.status === "OPEN").length;

    if (openCount > 0) {
      badgeEl.textContent = openCount > 99 ? "99+" : String(openCount);
      badgeEl.style.display = "inline-flex";
    } else {
      badgeEl.style.display = "none";
    }
  } catch (_) {
    badgeEl.style.display = "none";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  ssRenderHeader(document.body.dataset.page || "");
  ssRenderFooter();
  ssRenderWhatsApp();
  ssRenderScrollTop();
  ssHideLoader();
  ssLoadDrawerBadges();
  setInterval(ssLoadDrawerBadges, 30000);
});