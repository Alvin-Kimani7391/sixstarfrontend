document.addEventListener("DOMContentLoaded", async () => {
  // ---------------------------------------------------------------
  // Email-verification guard.
  // ---------------------------------------------------------------
  if (window.SS_AUTH && typeof SS_AUTH.get === "function") {
    const cachedUser = SS_AUTH.get();
    if (cachedUser && cachedUser.isVerified === false) {
      location.href = `verify-email.html?next=${encodeURIComponent("index.html")}`;
      return;
    }
  }

  ssRenderSubcategoryGrid("categoryGrid", 9);
  ssRenderMegaMenu("megaMenu");
  ssRenderAdSlot("heroAd", "homepage_hero", { interval: 5000, aspect: "21/9" });
  ssRenderAdSlot("bannerAd", "homepage_banner", { interval: 6000, aspect: "5/1" });

  // Real, backend-driven Flash Sale rail — live countdown to midnight when
  // something's active, countdown to the next 2:00 PM when nothing is.
  ssRenderFlashSale("flashSaleSection", "flashSaleProducts", "flashSaleTimer");

  const hot = document.getElementById("hotDeals");
  const fresh = document.getElementById("newArrivals");
  const topSelling = document.getElementById("topSelling");
  const catalog = document.getElementById("catalogPreview");
  const wholesalePreview = document.getElementById("wholesalePreview");

  const CATALOG_PAGE_SIZE = 8;

  hot.innerHTML = ssSkeletonCards(4);
  fresh.innerHTML = ssSkeletonCards(4);
  topSelling.innerHTML = ssSkeletonCards(4);
  catalog.innerHTML = ssSkeletonCards(CATALOG_PAGE_SIZE);
  if (wholesalePreview) wholesalePreview.innerHTML = ssSkeletonCards(4);

  function cacheAndRender(el, products, empty) {
    if (!products.length) { el.innerHTML = `<p class="form-hint">${empty}</p>`; return; }
    products.forEach(p => { window.__ssProductCache[p.id] = p; });
    el.innerHTML = products.map(ssProductCard).join("");
  }

  function ssStockOf(p) {
    return Number(p.stock ?? p.stockQuantity ?? p.quantity ?? p.qty ?? 0) || 0;
  }

  try {
    const hotRes = await SS_API.getProducts({ hotDeals: true, page: 1 });
    cacheAndRender(hot, (hotRes.products || hotRes.data || hotRes || []).slice(0, 10), "No hot deals right now — check back soon.");
  } catch (_) { hot.innerHTML = `<p class="form-hint">Couldn't load hot deals. <a href="index.html">Retry</a></p>`; }

  try {
    const newRes = await SS_API.getProducts({ sort: "newest", page: 1 });
    cacheAndRender(fresh, (newRes.products || newRes.data || newRes || []).slice(0, 10), "No new arrivals yet.");
  } catch (_) { fresh.innerHTML = `<p class="form-hint">Couldn't load new arrivals.</p>`; }

  if (wholesalePreview) {
    try {
      const wholesaleRes = await SS_API.getProducts({
        sellerRole: 'wholesaler',
        status: 'active',
        limit: 10
      });
      let wholesaleProducts = wholesaleRes.products || wholesaleRes.data || wholesaleRes || [];

      if (!wholesaleProducts.length) {
        const allRes = await SS_API.getProducts({ status: 'active', limit: 50 });
        const allProducts = allRes.products || allRes.data || (Array.isArray(allRes) ? allRes : []);
        wholesaleProducts = allProducts.filter(p =>
          p.sellerRole === 'wholesaler' ||
          p.sellerRole === 'wholesale' ||
          p.seller?.role === 'wholesaler'
        );
      }

      wholesaleProducts.forEach(p => { window.__ssProductCache[p.id] = p; });
      wholesalePreview.innerHTML = wholesaleProducts.length
        ? wholesaleProducts.slice(0, 10).map(ssProductCard).join("")
        : `<p class="form-hint">No wholesale products available right now.</p>`;
    } catch (_) {
      wholesalePreview.innerHTML = `<p class="form-hint">Couldn't load wholesale products.</p>`;
    }
  }

  try {
    const topRes = await SS_API.getProducts({ page: 1, limit: 40 });
    let list = topRes.products || topRes.data || topRes || [];
    list = list.slice().sort((a, b) => ssStockOf(b) - ssStockOf(a));
    list = list.slice(0, 20);
    list = ssShuffle(list).slice(0, 10);
    cacheAndRender(topSelling, list, "No top-selling products right now.");
  } catch (_) { topSelling.innerHTML = `<p class="form-hint">Couldn't load top-selling products.</p>`; }

  const catalogLoadMoreWrap = document.getElementById("catalogLoadMoreWrap");
  const catalogLoadMoreBtn = document.getElementById("catalogLoadMoreBtn");

  try {
    const allRes = await SS_API.getProducts({ page: 1, limit: CATALOG_PAGE_SIZE });
    const products = (allRes.products || allRes.data || allRes || []).slice(0, CATALOG_PAGE_SIZE);
    cacheAndRender(catalog, products, "No products available yet.");
    if (catalogLoadMoreWrap) {
      catalogLoadMoreWrap.style.display = products.length ? "flex" : "none";
    }
  } catch (_) {
    catalog.innerHTML = `<p class="form-hint">Couldn't load products. Check the API_BASE in js/config.js.</p>`;
    if (catalogLoadMoreWrap) catalogLoadMoreWrap.style.display = "none";
  }

  if (catalogLoadMoreBtn) {
    catalogLoadMoreBtn.addEventListener("click", () => {
      catalogLoadMoreBtn.classList.add("is-loading");
      catalogLoadMoreBtn.disabled = true;
      location.href = "product.html";
    });
  }
});