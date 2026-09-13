/* ============================================================
   shop-detail.js — Individual Shop Storefront (shop-detail.html)
   ============================================================ */

let ssShopDetailState = {
  shop: null,
  page: 1,
  limit: 12,
  sort: "-createdAt",
  search: "",
  sortTouched: false
};

let ssHeroSlideshowInterval = null;

const SS_SOCIAL_ICON_CLASS = {
  facebook: "fa-brands fa-facebook",
  instagram: "fa-brands fa-instagram",
  tiktok: "fa-brands fa-tiktok",
  whatsapp: "fa-brands fa-whatsapp",
  twitter: "fa-brands fa-x-twitter",
  youtube: "fa-brands fa-youtube",
  linkedin: "fa-brands fa-linkedin",
  pinterest: "fa-brands fa-pinterest",
  telegram: "fa-brands fa-telegram",
  snapchat: "fa-brands fa-snapchat",
  threads: "fa-brands fa-threads",
  website: "fa-solid fa-globe",
};
function ssSocialIconClass(platform) {
  return SS_SOCIAL_ICON_CLASS[platform] || "fa-solid fa-link";
}

function ssGetSlugFromUrl() {
  const params = new URLSearchParams(location.search);
  if (params.get("slug")) return params.get("slug");
  if (params.get("id")) return params.get("id");
  const match = location.pathname.match(/\/shop\/([^/?#]+)/);
  if (match) return decodeURIComponent(match[1]);
  return "";
}

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

function ssSetSiteChromeVisible(visible) {
  const siteHeader = document.getElementById("site-header");
  const siteFooter = document.getElementById("site-footer");
  const waFloat = document.getElementById("wa-float");
  [siteHeader, siteFooter, waFloat].forEach((el) => {
    if (!el) return;
    el.style.display = visible ? "" : "none";
  });
}

function ssApplyThemeVars(theme) {
  const root = document.documentElement;
  const c = theme.colors || {};
  root.style.setProperty('--shop-primary', c.primary || '#f2a93b');
  root.style.setProperty('--shop-secondary', c.secondary || '#16324f');
  root.style.setProperty('--shop-bg', c.background || '#fbf3e7');
  root.style.setProperty('--shop-surface', c.surface || '#ffffff');
  root.style.setProperty('--shop-text', c.text || '#1b1f23');
  root.style.setProperty('--shop-text-muted', c.textMuted || '#7a7268');
}

// ---------------------------------------------------------------
// Header (+ NEW: tagline after the logo)
// ---------------------------------------------------------------
const SS_TAGLINE_SIZE_PX = { small: '11px', medium: '13px', large: '16px' };

function ssRenderThemedHeader(shop, theme) {
  const h = theme.header || {};
  const ab = h.announcementBar || {};
  const taglineHtml = h.tagline
    ? `<div class="shop-theme-header__tagline" style="color:${h.taglineColor || '#7a7268'};font-size:${SS_TAGLINE_SIZE_PX[h.taglineSize] || SS_TAGLINE_SIZE_PX.medium};">${escapeHtmlSD(h.tagline)}</div>`
    : '';
  return `
    <header class="shop-theme-header style-${h.style || 'centered'} ${h.sticky ? 'sticky' : ''}">
      ${ab.enabled && ab.text ? `
        <div class="shop-theme-announce" style="background:${ab.bgColor || '#16324f'};color:${ab.textColor || '#ffffff'};">
          ${escapeHtmlSD(ab.text)}
        </div>` : ''}
      <div class="shop-theme-header__row">
        <div class="shop-theme-header__brand">
          ${shop.logo ? `<img class="shop-theme-header__logo" src="${shop.logo}" alt="${escapeHtmlSD(shop.shopName)}">` : `<span class="shop-theme-header__name">${escapeHtmlSD(shop.shopName)}</span>`}
          ${taglineHtml}
        </div>
        ${h.showSearch ? `
          <form class="shop-theme-header__search-form" id="shopThemeSearchForm">
            <input class="shop-theme-header__search" id="shopThemeSearch" placeholder="Search ${escapeHtmlSD(shop.shopName)}…" autocomplete="off">
          </form>` : ''}
      </div>
    </header>`;
}

// ---------------------------------------------------------------
// Hero (fixed: content-detection filter + per-slide styling)
// ---------------------------------------------------------------
function ssEnsureHeroSlideshowStyles() {
  if (document.getElementById('ssHeroSlideshowStyles')) return;
  const style = document.createElement('style');
  style.id = 'ssHeroSlideshowStyles';
  style.textContent = `
    .shop-theme-hero[data-hero-mode="slideshow"] { position: relative; overflow: hidden; }
    .shop-theme-hero[data-hero-mode="slideshow"] .shop-theme-hero__slide {
      position: absolute; inset: 0; opacity: 0; visibility: hidden; display: flex;
      transition: opacity .6s ease; background-size: cover; background-position: center;
    }
    .shop-theme-hero[data-hero-mode="slideshow"] .shop-theme-hero__slide.active {
      position: relative; opacity: 1; visibility: visible; z-index: 1;
    }
    .shop-theme-hero__dots {
      position: absolute; left: 0; right: 0; bottom: 14px; z-index: 2;
      display: flex; justify-content: center; gap: 8px;
    }
    .shop-theme-hero__dot {
      width: 9px; height: 9px; border-radius: 50%; border: none; padding: 0;
      background: rgba(255,255,255,.5); cursor: pointer;
    }
    .shop-theme-hero__dot.active { background: #fff; }
  `;
  document.head.appendChild(style);
}

const SS_HERO_ALIGN_ITEMS = { left: 'flex-start', center: 'center', right: 'flex-end' };
const SS_HERO_VPOS_JUSTIFY = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };
const SS_HERO_HEADING_SIZE = {
  small: 'font-size:clamp(18px,3vw,26px);',
  medium: 'font-size:clamp(22px,3.5vw,32px);',
  large: 'font-size:clamp(24px,4vw,40px);',
};

function ssHeroSlideInnerHtml(slide) {
  const align = slide.contentAlign || 'left';
  const vpos = slide.contentPosition || 'middle';
  const contentStyle = `display:flex;flex-direction:column;align-items:${SS_HERO_ALIGN_ITEMS[align] || 'flex-start'};justify-content:${SS_HERO_VPOS_JUSTIFY[vpos] || 'center'};text-align:${align};height:100%;`;
  const headingStyle = `color:${slide.headingColor || '#ffffff'};${SS_HERO_HEADING_SIZE[slide.headingSize] || SS_HERO_HEADING_SIZE.large}`;
  const subStyle = `color:${slide.subheadingColor || '#ffffff'};`;
  const btnStyle = `background:${slide.buttonBgColor || '#f2a93b'};color:${slide.buttonTextColor || '#16324f'};border-color:${slide.buttonBgColor || '#f2a93b'};`;
  return `
    <div class="shop-theme-hero__overlay"></div>
    <div class="shop-theme-hero__content" style="${contentStyle}">
      ${slide.heading ? `<h1 style="${headingStyle}">${escapeHtmlSD(slide.heading)}</h1>` : ''}
      ${slide.subheading ? `<p style="${subStyle}">${escapeHtmlSD(slide.subheading)}</p>` : ''}
      ${slide.buttonText ? `<a href="${slide.buttonLink || '#'}" class="btn" style="${btnStyle}">${escapeHtmlSD(slide.buttonText)}</a>` : ''}
    </div>`;
}

function ssRenderThemedHero(theme) {
  const hero = theme.hero || {};
  if (hero.type === 'none' || !hero.type) return '';

  // FIX: previously only image/heading counted as "has content", so a slide
  // with just a subheading or button silently vanished — collapsing a real
  // multi-slide slideshow down to 1 slide (which never rotates).
  const slides = Array.isArray(hero.slides)
    ? hero.slides.filter((s) => s && (s.image || s.heading || s.subheading || s.buttonText))
    : [];
  if (!slides.length) return '';

  const isSlideshow = hero.type === 'slideshow' && slides.length > 1;

  if (!isSlideshow) {
    const slide = slides[0];
    return `
      <section class="shop-theme-hero" style="${slide.image ? `background-image:url('${slide.image}')` : ''}">
        ${ssHeroSlideInnerHtml(slide)}
      </section>`;
  }

  ssEnsureHeroSlideshowStyles();

  const slidesHtml = slides.map((slide, i) => `
    <div class="shop-theme-hero__slide ${i === 0 ? 'active' : ''}" data-slide-index="${i}" style="${slide.image ? `background-image:url('${slide.image}')` : ''}">
      ${ssHeroSlideInnerHtml(slide)}
    </div>`).join('');

  const dotsHtml = `
    <div class="shop-theme-hero__dots">
      ${slides.map((_, i) => `<button type="button" class="shop-theme-hero__dot ${i === 0 ? 'active' : ''}" data-dot-index="${i}" aria-label="Go to slide ${i + 1}"></button>`).join('')}
    </div>`;

  return `
    <section class="shop-theme-hero" data-hero-mode="slideshow">
      ${slidesHtml}
      ${dotsHtml}
    </section>`;
}

function ssInitHeroSlideshow() {
  if (ssHeroSlideshowInterval) {
    clearInterval(ssHeroSlideshowInterval);
    ssHeroSlideshowInterval = null;
  }

  const section = document.querySelector('.shop-theme-hero[data-hero-mode="slideshow"]');
  if (!section) return;

  const slideEls = section.querySelectorAll('.shop-theme-hero__slide');
  const dotEls = section.querySelectorAll('.shop-theme-hero__dot');
  if (slideEls.length <= 1) return;

  let current = 0;

  function goToSlide(index) {
    current = ((index % slideEls.length) + slideEls.length) % slideEls.length;
    slideEls.forEach((el, i) => el.classList.toggle('active', i === current));
    dotEls.forEach((el, i) => el.classList.toggle('active', i === current));
  }

  function resetAutoplay() {
    if (ssHeroSlideshowInterval) clearInterval(ssHeroSlideshowInterval);
    ssHeroSlideshowInterval = setInterval(() => goToSlide(current + 1), 5000);
  }

  dotEls.forEach((dot) => {
    dot.addEventListener('click', () => {
      goToSlide(Number(dot.dataset.dotIndex));
      resetAutoplay();
    });
  });

  resetAutoplay();
}

function ssRenderThemedSections(theme) {
  const sections = Array.isArray(theme.sections) ? theme.sections : [];
  return sections.map((s) => {
    if (s.type === 'rich_text') {
      if (!s.title && !s.body) return '';
      return `<section class="shop-theme-richtext wrap">${s.title ? `<h2>${escapeHtmlSD(s.title)}</h2>` : ''}${s.body ? `<p>${escapeHtmlSD(s.body)}</p>` : ''}</section>`;
    }
    if (s.type === 'featured_products') {
      return `<section class="shop-theme-section wrap"><h2>${escapeHtmlSD(s.title || 'Featured')}</h2><div class="p-grid theme-grid-cols" data-featured-section="${s.id}"></div></section>`;
    }
    if (s.type === 'all_products') {
      return `<section class="shop-theme-section wrap" id="shopProductsToolbar">
        <div class="listing-toolbar">
          <div><h2>${escapeHtmlSD(s.title || 'All products')}</h2><span class="count" id="shopProductsCount">Loading…</span></div>
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

// ---------------------------------------------------------------
// Footer (NEW: dynamic social-icon list + copyright alignment)
// ---------------------------------------------------------------
function ssRenderThemedFooter(shop, theme) {
  const f = theme.footer || {};
  const columns = Array.isArray(f.columns) ? f.columns : [];
  const socials = (Array.isArray(f.socialLinks) ? f.socialLinks : []).filter((s) => s && s.url);
  const copyAlign = f.copyrightAlign || 'center';
  const justify = copyAlign === 'left' ? 'flex-start' : copyAlign === 'right' ? 'flex-end' : 'center';

  return `
    <footer class="shop-theme-footer style-${f.style || 'simple'}">
      <div class="wrap shop-theme-footer__inner">
        ${columns.map((c) => `
          <div class="shop-theme-footer__col">
            <h4>${escapeHtmlSD(c.title || '')}</h4>
            ${(c.links || []).map((l) => `<a href="${l.url}">${escapeHtmlSD(l.label)}</a>`).join('')}
          </div>`).join('')}
        ${f.showSocial && socials.length ? `
          <div class="shop-theme-footer__social">
            ${socials.map((s) => `<a href="${s.url}" target="_blank" rel="noopener" title="${escapeHtmlSD(s.label || s.platform)}"><i class="${ssSocialIconClass(s.platform)}"></i></a>`).join('')}
          </div>` : ''}
      </div>
      <div class="shop-theme-footer__bottom" style="justify-content:${justify};">
        ${f.showPaymentNote ? `<span><i class="fa-solid fa-shield-halved"></i> Payments &amp; delivery handled securely by Six Star Suppliers</span>` : ''}
        <span>${escapeHtmlSD(f.copyrightText || `© ${new Date().getFullYear()} ${shop.shopName}`)}</span>
      </div>
    </footer>`;
}

function ssRenderThemedShop(shop) {
  const theme = shop.themeConfiguration || {};
  ssApplyThemeVars(theme);
  ssSetSiteChromeVisible(false);

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

  const contentEl = document.getElementById('shopDetailContent');
  if (!contentEl) return;

  contentEl.innerHTML =
    ssRenderThemedHeader(shop, theme) +
    ssRenderThemedHero(theme) +
    `<div class="shop-passport"><div class="shop-passport__card" id="shopPassportCard"></div></div>` +
    ssRenderThemedSections(theme) +
    reviewsSectionHtml +
    ssRenderThemedFooter(shop, theme);

  document.body.classList.add('shop-theme-active');
  document.documentElement.style.setProperty('--pgrid-cols', (theme.productGrid && theme.productGrid.columns) || 3);

  ssRenderShopPassport(shop);
  ssLoadShopProducts();
  ssLoadShopReviews();
  ssInitHeroSlideshow();

  document.getElementById('shopProductSearchForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    ssShopDetailState.search = document.getElementById('shopProductSearchInput')?.value.trim() || "";
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
    if (q) ssHandleThemeHeaderSearch(q);
  });

  ssRenderFeaturedProductSections(shop, theme);
}

// ---------------------------------------------------------------
// Header search — NEW behavior: search the shop first, scroll to the
// results, and if nothing matches, show the SAME inline "no products
// match" empty state the plain listing uses (with a clickable link to
// search the main site) instead of redirecting automatically.
// ---------------------------------------------------------------
async function ssHandleThemeHeaderSearch(q) {
  const grid = document.getElementById('shopProductsGrid');
  const toolbarSearchInput = document.getElementById('shopProductSearchInput');
  if (toolbarSearchInput) toolbarSearchInput.value = q;

  ssShopDetailState.search = q;
  ssShopDetailState.page = 1;
  ssShopDetailState.sortTouched = true; // keep results in relevance/search order, not shuffled

  if (grid) {
    await ssLoadShopProducts(); // renders results OR the "no match" state + main-site link below
    const toolbar = document.getElementById('shopProductsToolbar');
    if (toolbar) toolbar.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  // This theme has no "all products" section anywhere to show results in —
  // only now do we leave the shop, and we scope the search to it.
  const shop = ssShopDetailState.shop;
  const shopId = shop && (shop.id || shop._id);
  window.location.href = `/product.html?shop=${encodeURIComponent(shopId)}&search=${encodeURIComponent(q)}`;
}

async function ssRenderFeaturedProductSections(shop, theme) {
  const featuredEls = document.querySelectorAll('[data-featured-section]');
  if (!featuredEls.length) return;

  const sections = Array.isArray(theme.sections) ? theme.sections : [];

  for (const el of featuredEls) {
    const sectionId = el.getAttribute('data-featured-section');
    const section = sections.find((s) => s.id === sectionId);
    const ids = (section && Array.isArray(section.productIds)) ? section.productIds : [];

    if (!ids.length) {
      el.innerHTML = `<p style="color:var(--shop-text-muted,#7a7268);font-size:.85rem;">No products picked for this section yet.</p>`;
      continue;
    }

    el.innerHTML = ssSkeletonCards ? ssSkeletonCards(Math.min(ids.length, 4)) : '';

    try {
      const results = await Promise.all(ids.map((id) => SS_API.getProduct(id).catch(() => null)));
      const products = results.filter(Boolean).map((r) => r.product || r);
      if (!products.length) {
        el.innerHTML = `<p style="color:var(--shop-text-muted,#7a7268);font-size:.85rem;">These products are no longer available.</p>`;
        continue;
      }
      el.innerHTML = products.map(ssProductCard).join('');
    } catch (err) {
      console.error('ssRenderFeaturedProductSections failed:', err);
      el.innerHTML = '';
    }
  }
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
  if (bannerWrap) {
    bannerWrap.innerHTML = shop.banner
      ? `<img class="shop-hero__banner" src="${shop.banner}" alt="${escapeHtmlSD(shop.shopName)} banner">`
      : `<div class="shop-hero__banner-fallback"></div>`;
  }

  const passportCard = document.getElementById("shopPassportCard");
  if (!passportCard) return;

  const initial = (shop.shopName || "?").trim().charAt(0).toUpperCase();
  const memberSince = shop.createdAt ? new Date(shop.createdAt).getFullYear() : "—";

  passportCard.innerHTML = `
    <div class="shop-passport__logo">${shop.logo ? `<img src="${shop.logo}" alt="">` : initial}</div>
    <div class="shop-passport__info">
      <div class="shop-passport__name-row">
        <span class="shop-passport__name">${escapeHtmlSD(shop.shopName)}</span>
        ${shop.verificationStatus === "verified" ? `<span class="shop-verified"><i class="fa-solid fa-check"></i> Verified</span>` : ""}
      </div>
      ${shop.businessCategory ? `<div class="shop-passport__category">${escapeHtmlSD(shop.businessCategory)}</div>` : ""}
      ${shop.description ? `<p class="shop-passport__desc">${escapeHtmlSD(shop.description)}</p>` : ""}
      <div class="shop-passport__stats">
        <div class="shop-passport__stat"><strong id="shopProductCountStat">—</strong><span>Products</span></div>
        <div class="shop-passport__stat">
          <strong id="shopAvgRatingStat">${(shop.ratingsAverage || 0).toFixed(1)} <i class="fa-solid fa-star" style="font-size:.7em;color:var(--sun)"></i></strong>
          <span id="shopReviewCountStat">${shop.ratingsCount || 0} review${shop.ratingsCount === 1 ? "" : "s"}</span>
        </div>
        <div class="shop-passport__stat"><strong>${memberSince}</strong><span>On Six Star since</span></div>
        ${shop.businessHours ? `<div class="shop-passport__stat"><strong style="font-size:.82rem;">${escapeHtmlSD(shop.businessHours)}</strong><span>Hours</span></div>` : ""}
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

// ---------------------------------------------------------------
// Products — NEW: no-results state includes a clickable "search the
// main site" link whenever a search term is active.
// ---------------------------------------------------------------
async function ssLoadShopProducts() {
  const grid = document.getElementById("shopProductsGrid");
  const pagination = document.getElementById("shopProductsPagination");

  if (!grid) return;

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

    const countStatEl = document.getElementById("shopProductCountStat");
    if (countStatEl) countStatEl.textContent = total;

    const countLabelEl = document.getElementById("shopProductsCount");
    if (countLabelEl) countLabelEl.textContent = `${total} product${total === 1 ? "" : "s"}`;

    if (!products.length) {
      const activeSearch = ssShopDetailState.search;
      const noResultsMsg = activeSearch
        ? `No products match "${escapeHtmlSD(activeSearch)}" in this shop.`
        : `This shop hasn't listed anything matching your filters.`;
      const searchFallback = activeSearch
        ? `<p class="shop-search-fallback">
             <a class="shop-search-fallback__link" href="/product.html?search=${encodeURIComponent(activeSearch)}">
               <i class="fa-solid fa-magnifying-glass"></i> Search "${escapeHtmlSD(activeSearch)}" across all of Six Star Suppliers
             </a>
           </p>`
        : "";

      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1;">
          <i class="fa-solid fa-box-open"></i>
          <h3>No products here yet</h3>
          <p>${noResultsMsg}</p>
          ${searchFallback}
        </div>`;
      if (pagination) pagination.innerHTML = "";
      return;
    }

    if (ssShouldShuffleShopListing()) products = ssShuffle(products);

    grid.innerHTML = products.map(ssProductCard).join("");
    if (pagination) ssRenderShopProductsPagination(pagination, res.page || 1, res.pages || 1);
  } catch (err) {
    console.error("ssLoadShopProducts failed:", err);
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <h3>Couldn't load products</h3>
        <p>Check your connection and try again.</p>
      </div>`;
    if (pagination) pagination.innerHTML = "";
  }
}

function ssRenderShopProductsPagination(el, page, pages) {
  if (!el) return;
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
      const toolbar = document.getElementById("shopProductsToolbar");
      if (toolbar) window.scrollTo({ top: toolbar.offsetTop - 100, behavior: "smooth" });
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

  if (!listEl && !summaryEl) return;

  if (listEl) listEl.innerHTML = `<p style="color:var(--ink-faint);">Loading reviews…</p>`;

  try {
    const res = await SS_API.getShopReviews(shop.id || shop._id);
    const reviews = res.reviews || [];
    const count = shop.ratingsCount || reviews.length;

    if (summaryEl) {
      summaryEl.innerHTML = `
        ${ssStarsHtml(shop.ratingsAverage || 0, 16)}
        <strong style="margin-left:6px;">${(shop.ratingsAverage || 0).toFixed(1)}</strong>
        <span style="color:var(--ink-faint);font-size:12.5px;margin-left:4px;">(${count} review${count === 1 ? "" : "s"})</span>
      `;
    }

    ssUpdateShopRatingStats(shop);

    if (listEl) {
      if (!reviews.length) {
        listEl.innerHTML = `<p style="color:var(--ink-faint);">No reviews yet — be the first to review this shop.</p>`;
      } else {
        listEl.innerHTML = reviews.map(r => `
          <div class="shop-review-item">
            <div class="shop-review-item__head">
              <span class="shop-review-item__name">${escapeHtmlSD(r.buyer?.name || "Buyer")}</span>
              ${ssStarsHtml(r.rating, 12)}
            </div>
            ${r.comment ? `<p class="shop-review-item__comment">${escapeHtmlSD(r.comment)}</p>` : ""}
            <span class="shop-review-item__date">${new Date(r.createdAt).toLocaleDateString()}</span>
          </div>
        `).join("");
      }
    }
  } catch (err) {
    console.error("ssLoadShopReviews failed:", err);
    if (listEl) listEl.innerHTML = `<p style="color:var(--ink-faint);">Couldn't load reviews.</p>`;
  }

  ssRenderShopReviewForm();
}

function ssRenderShopReviewForm() {
  const wrap = document.getElementById("shopReviewFormWrap");
  if (!wrap) return;

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

function escapeHtmlSD(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

document.addEventListener("DOMContentLoaded", () => {
  ssInitShopDetail();

  document.getElementById("shopProductSearchForm")?.addEventListener("submit", e => {
    e.preventDefault();
    ssShopDetailState.search = document.getElementById("shopProductSearchInput")?.value.trim() || "";
    ssShopDetailState.page = 1;
    ssLoadShopProducts();
  });

  document.getElementById("shopProductSort")?.addEventListener("change", e => {
    ssShopDetailState.sort = e.target.value;
    ssShopDetailState.sortTouched = true;
    ssShopDetailState.page = 1;
    ssLoadShopProducts();
  });
});