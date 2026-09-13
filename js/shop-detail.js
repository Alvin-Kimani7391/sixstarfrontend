/* ============================================================
   shop-detail.js — Individual Shop Storefront (shop-detail.html)
   Reuses ssProductCard() / ssSkeletonCards() from ui.js so
   products render identically to every other page on the site.
   ============================================================ */

let ssShopDetailState = {
  shop: null,
  page: 1,
  limit: 12,
  sort: "-createdAt",
  search: "",
  sortTouched: false
};

function ssGetSlugFromUrl() {
  const params = new URLSearchParams(location.search);
  if (params.get("slug")) return params.get("slug");
  if (params.get("id")) return params.get("id");

  const match = location.pathname.match(/\/shop\/([^/?#]+)/);
  if (match) return decodeURIComponent(match[1]);

  return "";
}

// Reads the shop object api/shop-detail.js already fetched server-side
// (see <!--SSR_SHOP_DATA--> in the template) so the page can paint
// instantly instead of firing a second request at the same API.
function ssReadSsrShopData() {
  const el = document.getElementById("ssrShopData");
  if (!el || !el.textContent) return null;
  try {
    const data = JSON.parse(el.textContent);
    return data && (data.id || data._id) ? data : null;
  } catch (_) {
    return null;
  }
}

function ssShowShopDetailContent() {
  const detail = document.getElementById("shopDetailContent");
  const notFound = document.getElementById("shopNotFound");
  if (detail) detail.style.display = "";
  if (notFound) notFound.style.display = "none";
}

function ssShowShopNotFound() {
  const detail = document.getElementById("shopDetailContent");
  const notFound = document.getElementById("shopNotFound");
  if (detail) detail.style.display = "none";
  if (notFound) notFound.style.display = "block";
}



function ssApplyThemeVars(theme) {
  const root = document.documentElement;
  root.style.setProperty('--shop-primary', theme.colors.primary);
  root.style.setProperty('--shop-secondary', theme.colors.secondary);
  root.style.setProperty('--shop-bg', theme.colors.background);
  root.style.setProperty('--shop-surface', theme.colors.surface);
  root.style.setProperty('--shop-text', theme.colors.text);
  root.style.setProperty('--shop-text-muted', theme.colors.textMuted);
}

function ssRenderThemedHeader(shop, theme) {
  const h = theme.header;
  return `
    <header class="shop-theme-header style-${h.style} ${h.sticky ? 'sticky' : ''}">
      ${h.announcementBar.enabled && h.announcementBar.text ? `
        <div class="shop-theme-announce" style="background:${h.announcementBar.bgColor};color:${h.announcementBar.textColor};">
          ${h.announcementBar.text}
        </div>` : ''}
      <div class="shop-theme-header__row">
        ${shop.logo ? `<img class="shop-theme-header__logo" src="${shop.logo}" alt="${shop.shopName}">` : `<span class="shop-theme-header__name">${shop.shopName}</span>`}
        ${h.showSearch ? `
          <form class="shop-theme-header__search-form" id="shopThemeSearchForm">
            <input class="shop-theme-header__search" id="shopThemeSearch" placeholder="Search ${shop.shopName}…" autocomplete="off">
          </form>` : ''}
      </div>
    </header>`;
}

function ssRenderThemedHero(theme) {
  if (theme.hero.type === 'none') return '';
  const slide = theme.hero.slides[0] || {};
  if (!slide.image && !slide.heading) return '';
  return `
    <section class="shop-theme-hero" style="${slide.image ? `background-image:url('${slide.image}')` : ''}">
      <div class="shop-theme-hero__overlay"></div>
      <div class="shop-theme-hero__content">
        ${slide.heading ? `<h1>${slide.heading}</h1>` : ''}
        ${slide.subheading ? `<p>${slide.subheading}</p>` : ''}
        ${slide.buttonText ? `<a href="${slide.buttonLink || '#'}" class="btn btn-primary">${slide.buttonText}</a>` : ''}
      </div>
    </section>`;
}

function ssRenderThemedSections(theme) {
  return theme.sections.map((s) => {
    if (s.type === 'rich_text') {
      if (!s.title && !s.body) return '';
      return `<section class="shop-theme-richtext wrap">${s.title ? `<h2>${s.title}</h2>` : ''}${s.body ? `<p>${s.body}</p>` : ''}</section>`;
    }
    if (s.type === 'featured_products') {
      return `<section class="shop-theme-section wrap"><h2>${s.title || 'Featured'}</h2><div class="p-grid theme-grid-cols" data-featured-section="${s.id}"></div></section>`;
    }
    if (s.type === 'all_products') {
      return `<section class="shop-theme-section wrap" id="shopProductsToolbar">
        <div class="listing-toolbar">
          <div><h2>${s.title || 'All products'}</h2><span class="count" id="shopProductsCount">Loading…</span></div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
            <form id="shopProductSearchForm" style="display:flex;">
              <input type="text" id="shopProductSearchInput" placeholder="Search in this shop..." autocomplete="off">
              <button type="submit" aria-label="Search"><i class="fa-solid fa-magnifying-glass"></i></button>
            </form>
            <select class="sort-select" id="shopProductSort" aria-label="Sort products">
              <option value="-createdAt">Newest</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
              <option value="rating">Top Rated</option>
            </select>
          </div>
        </div>
        <div class="p-grid theme-grid-cols" id="shopProductsGrid"></div>
        <div class="pagination" id="shopProductsPagination"></div>
      </section>`;
    }
    return '';
  }).join('');
}

function ssRenderThemedFooter(shop, theme) {
  const f = theme.footer;
  return `
    <footer class="shop-theme-footer style-${f.style}">
      <div class="wrap shop-theme-footer__inner">
        ${f.columns.map((c) => `
          <div class="shop-theme-footer__col">
            <h4>${c.title || ''}</h4>
            ${(c.links || []).map((l) => `<a href="${l.url}">${l.label}</a>`).join('')}
          </div>`).join('')}
        ${f.showSocial ? `
          <div class="shop-theme-footer__social">
            ${Object.entries(f.socialLinks).filter(([, v]) => v).map(([k, v]) => `<a href="${v}" target="_blank" rel="noopener"><i class="fa-brands fa-${k === 'whatsapp' ? 'whatsapp' : k}"></i></a>`).join('')}
          </div>` : ''}
      </div>
      <div class="shop-theme-footer__bottom">
        ${f.showPaymentNote ? `<span><i class="fa-solid fa-shield-halved"></i> Payments &amp; delivery handled securely by Six Star Suppliers</span>` : ''}
        <span>${f.copyrightText || `© ${new Date().getFullYear()} ${shop.shopName}`}</span>
      </div>
    </footer>`;
}

function ssRenderThemedShop(shop) {
  const theme = shop.themeConfiguration;
  ssApplyThemeVars(theme);

  const reviewsSectionHtml = `
    <section class="shop-section wrap">
      <div class="shop-reviews">
        <div class="shop-reviews__header">
          <h2>Ratings &amp; Reviews</h2>
          <div class="shop-rating-summary" id="shopRatingSummary"></div>
        </div>
        <div id="shopReviewFormWrap"></div>
        <div class="shop-reviews__list" id="shopReviewsList">Loading…</div>
      </div>
    </section>`;

  document.getElementById('shopDetailContent').innerHTML =
    ssRenderThemedHeader(shop, theme) +
    ssRenderThemedHero(theme) +
    `<div class="shop-passport"><div class="shop-passport__card" id="shopPassportCard"></div></div>` +
    ssRenderThemedSections(theme) +
    reviewsSectionHtml +
    ssRenderThemedFooter(shop, theme);

  document.body.classList.add('shop-theme-active');
  document.documentElement.style.setProperty('--pgrid-cols', theme.productGrid.columns);

  ssRenderShopPassport(shop);
  ssLoadShopProducts();
  ssLoadShopReviews();

  // Re-wire the search/sort controls since we just replaced the DOM they live in
  document.getElementById('shopProductSearchForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    ssShopDetailState.search = document.getElementById('shopProductSearchInput').value.trim();
    ssShopDetailState.page = 1;
    ssLoadShopProducts();
  });
  document.getElementById('shopProductSort')?.addEventListener('change', (e) => {
    ssShopDetailState.sort = e.target.value;
    ssShopDetailState.sortTouched = true;
    ssShopDetailState.page = 1;
    ssLoadShopProducts();
  });
  document.getElementById('shopThemeSearchForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = document.getElementById('shopThemeSearch')?.value.trim();
    if (q) window.location.href = `/product.html?search=${encodeURIComponent(q)}`;
  });
}



async function ssInitShopDetail() {
  const slug = ssGetSlugFromUrl();
  if (!slug) { ssShowShopNotFound(); return; }

  const ssrShop = ssReadSsrShopData();
  if (ssrShop) {
    ssShopDetailState.shop = ssrShop;
    ssShowShopDetailContent();
    document.title = `${ssrShop.shopName} — Six Star Suppliers`;
    if (ssrShop.customizationMode === 'custom' && ssrShop.themeConfiguration) {
      ssRenderThemedShop(ssrShop);
    } else {
      ssRenderShopPassport(ssrShop);
      ssLoadShopProducts();
      ssLoadShopReviews();
    }
    return;
  }

  try {
    const res = await SS_API.getShopBySlug(slug);
    const shop = res.shop;
    if (!shop) { ssShowShopNotFound(); return; }
    ssShopDetailState.shop = shop;
    ssShowShopDetailContent();
    document.title = `${shop.shopName} — Six Star Suppliers`;
    if (shop.customizationMode === 'custom' && shop.themeConfiguration) {
      ssRenderThemedShop(shop);
    } else {
      ssRenderShopPassport(shop);
      ssLoadShopProducts();
      ssLoadShopReviews();
    }
  } catch (err) {
    console.error("ssInitShopDetail failed:", err);
    ssShowShopNotFound();
  }
}




function ssRenderShopPassport(shop) {
  const bannerWrap = document.getElementById("shopBanner");
  bannerWrap.innerHTML = shop.banner
    ? `<img class="shop-hero__banner" src="${shop.banner}" alt="${shop.shopName} banner">`
    : `<div class="shop-hero__banner-fallback"></div>`;

  const initial = (shop.shopName || "?").trim().charAt(0).toUpperCase();
  const memberSince = shop.createdAt ? new Date(shop.createdAt).getFullYear() : "—";

  document.getElementById("shopPassportCard").innerHTML = `
    <div class="shop-passport__logo">${shop.logo ? `<img src="${shop.logo}" alt="">` : initial}</div>
    <div class="shop-passport__info">
      <div class="shop-passport__name-row">
        <span class="shop-passport__name">${shop.shopName}</span>
        ${shop.verificationStatus === "verified" ? `<span class="shop-verified"><i class="fa-solid fa-check"></i> Verified</span>` : ""}
      </div>
      ${shop.businessCategory ? `<div class="shop-passport__category">${shop.businessCategory}</div>` : ""}
      ${shop.description ? `<p class="shop-passport__desc">${shop.description}</p>` : ""}
      <div class="shop-passport__stats">
        <div class="shop-passport__stat"><strong id="shopProductCountStat">—</strong><span>Products</span></div>
        <div class="shop-passport__stat">
          <strong id="shopAvgRatingStat">${(shop.ratingsAverage || 0).toFixed(1)} <i class="fa-solid fa-star" style="font-size:.7em;color:var(--sun)"></i></strong>
          <span id="shopReviewCountStat">${shop.ratingsCount || 0} review${shop.ratingsCount === 1 ? "" : "s"}</span>
        </div>
        <div class="shop-passport__stat"><strong>${memberSince}</strong><span>On Six Star since</span></div>
        ${shop.businessHours ? `<div class="shop-passport__stat"><strong style="font-size:.82rem;">${shop.businessHours}</strong><span>Hours</span></div>` : ""}
      </div>
      <div class="shop-hint">
        <i class="fa-solid fa-shield-halved"></i>
        <span>All orders, payments and delivery are handled by Six Star Suppliers — sellers are reviewed and approved before their shop goes live.</span>
      </div>
    </div>
    <div class="shop-passport__actions">
      <a href="/product.html" class="btn btn-outline btn-sm">Continue shopping</a>
      <a href="/contact.html" class="btn btn-dark btn-sm">Contact support</a>
    </div>
  `;
}

function ssUpdateShopRatingStats(shop) {
  const avgEl = document.getElementById("shopAvgRatingStat");
  const countEl = document.getElementById("shopReviewCountStat");
  if (avgEl) {
    avgEl.innerHTML = `${(shop.ratingsAverage || 0).toFixed(1)} <i class="fa-solid fa-star" style="font-size:.7em;color:var(--sun)"></i>`;
  }
  if (countEl) {
    countEl.textContent = `${shop.ratingsCount || 0} review${shop.ratingsCount === 1 ? "" : "s"}`;
  }
}

function ssShouldShuffleShopListing() {
  return !ssShopDetailState.search && !ssShopDetailState.sortTouched;
}

async function ssLoadShopProducts() {
  const grid = document.getElementById("shopProductsGrid");
  const pagination = document.getElementById("shopProductsPagination");
  grid.innerHTML = ssSkeletonCards(8);

  const shop = ssShopDetailState.shop;
  const params = {
    shop: shop.id || shop._id,
    page: ssShopDetailState.page,
    limit: ssShopDetailState.limit,
    sort: ssShopDetailState.sort,
  };
  if (ssShopDetailState.search) params.search = ssShopDetailState.search;

  try {
    const res = await SS_API.getProducts(params);
    let products = res.products || [];
    const total = res.total ?? products.length;
    document.getElementById("shopProductCountStat").textContent = total;
    document.getElementById("shopProductsCount").textContent = `${total} product${total === 1 ? "" : "s"}`;

    if (!products.length) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1;">
          <i class="fa-solid fa-box-open"></i>
          <h3>No products here yet</h3>
          <p>This shop hasn't listed anything matching your filters.</p>
        </div>`;
      pagination.innerHTML = "";
      return;
    }

    if (ssShouldShuffleShopListing()) products = ssShuffle(products);

    grid.innerHTML = products.map(ssProductCard).join("");
    ssRenderShopProductsPagination(pagination, res.page || 1, res.pages || 1);
  } catch (err) {
    console.error("ssLoadShopProducts failed:", err);
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <h3>Couldn't load products</h3>
        <p>Check your connection and try again.</p>
      </div>`;
    pagination.innerHTML = "";
  }
}

function ssRenderShopProductsPagination(el, page, pages) {
  if (pages <= 1) { el.innerHTML = ""; return; }
  let html = "";
  html += `<button class="nav" ${page <= 1 ? "disabled" : ""} data-page="${page - 1}"><i class="fa-solid fa-chevron-left"></i></button>`;
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1) {
      html += `<button class="${i === page ? "active" : ""}" data-page="${i}">${i}</button>`;
    } else if (i === page - 2 || i === page + 2) {
      html += `<span style="padding:0 4px;color:var(--ink-faint);">…</span>`;
    }
  }
  html += `<button class="nav" ${page >= pages ? "disabled" : ""} data-page="${page + 1}"><i class="fa-solid fa-chevron-right"></i></button>`;
  el.innerHTML = html;
  el.querySelectorAll("button[data-page]").forEach(btn => {
    btn.addEventListener("click", () => {
      const p = Number(btn.dataset.page);
      if (!p || p === ssShopDetailState.page) return;
      ssShopDetailState.page = p;
      ssLoadShopProducts();
      window.scrollTo({ top: document.getElementById("shopProductsToolbar").offsetTop - 100, behavior: "smooth" });
    });
  });
}

function ssStarsHtml(rating, size = 14) {
  const full = Math.round(rating);
  let html = `<span class="star-row" style="font-size:${size}px;">`;
  for (let i = 1; i <= 5; i++) {
    html += `<i class="fa-solid fa-star" style="color:${i <= full ? "var(--sun)" : "var(--line)"}"></i>`;
  }
  html += "</span>";
  return html;
}

async function ssLoadShopReviews() {
  const shop = ssShopDetailState.shop;
  const listEl = document.getElementById("shopReviewsList");
  const summaryEl = document.getElementById("shopRatingSummary");
  listEl.innerHTML = `<p style="color:var(--ink-faint);">Loading reviews…</p>`;

  try {
    const res = await SS_API.getShopReviews(shop.id || shop._id);
    const reviews = res.reviews || [];
    const count = shop.ratingsCount || reviews.length;

    summaryEl.innerHTML = `
      ${ssStarsHtml(shop.ratingsAverage || 0, 16)}
      <strong style="margin-left:6px;">${(shop.ratingsAverage || 0).toFixed(1)}</strong>
      <span style="color:var(--ink-faint);font-size:12.5px;margin-left:4px;">(${count} review${count === 1 ? "" : "s"})</span>
    `;

    ssUpdateShopRatingStats(shop);

    if (!reviews.length) {
      listEl.innerHTML = `<p style="color:var(--ink-faint);">No reviews yet — be the first to review this shop.</p>`;
    } else {
      listEl.innerHTML = reviews.map(r => `
        <div class="shop-review-item">
          <div class="shop-review-item__head">
            <span class="shop-review-item__name">${r.buyer?.name || "Buyer"}</span>
            ${ssStarsHtml(r.rating, 12)}
          </div>
          ${r.comment ? `<p class="shop-review-item__comment">${r.comment}</p>` : ""}
          <span class="shop-review-item__date">${new Date(r.createdAt).toLocaleDateString()}</span>
        </div>
      `).join("");
    }
  } catch (err) {
    console.error("ssLoadShopReviews failed:", err);
    listEl.innerHTML = `<p style="color:var(--ink-faint);">Couldn't load reviews.</p>`;
  }

  ssRenderShopReviewForm();
}

function ssRenderShopReviewForm() {
  const wrap = document.getElementById("shopReviewFormWrap");
  const user = typeof SS_AUTH !== "undefined" && SS_AUTH.get ? SS_AUTH.get() : null;

  if (!user) {
    wrap.innerHTML = `<p class="shop-review-cta"><a href="/login.html">Log in</a> as a buyer to leave a review.</p>`;
    return;
  }
  if (user.role !== "buyer") { wrap.innerHTML = ""; return; }

  wrap.innerHTML = `
    <form id="shopReviewForm" class="shop-review-form">
      <div class="shop-review-form__stars" id="shopReviewStarsInput">
        ${[1, 2, 3, 4, 5].map(i => `<i class="fa-regular fa-star" data-val="${i}"></i>`).join("")}
      </div>
      <textarea id="shopReviewComment" placeholder="Share your experience with this shop (optional)" maxlength="1000"></textarea>
      <button type="submit" class="btn btn-primary btn-sm">Submit review</button>
    </form>
  `;

  let selectedRating = 0;
  const starEls = wrap.querySelectorAll("#shopReviewStarsInput i");
  starEls.forEach(star => {
    star.addEventListener("click", () => {
      selectedRating = Number(star.dataset.val);
      starEls.forEach(s => {
        const active = Number(s.dataset.val) <= selectedRating;
        s.className = active ? "fa-solid fa-star" : "fa-regular fa-star";
        s.style.color = active ? "var(--sun)" : "";
      });
    });
  });

  document.getElementById("shopReviewForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!selectedRating) { ssToast?.("Please select a star rating"); return; }

    const submitBtn = wrap.querySelector("button[type='submit']");
    if (submitBtn) submitBtn.disabled = true;

    try {
      await SS_API.addShopReview(ssShopDetailState.shop.id || ssShopDetailState.shop._id, {
        rating: selectedRating,
        comment: document.getElementById("shopReviewComment").value.trim(),
      });
      ssToast?.("Review submitted, thank you!");

      const res = await SS_API.getShopBySlug(ssGetSlugFromUrl());
      ssShopDetailState.shop = res.shop;

      ssUpdateShopRatingStats(res.shop);
      ssLoadShopReviews();
    } catch (err) {
      ssToast?.(err.message || "Couldn't submit review");
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  ssInitShopDetail();

  document.getElementById("shopProductSearchForm").addEventListener("submit", e => {
    e.preventDefault();
    ssShopDetailState.search = document.getElementById("shopProductSearchInput").value.trim();
    ssShopDetailState.page = 1;
    ssLoadShopProducts();
  });

  document.getElementById("shopProductSort").addEventListener("change", e => {
    ssShopDetailState.sort = e.target.value;
    ssShopDetailState.sortTouched = true;
    ssShopDetailState.page = 1;
    ssLoadShopProducts();
  });
});