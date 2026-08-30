// Fetches a random slice of the catalog instead of always page 1, so
// products aren't limited to whatever the backend's default sort puts on
// the first page (typically newest-first). Does a cheap limit=1 call
// first to learn the total count, then jumps to a random page sized
// `poolSize`, so older products get a real chance to surface once we
// shuffle client-side.
async function ssFetchRandomPool(baseParams, poolSize) {
  try {
    const countRes = await SS_API.getProducts({ ...baseParams, page: 1, limit: 1 });
    const total = countRes.total ?? countRes.count ?? 0;
    if (!total) return [];
    const totalPages = Math.max(1, Math.ceil(total / poolSize));
    const randomPage = Math.floor(Math.random() * totalPages) + 1;
    const res = await SS_API.getProducts({ ...baseParams, page: randomPage, limit: poolSize });
    return res.products || res.data || res || [];
  } catch (_) {
    return [];
  }
}

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

  // "Top selling Categories" tile grid — capped at 8 so every phone size
  // renders it as a clean 4-across, 2-row block (see #categoryGrid rules
  // in theme.css).
  ssRenderSubcategoryGrid("categoryGrid", 12);
  ssRenderMegaMenu("megaMenu");

  // Hero ad carousel just under the header — was interval:5000 (felt slow),
  // now a brisker but still comfortable ~3.6s per slide.
  ssRenderAdSlot("heroAd", "homepage_hero", { interval: 3600, aspect: "21/9" });
  ssRenderAdSlot("bannerAd", "homepage_banner", { interval: 6000, aspect: "5/1" });

  // Real, backend-driven Flash Sale rail — live countdown to midnight when
  // something's active, countdown to the next 2:00 PM when nothing is.
  // NOTE: deliberately NOT shuffled — ssRenderFlashSale() reads
  // flashSales[0] to drive the "ends in / starts in" timer, so the array
  // order is functional, not cosmetic.
  ssRenderFlashSale("flashSaleSection", "flashSaleProducts", "flashSaleTimer");

  const hot = document.getElementById("hotDeals");
  const fresh = document.getElementById("newArrivals");
  const topSelling = document.getElementById("topSelling");
  const catalog = document.getElementById("catalogPreview");
  const wholesalePreview = document.getElementById("wholesalePreview");

  const CATALOG_PAGE_SIZE = 12;

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

  // ---------------------------------------------------------------
  // Hot Deals — pulled from a random page of the hotDeals pool (not
  // always page 1) so older hot-deal products get a fair chance to
  // surface, then shuffled client-side before slicing to rail size.
  // ---------------------------------------------------------------
  try {
    const hotPool = await ssFetchRandomPool({ hotDeals: true }, 30);
    const hotProducts = ssShuffle(hotPool).slice(0, 10);
    cacheAndRender(hot, hotProducts, "No hot deals right now — check back soon.");
  } catch (_) { hot.innerHTML = `<p class="form-hint">Couldn't load hot deals. <a href="index.html">Retry</a></p>`; }

  // Hot Deals now auto-advances on its own (a touch faster than a normal
  // reading pace) but a tap/touch/hover pauses it and hands control back
  // to the person, exactly like the arrow controls below.
  ssAutoScrollRail("hotDeals", 2000);
  ssEnableScrollArrows("hotDeals");

  // ---------------------------------------------------------------
  // New Arrivals — intentionally left in "newest first" order.
  // Shuffling this rail would defeat its purpose (it exists specifically
  // to show what's most recent), so sort=newest is respected as-is.
  // ---------------------------------------------------------------
  try {
    const newRes = await SS_API.getProducts({ sort: "newest", page: 1 });
    cacheAndRender(fresh, (newRes.products || newRes.data || newRes || []).slice(0, 10), "No new arrivals yet.");
  } catch (_) { fresh.innerHTML = `<p class="form-hint">Couldn't load new arrivals.</p>`; }
  ssEnableScrollArrows("newArrivals");

  // ---------------------------------------------------------------
  // Wholesale preview — pulled from a random page of the wholesaler pool
  // (not always page 1) so older wholesale listings get a fair chance to
  // surface, then shuffled before caching/rendering.
  // ---------------------------------------------------------------
  if (wholesalePreview) {
    try {
      let wholesaleProducts = await ssFetchRandomPool({ sellerRole: 'wholesaler', status: 'active' }, 30);

      if (!wholesaleProducts.length) {
        const allRes = await SS_API.getProducts({ status: 'active', limit: 50 });
        const allProducts = allRes.products || allRes.data || (Array.isArray(allRes) ? allRes : []);
        wholesaleProducts = allProducts.filter(p =>
          p.sellerRole === 'wholesaler' ||
          p.sellerRole === 'wholesale' ||
          p.seller?.role === 'wholesaler'
        );
      }

      wholesaleProducts = ssShuffle(wholesaleProducts);
      wholesaleProducts.forEach(p => { window.__ssProductCache[p.id] = p; });
      wholesalePreview.innerHTML = wholesaleProducts.length
        ? wholesaleProducts.slice(0, 10).map(ssProductCard).join("")
        : `<p class="form-hint">No wholesale products available right now.</p>`;
    } catch (_) {
      wholesalePreview.innerHTML = `<p class="form-hint">Couldn't load wholesale products.</p>`;
    }
    ssEnableScrollArrows("wholesalePreview");
  }

  // ---------------------------------------------------------------
  // Top Selling — pulled from a random page of the full catalog (not
  // always page 1), sorted by stock to find the top movers within that
  // pool, then shuffled before slicing to rail size.
  // ---------------------------------------------------------------
  try {
    let list = await ssFetchRandomPool({}, 60);
    list = list.slice().sort((a, b) => ssStockOf(b) - ssStockOf(a));
    list = list.slice(0, 20);
    list = ssShuffle(list).slice(0, 10);
    cacheAndRender(topSelling, list, "No top-selling products right now.");
  } catch (_) { topSelling.innerHTML = `<p class="form-hint">Couldn't load top-selling products.</p>`; }
  ssEnableScrollArrows("topSelling");

  // ---------------------------------------------------------------
  // Catalog preview (homepage "Our Catalog" strip) — pulled from a random
  // page of the full catalog (not always page 1) so older products get a
  // fair chance to surface, then shuffled for a fresher feel on every
  // visit. The "Browse All Products" button still just routes to
  // product.html, which does its own thing (see products.js).
  // ---------------------------------------------------------------
  const catalogLoadMoreWrap = document.getElementById("catalogLoadMoreWrap");
  const catalogLoadMoreBtn = document.getElementById("catalogLoadMoreBtn");

  try {
    const pool = await ssFetchRandomPool({}, CATALOG_PAGE_SIZE * 3);
    const products = ssShuffle(pool).slice(0, CATALOG_PAGE_SIZE);
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
    ssShowLoadingOverlay();
    // tiny delay purely so the spinner is perceptible before the
    // page unloads — kept short so navigation still feels instant
    setTimeout(() => { location.href = "product.html"; }, 260);
  });
}

  // Flash Sale's rail renders asynchronously inside ssRenderFlashSale()
  // itself (it may re-render more than once as its countdown flips live/
  // ends), so its arrow controls are wired from inside that function's
  // own re-render path — see the ssRenderFlashSale patch in ui.js.
});