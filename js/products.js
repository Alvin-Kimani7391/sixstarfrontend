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

  const PAGE_SIZE = 8; // products per batch

  function readParams() {
    const p = new URLSearchParams(location.search);
    return {
      category: p.get("category") || "", // category _id, not a slug — always the deepest node picked
      search: p.get("search") || "",
      minPrice: p.get("minPrice") || "",
      maxPrice: p.get("maxPrice") || "",
      hotDeals: p.get("hotDeals") === "true",
      sort: p.get("sort") || ""
    };
  }

  let state = readParams();

  // Full category TREE (parent -> children -> grandchildren...), used to
  // drive the cascading Category/Sub-category/Sub-sub-category selects in
  // the sidebar and to resolve the category banner's display name + path.
  let categoryTree = [];

  // Pagination/load-more bookkeeping — separate from `state` (which only
  // holds filters) so switching filters can freely reset it.
  let page = 1;
  let totalCount = 0;
  let loadedCount = 0;
  let isLoadingMore = false;

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
        // now only governs price range).
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
    renderCategoryBanner();
  }

  // Shows a small heading + "clear filter" link when arriving with a category
  // pre-selected (e.g. from the homepage mega menu), so it doesn't just look
  // like a plain, unfiltered product grid. Shows the full drill-down path
  // (e.g. "Electronics > Phones & Tablets > Smartphones") when the tree has
  // loaded, so the user can see exactly how specific the current filter is.
  function renderCategoryBanner() {
    let banner = document.getElementById("categoryBanner");
    if (!state.category) {
      if (banner) banner.remove();
      return;
    }

    const path = ssFindCategoryPath(categoryTree, state.category);
    const label = path && path.length
      ? path.map(n => n.name).join(" <i class=\"fa-solid fa-chevron-right\"></i> ")
      : "Selected category";

    if (!banner) {
      banner = document.createElement("div");
      banner.id = "categoryBanner";
      banner.className = "category-banner";
      resultCount.parentElement.insertBefore(banner, resultCount.parentElement.firstChild);
    }
    banner.innerHTML = `
      <span>Showing: <strong>${label}</strong></span>
      <a href="product.html" class="category-banner__clear">Clear category <i class="fa-solid fa-xmark"></i></a>
    `;
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

  // Full (re)load — used on first load, filter changes, and back/forward nav.
  async function load() {
    syncFormToState();
    renderCategoryBanner();

    page = 1;
    loadedCount = 0;
    totalCount = 0;
    loadMoreWrap.style.display = "none";
    grid.innerHTML = ssSkeletonCards(PAGE_SIZE);
    resultCount.textContent = "Loading products…";

    try {
      const res = await fetchPage(page);
      const products = res.products || res.data || (Array.isArray(res) ? res : []);
      totalCount = res.total ?? res.count ?? products.length;

      if (!products.length) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
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
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <h3>Couldn't load products</h3>
        <p>${err.message}</p>
      </div>`;
      resultCount.textContent = "";
      loadMoreWrap.style.display = "none";
    }
  }

  // Appends the next batch onto the existing grid instead of replacing it.
  async function loadMore() {
    if (isLoadingMore || loadedCount >= totalCount) return;
    setLoadMoreBusy(true);

    const nextPage = page + 1;
    try {
      const res = await fetchPage(nextPage);
      const products = res.products || res.data || (Array.isArray(res) ? res : []);

      if (products.length) {
        products.forEach(p => { window.__ssProductCache[p.id] = p; });
        grid.insertAdjacentHTML("beforeend", products.map(ssProductCard).join(""));
        page = nextPage;
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
    state = { category: "", search: "", minPrice: "", maxPrice: "", hotDeals: false, sort: "" };
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