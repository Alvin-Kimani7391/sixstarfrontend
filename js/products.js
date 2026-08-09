(function () {
  const grid = document.getElementById("productGrid");
  const loadMoreWrap = document.getElementById("loadMoreWrap");
  const loadMoreBtn = document.getElementById("loadMoreBtn");
  const loadMoreLabel = document.getElementById("loadMoreLabel");
  const loadMoreCount = document.getElementById("loadMoreCount");
  const resultCount = document.getElementById("resultCount");
  const catCascadeEl = document.getElementById("catCascade");
  const minInput = document.getElementById("f-min");
  const maxInput = document.getElementById("f-max");
  const hotChip = document.getElementById("f-hotdeals");
  const sortSelect = document.getElementById("f-sort");
  const filtersAside = document.querySelector(".filters");
  const wrapEl = document.querySelector(".wrap.listing");
  const filterBanner = document.getElementById("filterBanner");

  // Flash Sale mode elements
  const normalSection = document.getElementById("normalListingSection");
  const flashSection = document.getElementById("flashSaleListingSection");
  const flashGrid = document.getElementById("flashSaleGrid");
  const flashResultCount = document.getElementById("flashSaleResultCount");
  const flashTimer = document.getElementById("flashSaleListingTimer");

  const PAGE_SIZE = 8; // products per batch

  function readParams() {
    const p = new URLSearchParams(location.search);
    return {
      category: p.get("category") || "", // category _id, not a slug — always the deepest node picked
      search: p.get("search") || "",
      minPrice: p.get("minPrice") || "",
      maxPrice: p.get("maxPrice") || "",
      hotDeals: p.get("hotDeals") === "true",
      flashSale: p.get("flashSale") === "true",
      sort: p.get("sort") || "" // "", "newest", "popular", "price_asc", "price_desc"
    };
  }

  let state = readParams();

  // Full category TREE (parent -> children -> grandchildren...), used to
  // drive the cascading Category/Sub-category/Sub-sub-category selects in
  // the sidebar and to resolve the filter banner's category display path.
  let categoryTree = [];

  // Pagination/load-more bookkeeping — separate from `state` (which only
  // holds filters) so switching filters can freely reset it.
  let page = 1;
  let totalCount = 0;
  let loadedCount = 0;
  let isLoadingMore = false;

  // "Top Selling" (?sort=popular) has no guaranteed backend meaning — the
  // homepage's own Top Selling rail (home.js) computes it client-side as
  // "highest stock, then shuffled", explicitly calling it a stand-in for
  // real sales data. Rather than gamble on the backend understanding
  // sort=popular, this page mirrors that same definition but applies it
  // properly to the full listing: fetch a larger batch (respecting
  // whatever category/price/search filters are also active), sort by
  // stock, then paginate through that in memory. topSellingPool is null
  // whenever a normal backend-paginated sort is in effect.
  const TOP_SELLING_BATCH_SIZE = 60;
  let topSellingPool = null;

  // Flash Sale listing's own countdown — separate from ui.js's
  // window.__ssFlashSaleCountdownTimer (which drives the homepage rail),
  // since both could theoretically be alive if this page were ever
  // embedded somewhere unusual. Always cleared on mode exit.
  let flashSaleCountdownTimer = null;

  function isFlashSaleMode() { return !!state.flashSale; }

  function ssStockOf(p) {
    return Number(p.stock ?? p.stockQuantity ?? p.quantity ?? p.qty ?? 0) || 0;
  }

  function syncFormToState() {
    minInput.value = state.minPrice || "";
    maxInput.value = state.maxPrice || "";
    sortSelect.value = state.sort || "";
    hotChip.dataset.active = state.hotDeals ? "true" : "false";
    hotChip.classList.toggle("active", state.hotDeals);
    renderCascade();
  }

  function pushURL() {
    const p = new URLSearchParams();
    Object.entries(state).forEach(([k, v]) => {
      if (v !== "" && v !== false) p.set(k, v);
    });
    history.pushState({}, "", "product.html" + (p.toString() ? "?" + p.toString() : ""));
  }

  // Renders the cascading category selects (main -> sub -> sub-sub, however
  // deep a given branch actually goes) from the cached tree. Safe to call
  // any time — it's a no-op until the tree has loaded.
  function renderCascade() {
    if (!catCascadeEl || !categoryTree.length) return;
    ssRenderCategoryCascade(catCascadeEl, categoryTree, {
      selectedId: state.category || "",
      onChange: (id) => {
        // A cascade pick is a complete, intentional choice — filter
        // immediately rather than waiting on "Apply filters" (that button
        // now only governs price range + sort).
        state.category = id;
        pushURL();
        load();
      }
    });
  }

  async function populateCategories() {
    try {
      const data = await SS_API.getCategoryTree();
      categoryTree = Array.isArray(data) ? data : (data.categories || data.tree || []);
    } catch (_) {
      categoryTree = [];
    }
    renderCascade();
    renderFilterBanner();
  }

  // ============================================================
  // DYNAMIC FILTER BANNER — one removable chip per active filter, so
  // combinations (e.g. a category PLUS a search term) are all visible at
  // once. Special filters (Flash Sale / Hot Deals / New Arrivals / Top
  // Selling) get their own colour + icon, matching the homepage rail they
  // were clicked from, so the visual language carries through from click
  // to landing. Replaces the old category-only banner.
  // ============================================================
  function renderFilterBanner() {
    const chips = [];

    if (state.flashSale) {
      chips.push({ key: "flashSale", type: "flash", icon: "fa-bolt-lightning", label: "Flash Sale", sub: "Today's live flash deals" });
    }
    if (state.hotDeals) {
      chips.push({ key: "hotDeals", type: "hot", icon: "fa-fire", label: "Hot Deals", sub: "Trending right now" });
    }
    if (state.sort === "newest") {
      chips.push({ key: "sort", type: "new", icon: "fa-gift", label: "New Arrivals", sub: "Freshly added" });
    }
    if (state.sort === "popular") {
      chips.push({ key: "sort", type: "top", icon: "fa-crown", label: "Top Selling", sub: "Customer favourites" });
    }
    if (state.category) {
      const path = ssFindCategoryPath(categoryTree, state.category);
      const label = (path && path.length) ? path.map(n => n.name).join(" › ") : "Selected category";
      chips.push({ key: "category", type: "category", icon: "fa-layer-group", label, sub: "" });
    }
    if (state.search) {
      chips.push({ key: "search", type: "search", icon: "fa-magnifying-glass", label: `"${state.search}"`, sub: "" });
    }

    if (!chips.length) {
      filterBanner.style.display = "none";
      filterBanner.innerHTML = "";
      return;
    }

    filterBanner.style.display = "flex";
    filterBanner.innerHTML = chips.map(c => `
      <div class="filter-chip filter-chip--${c.type}">
        <i class="fa-solid ${c.icon}"></i>
        <span class="filter-chip__text">
          <strong>${c.label}</strong>${c.sub ? `<small>${c.sub}</small>` : ""}
        </span>
        <button type="button" class="filter-chip__clear" data-clear="${c.key}" aria-label="Remove filter">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    `).join("");

    filterBanner.querySelectorAll("[data-clear]").forEach(btn => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.clear;
        if (key === "sort") state.sort = "";
        else if (key === "category") state.category = "";
        else if (key === "search") state.search = "";
        else state[key] = false;
        pushURL();
        load();
      });
    });
  }

  /* ---------- Load More button state ---------- */

  function setLoadMoreBusy(busy) {
    isLoadingMore = busy;
    loadMoreBtn.classList.toggle("is-loading", busy);
    loadMoreBtn.disabled = busy;
    loadMoreLabel.textContent = busy ? "Loading" : "Load More";
  }

  function refreshLoadMoreUI() {
    if (!totalCount || loadedCount >= totalCount) {
      loadMoreWrap.style.display = "none";
      return;
    }
    loadMoreWrap.style.display = "flex";
    loadMoreCount.textContent = `Showing ${loadedCount} of ${totalCount} products`;
  }

  function fetchPage(pageNum) {
    return SS_API.getProducts({
      category: state.category || undefined,
      search: state.search || undefined,
      minPrice: state.minPrice || undefined,
      maxPrice: state.maxPrice || undefined,
      hotDeals: state.hotDeals || undefined,
      sort: state.sort || undefined,
      page: pageNum,
      limit: PAGE_SIZE
    });
  }

  // Fetches a larger batch (respecting the active category/price/search/
  // hotDeals filters) and sorts it by stock descending — see the
  // TOP_SELLING_BATCH_SIZE comment above for why this exists instead of
  // trusting a backend sort=popular.
  async function fetchTopSellingPool() {
    const res = await SS_API.getProducts({
      category: state.category || undefined,
      search: state.search || undefined,
      minPrice: state.minPrice || undefined,
      maxPrice: state.maxPrice || undefined,
      hotDeals: state.hotDeals || undefined,
      page: 1,
      limit: TOP_SELLING_BATCH_SIZE
    });
    const products = res.products || res.data || (Array.isArray(res) ? res : []);
    return products.slice().sort((a, b) => ssStockOf(b) - ssStockOf(a));
  }

  // ============================================================
  // FLASH SALE LISTING MODE
  // Reuses ssFlashSaleCard() and ssFmtCountdown() from ui.js (the exact
  // same rendering the homepage rail uses) instead of duplicating that
  // logic here. No pagination — /flash-sales/today already returns the
  // whole day's set in one call.
  // ============================================================
  function stopFlashSaleCountdown() {
    if (flashSaleCountdownTimer) {
      clearInterval(flashSaleCountdownTimer);
      flashSaleCountdownTimer = null;
    }
  }

  async function loadFlashSaleListing() {
    stopFlashSaleCountdown();
    flashGrid.innerHTML = ssSkeletonCards(PAGE_SIZE);
    flashResultCount.textContent = "Loading today's Flash Sale…";
    flashTimer.style.display = "";
    flashTimer.innerHTML = `<i class="fa-regular fa-clock"></i> --h : --m : --s`;

    let flashSales = [];
    try {
      const res = await SS_API.getTodayFlashSales();
      flashSales = res.flashSales || res.data || res || [];
    } catch (err) {
      flashGrid.innerHTML = `<div class="empty-state">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <h3>Couldn't load Flash Sale</h3>
        <p>${err.message}</p>
      </div>`;
      flashResultCount.textContent = "";
      flashTimer.style.display = "none";
      return;
    }

    if (!flashSales.length) {
      flashGrid.innerHTML = `<div class="empty-state">
        <i class="fa-solid fa-bolt-lightning"></i>
        <h3>No Flash Sale scheduled for today</h3>
        <p>Check back tomorrow at 2:00 PM, or browse the full catalog instead.</p>
      </div>`;
      flashResultCount.textContent = "0 items";
      flashTimer.style.display = "none";
      return;
    }

    flashSales.forEach(fs => {
      const p = fs.product;
      if (p && (p.id || p._id)) window.__ssProductCache[p.id || p._id] = p;
    });
    flashGrid.innerHTML = flashSales.map(ssFlashSaleCard).join("");
    flashResultCount.textContent = `${flashSales.length} item${flashSales.length === 1 ? "" : "s"} in today's Flash Sale`;

    const liveOnes = flashSales.filter(fs => fs.isLive);
    if (liveOnes.length) {
      const endAt = new Date(liveOnes[0].endAt);
      const tick = () => {
        const diff = endAt - new Date();
        if (diff <= 0) { loadFlashSaleListing(); return; }
        flashTimer.innerHTML = `<i class="fa-regular fa-clock"></i> Ends in ${ssFmtCountdown(diff)}`;
      };
      tick();
      flashSaleCountdownTimer = setInterval(tick, 1000);
    } else {
      const startAt = new Date(flashSales[0].startAt); // sorted by startAt from backend
      const tick = () => {
        const diff = startAt - new Date();
        if (diff <= 0) { loadFlashSaleListing(); return; }
        flashTimer.innerHTML = `<i class="fa-regular fa-clock"></i> Starts in ${ssFmtCountdown(diff)}`;
      };
      tick();
      flashSaleCountdownTimer = setInterval(tick, 1000);
    }
  }

  // ============================================================
  // Full (re)load — used on first load, filter changes, and back/forward
  // nav. Branches into Flash Sale mode, Top Selling mode, or the normal
  // backend-paginated listing.
  // ============================================================
  async function load() {
    syncFormToState();
    renderFilterBanner();

    if (isFlashSaleMode()) {
      filtersAside.style.display = "none";
      wrapEl.classList.add("listing--full");
      normalSection.style.display = "none";
      flashSection.style.display = "block";
      await loadFlashSaleListing();
      return;
    }

    filtersAside.style.display = "";
    wrapEl.classList.remove("listing--full");
    flashSection.style.display = "none";
    normalSection.style.display = "block";
    stopFlashSaleCountdown();

    page = 1;
    loadedCount = 0;
    totalCount = 0;
    topSellingPool = null;
    loadMoreWrap.style.display = "none";
    grid.innerHTML = ssSkeletonCards(PAGE_SIZE);
    resultCount.textContent = "Loading products…";

    try {
      let products;

      if (state.sort === "popular") {
        topSellingPool = await fetchTopSellingPool();
        totalCount = topSellingPool.length;
        products = topSellingPool.slice(0, PAGE_SIZE);
      } else {
        const res = await fetchPage(page);
        products = res.products || res.data || (Array.isArray(res) ? res : []);
        totalCount = res.total ?? res.count ?? products.length;
      }

      if (!products.length) {
        grid.innerHTML = `<div class="empty-state">
          <i class="fa-solid fa-box-open"></i>
          <h3>No products match your filters</h3>
          <p>Try clearing a filter or searching a different term.</p>
        </div>`;
        resultCount.textContent = "0 results";
        return;
      }

      products.forEach(p => { window.__ssProductCache[p.id] = p; });
      grid.innerHTML = products.map(ssProductCard).join("");
      loadedCount = products.length;
      resultCount.textContent = `${totalCount} product${totalCount === 1 ? "" : "s"} found`;
      refreshLoadMoreUI();
    } catch (err) {
      grid.innerHTML = `<div class="empty-state">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <h3>Couldn't load products</h3>
        <p>${err.message}</p>
      </div>`;
      resultCount.textContent = "";
      loadMoreWrap.style.display = "none";
    }
  }

  // Appends the next batch onto the existing grid instead of replacing it.
  // In Top Selling mode this slices the next chunk out of the already-
  // fetched, already-sorted topSellingPool instead of calling the backend
  // again — the pool covers TOP_SELLING_BATCH_SIZE items in one request.
  async function loadMore() {
    if (isLoadingMore || loadedCount >= totalCount) return;
    setLoadMoreBusy(true);

    try {
      let products;

      if (topSellingPool) {
        products = topSellingPool.slice(loadedCount, loadedCount + PAGE_SIZE);
      } else {
        const nextPage = page + 1;
        const res = await fetchPage(nextPage);
        products = res.products || res.data || (Array.isArray(res) ? res : []);
        page = nextPage;
      }

      if (products.length) {
        products.forEach(p => { window.__ssProductCache[p.id] = p; });
        grid.insertAdjacentHTML("beforeend", products.map(ssProductCard).join(""));
        loadedCount += products.length;
      } else {
        // Backend says there's more (totalCount) but returned nothing — stop asking.
        totalCount = loadedCount;
      }
      refreshLoadMoreUI();
    } catch (err) {
      ssToast("Couldn't load more products", "fa-circle-exclamation");
    } finally {
      setLoadMoreBusy(false);
    }
  }

  loadMoreBtn.addEventListener("click", loadMore);

  // "Apply filters" now only governs price range + sort — category
  // filtering happens immediately as the cascade is used (see
  // renderCascade()'s onChange above).
  document.getElementById("f-apply").addEventListener("click", () => {
    state.minPrice = minInput.value;
    state.maxPrice = maxInput.value;
    state.sort = sortSelect.value;
    pushURL();
    load();
  });

  document.getElementById("f-clear").addEventListener("click", () => {
    state = { category: "", search: "", minPrice: "", maxPrice: "", hotDeals: false, flashSale: false, sort: "" };
    pushURL();
    load();
  });

  hotChip.addEventListener("click", () => {
    state.hotDeals = !state.hotDeals;
    pushURL();
    load();
  });

  sortSelect.addEventListener("change", () => {
    state.sort = sortSelect.value;
    pushURL();
    load();
  });

  // Re-sync when the user hits browser back/forward (e.g. mega-menu link -> back button)
  window.addEventListener("popstate", () => {
    state = readParams();
    load();
  });

  populateCategories();
  load();
})();