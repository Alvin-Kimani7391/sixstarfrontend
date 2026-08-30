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
  ssRenderSubcategoryGrid("categoryGrid", 8);
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
  // Hot Deals — no meaningful backend order (it's just "isHotDeal: true"),
  // so shuffle the full result before slicing to the rail size. This does
  // NOT touch the hotDeals filter itself — filtering already happened in
  // the API call above; we're only reordering what came back.
  // ---------------------------------------------------------------
  try {
    const hotRes = await SS_API.getProducts({ hotDeals: true, page: 1 });
    const hotProducts = ssShuffle(hotRes.products || hotRes.data || hotRes || []).slice(0, 10);
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
  // Wholesale preview — no meaningful order either way, so shuffle
  // whichever set we ended up with (direct query or the manual filter
  // fallback) before caching/rendering.
  // ---------------------------------------------------------------
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
  // Top Selling — already shuffled (unchanged): pull the top-stock pool,
  // then randomize which 10 of the top 20 show up this load.
  // ---------------------------------------------------------------
  try {
    const topRes = await SS_API.getProducts({ page: 1, limit: 40 });
    let list = topRes.products || topRes.data || topRes || [];
    list = list.slice().sort((a, b) => ssStockOf(b) - ssStockOf(a));
    list = list.slice(0, 20);
    list = ssShuffle(list).slice(0, 10);
    cacheAndRender(topSelling, list, "No top-selling products right now.");
  } catch (_) { topSelling.innerHTML = `<p class="form-hint">Couldn't load top-selling products.</p>`; }
  ssEnableScrollArrows("topSelling");

  // ---------------------------------------------------------------
  // Catalog preview (homepage "Our Catalog" strip) — plain page-1 fetch
  // with no filter/sort applied, so shuffle it for a fresher feel on
  // every visit. The "Browse All Products" button still just routes to
  // product.html, which does its own thing (see products.js).
  // ---------------------------------------------------------------
  const catalogLoadMoreWrap = document.getElementById("catalogLoadMoreWrap");
  const catalogLoadMoreBtn = document.getElementById("catalogLoadMoreBtn");

  try {
    const allRes = await SS_API.getProducts({ page: 1, limit: CATALOG_PAGE_SIZE });
    const products = ssShuffle(allRes.products || allRes.data || allRes || []).slice(0, CATALOG_PAGE_SIZE);
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