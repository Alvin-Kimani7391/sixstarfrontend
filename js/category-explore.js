/* ============================================================
   CATEGORY EXPLORE — dynamic category drill-down page.

   Flow:
   1. Read ?category=ID from the URL (empty = browsing the root/
      top-level category list).
   2. Fetch the full category tree (same call the mega-menu uses)
      and locate the current node's path with ssFindCategoryPath()
      (already defined in ui.js).
   3. If the current node has children, render the horizontal
      sub-category strip. If it's a leaf (or nothing selected has
      children), skip the strip entirely.
   4. Fetch that category's attribute definitions (Brand, Gender,
      Material, ...) via SS_API.getCategoryAttributes() and render
      one filter group per NON-VARIANT attribute. Variant-defining
      attributes (Size/Color) are intentionally NOT rendered as
      filters here — they live on ProductVariant, and getProducts()
      has no query path for filtering by variant combination yet.
   5. Fetch products via the existing SS_API.getProducts(), which
      already widens a category filter to every descendant category
      server-side — so selecting a mid-level node returns everything
      nested under it with zero extra work here.

   Clicking a sub-category tile, a category-nav link, or any filter
   just re-runs load() with a new URL (pushState) — no full page
   reload, mirroring the pattern already used in products.js.
   ============================================================ */
(function () {
  const PRICE_BOUND_MAX = 100000; // slider ceiling; number inputs still accept anything higher

  const els = {
    breadcrumb: document.getElementById("ceBreadcrumb"),
    title: document.getElementById("ceTitle"),
    titleCount: document.getElementById("ceTitleCount"),
    subcatSection: document.getElementById("ceSubcatSection"),
    subcatScroll: document.getElementById("ceSubcatScroll"),
    subcatPrev: document.getElementById("ceSubcatPrev"),
    subcatNext: document.getElementById("ceSubcatNext"),
    filtersAside: document.getElementById("ceFiltersAside"),
    filtersToggle: document.getElementById("ceFiltersToggle"),
    catNav: document.getElementById("ceCatNav"),
    rangeMin: document.getElementById("ceRangeMin"),
    rangeMax: document.getElementById("ceRangeMax"),
    rangeFill: document.getElementById("ceRangeFill"),
    minPrice: document.getElementById("ceMinPrice"),
    maxPrice: document.getElementById("ceMaxPrice"),
    discountChip: document.getElementById("ceDiscountChip"),
    hotChip: document.getElementById("ceHotChip"),
    ratingRow: document.getElementById("ceRatingRow"),
    attrFilters: document.getElementById("ceAttrFilters"),
    applyBtn: document.getElementById("ceApplyBtn"),
    clearBtn: document.getElementById("ceClearBtn"),
    filterBanner: document.getElementById("ceFilterBanner"),
    resultCount: document.getElementById("ceResultCount"),
    sort: document.getElementById("ceSort"),
    grid: document.getElementById("ceProductGrid"),
    loadMoreWrap: document.getElementById("ceLoadMoreWrap"),
    loadMoreCount: document.getElementById("ceLoadMoreCount"),
    loadMoreSentinel: document.getElementById("ceLoadMoreSentinel"),
  };

  const PAGE_SIZE = 12;
  const RATING_OPTIONS = [4, 3, 2, 1];

  let categoryTree = [];
  let attributeDefs = []; // non-variant attribute defs for the current category
  let attrFilterState = {}; // { attributeId: [selectedValue, ...] }

  let state = readParams();
  let page = 1;
  let totalCount = 0;
  let loadedCount = 0;
  let isLoadingMore = false;

  function readParams() {
    const p = new URLSearchParams(location.search);
    const s = {
      category: p.get("category") || "",
      minPrice: p.get("minPrice") || "",
      maxPrice: p.get("maxPrice") || "",
      hotDeals: p.get("hotDeals") === "true",
      discountOnly: p.get("discountOnly") === "true",
      minRating: p.get("minRating") || "",
      sort: p.get("sort") || "",
    };
    // Attribute filters travel as attr_<attributeId>=value1,value2
    attrFilterState = {};
    for (const [key, value] of p.entries()) {
      if (key.startsWith("attr_") && value) {
        attrFilterState[key.slice(5)] = value.split(",").filter(Boolean);
      }
    }
    return s;
  }

  function pushURL() {
    const p = new URLSearchParams();
    Object.entries(state).forEach(([k, v]) => {
      if (v !== "" && v !== false) p.set(k, v);
    });
    Object.entries(attrFilterState).forEach(([attrId, values]) => {
      if (values && values.length) p.set(`attr_${attrId}`, values.join(","));
    });
    const qs = p.toString();
    history.pushState({}, "", "category-explore.html" + (qs ? "?" + qs : ""));
  }

  function currentNode(path) {
    return path && path.length ? path[path.length - 1] : null;
  }

  /* ---------------- Breadcrumb + title ---------------- */
  function renderBreadcrumb(path) {
    const crumbs = [`<a href="category-explore.html"><i class="fa-solid fa-house"></i> All Categories</a>`];
    (path || []).forEach((node, i) => {
      const id = node._id || node.id;
      const isLast = i === path.length - 1;
      crumbs.push(`<i class="fa-solid fa-chevron-right"></i>`);
      crumbs.push(
        isLast
          ? `<strong>${ssEscapeHtml(node.name)}</strong>`
          : `<a href="category-explore.html?category=${encodeURIComponent(id)}">${ssEscapeHtml(node.name)}</a>`
      );
    });
    els.breadcrumb.innerHTML = crumbs.join(" ");

    const node = currentNode(path);
    els.title.textContent = node ? node.name : "Shop by Category";
  }

  /* ---------------- Sub-category horizontal strip ---------------- */
  function renderSubcatStrip(path, node, children) {
    if (!children || !children.length) {
      els.subcatSection.style.display = "none";
      els.subcatScroll.innerHTML = "";
      return;
    }

    els.subcatSection.style.display = "block";

    const parent = path && path.length > 1 ? path[path.length - 2] : null;
    const homeHref = parent
      ? `category-explore.html?category=${encodeURIComponent(parent._id || parent.id)}`
      : `category-explore.html`;

    const tiles = [`
      <a class="ce-subcat-tile" href="${homeHref}">
        <div class="ce-subcat-thumb ce-home"><i class="fa-solid fa-house"></i></div>
        <span>Back</span>
      </a>`];

    children.forEach((child) => {
      const id = child._id || child.id;
      const rawImg = child.image || "https://placehold.co/200/F3F4F8/15161A?text=" + encodeURIComponent(child.name);
      const img = ssCldTransform(rawImg, "f_auto,q_auto:good,w_200,h_200,c_fill,dpr_auto");
      const isActive = state.category === id;
      tiles.push(`
        <a class="ce-subcat-tile ${isActive ? "active" : ""}" href="category-explore.html?category=${encodeURIComponent(id)}">
          <div class="ce-subcat-thumb"><img src="${img}" alt="${ssEscapeHtml(child.name)}" loading="lazy"></div>
          <span>${ssEscapeHtml(child.name)}</span>
        </a>`);
    });

    els.subcatScroll.innerHTML = tiles.join("");
  }

  /* ---------------- Sidebar category mini-nav ---------------- */
  function renderCatNav(path, tree) {
    if (!path || !path.length) {
      // Nothing selected yet — show the root categories as a flat list.
      els.catNav.innerHTML = tree
        .map((c) => `<a href="category-explore.html?category=${encodeURIComponent(c._id || c.id)}">${ssEscapeHtml(c.name)}</a>`)
        .join("");
      return;
    }

    const ancestors = path.slice(0, -1);
    const current = path[path.length - 1];
    const parent = ancestors.length ? ancestors[ancestors.length - 1] : null;
    const siblings = parent ? (parent.children || []) : tree;

    const ancestorHtml = ancestors
      .map((a) => `<a href="category-explore.html?category=${encodeURIComponent(a._id || a.id)}">${ssEscapeHtml(a.name)}</a>`)
      .join("");

    const siblingHtml = siblings
      .map((s) => {
        const id = s._id || s.id;
        const active = id === (current._id || current.id);
        return `<a class="${active ? "active" : ""}" href="category-explore.html?category=${encodeURIComponent(id)}">${ssEscapeHtml(s.name)}</a>`;
      })
      .join("");

    els.catNav.innerHTML = `
      ${ancestorHtml}
      <div class="ce-cat-nav__children">${siblingHtml}</div>
    `;
  }

  /* ---------------- Price range slider <-> number inputs ---------------- */
  function syncRangeFill() {
    const min = Number(els.rangeMin.value);
    const max = Number(els.rangeMax.value);
    const bound = Number(els.rangeMin.max) || PRICE_BOUND_MAX;
    const leftPct = (min / bound) * 100;
    const rightPct = 100 - (max / bound) * 100;
    els.rangeFill.style.left = `${leftPct}%`;
    els.rangeFill.style.right = `${rightPct}%`;
  }

  function bindRangeSlider() {
    els.rangeMin.addEventListener("input", () => {
      if (Number(els.rangeMin.value) > Number(els.rangeMax.value)) {
        els.rangeMin.value = els.rangeMax.value;
      }
      els.minPrice.value = els.rangeMin.value;
      syncRangeFill();
    });
    els.rangeMax.addEventListener("input", () => {
      if (Number(els.rangeMax.value) < Number(els.rangeMin.value)) {
        els.rangeMax.value = els.rangeMin.value;
      }
      els.maxPrice.value = els.rangeMax.value;
      syncRangeFill();
    });
    els.minPrice.addEventListener("input", () => {
      const v = Math.min(Number(els.minPrice.value) || 0, Number(els.rangeMin.max));
      els.rangeMin.value = v;
      syncRangeFill();
    });
    els.maxPrice.addEventListener("input", () => {
      const v = Math.min(Number(els.maxPrice.value) || Number(els.rangeMax.max), Number(els.rangeMax.max));
      els.rangeMax.value = v;
      syncRangeFill();
    });
  }

  function syncFormToState() {
    els.minPrice.value = state.minPrice || "";
    els.maxPrice.value = state.maxPrice || "";
    els.rangeMin.value = state.minPrice || 0;
    els.rangeMax.value = state.maxPrice || els.rangeMax.max;
    syncRangeFill();

    els.discountChip.dataset.active = state.discountOnly ? "true" : "false";
    els.discountChip.classList.toggle("active", state.discountOnly);
    els.hotChip.dataset.active = state.hotDeals ? "true" : "false";
    els.hotChip.classList.toggle("active", state.hotDeals);
    els.sort.value = state.sort || "";

    renderRatingRow();
  }

  /* ---------------- Rating filter ---------------- */
  function renderRatingRow() {
    els.ratingRow.innerHTML = RATING_OPTIONS.map((r) => {
      const active = String(state.minRating) === String(r);
      return `
        <button type="button" class="ce-rating-chip ${active ? "active" : ""}" data-rating="${r}">
          ${Array.from({ length: 5 }).map((_, i) => `<i class="fa-solid fa-star" style="opacity:${i < r ? 1 : .25}"></i>`).join("")}
          <span>& above</span>
        </button>`;
    }).join("");

    els.ratingRow.querySelectorAll(".ce-rating-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const r = btn.dataset.rating;
        state.minRating = String(state.minRating) === r ? "" : r;
        pushURL();
        renderRatingRow();
        renderFilterBanner();
        loadProducts();
      });
    });
  }

  /* ---------------- Dynamic attribute filters ---------------- */
  async function loadAttributeFilters() {
    els.attrFilters.innerHTML = "";
    attributeDefs = [];
    if (!state.category) return;

    let defs = [];
    try {
      const res = await SS_API.getCategoryAttributes(state.category);
      defs = res.attributes || res.data || [];
    } catch (_) {
      defs = [];
    }

    // Only render checkbox filters for non-variant, choice-based attributes —
    // Size/Color (isVariantAttribute) live on ProductVariant and aren't
    // filterable through getProducts() yet; boolean/text/number attributes
    // aren't rendered here either since they don't fit a checkbox UI cleanly.
    attributeDefs = defs.filter(
      (d) => !d.isVariantAttribute && (d.type === "select" || d.type === "multiselect") && d.options && d.options.length
    );

    if (!attributeDefs.length) return;

    els.attrFilters.innerHTML = attributeDefs
      .map((def) => {
        const needsSearch = def.options.length > 8;
        return `
          <div class="filter-group ce-attr-group" data-attr-id="${def._id}">
            <label>${ssEscapeHtml(def.name)}${def.unit ? ` (${ssEscapeHtml(def.unit)})` : ""}</label>
            ${needsSearch ? `<input type="text" class="ce-attr-search" placeholder="Search ${ssEscapeHtml(def.name.toLowerCase())}...">` : ""}
            <div class="ce-attr-options">
              ${def.options
                .map((opt) => {
                  const checked = (attrFilterState[def._id] || []).includes(opt);
                  return `<label data-opt="${ssEscapeHtml(opt.toLowerCase())}">
                    <input type="checkbox" value="${ssEscapeHtml(opt)}" ${checked ? "checked" : ""}>
                    ${ssEscapeHtml(opt)}
                  </label>`;
                })
                .join("")}
            </div>
          </div>`;
      })
      .join("");

    // Wire up the optional search-within-options box for large lists (Brand, etc.)
    els.attrFilters.querySelectorAll(".ce-attr-group").forEach((group) => {
      const search = group.querySelector(".ce-attr-search");
      if (search) {
        search.addEventListener("input", () => {
          const q = search.value.trim().toLowerCase();
          group.querySelectorAll(".ce-attr-options label").forEach((lbl) => {
            lbl.style.display = lbl.dataset.opt.includes(q) ? "" : "none";
          });
        });
      }
    });
  }

  function readAttrFilterStateFromDOM() {
    const next = {};
    els.attrFilters.querySelectorAll(".ce-attr-group").forEach((group) => {
      const attrId = group.dataset.attrId;
      const values = Array.from(group.querySelectorAll("input[type='checkbox']:checked")).map((cb) => cb.value);
      if (values.length) next[attrId] = values;
    });
    attrFilterState = next;
  }

  /* ---------------- Filter banner (active-filter chips) ---------------- */
  function renderFilterBanner() {
    const chips = [];
    if (state.discountOnly) chips.push({ key: "discountOnly", label: "Discounted only" });
    if (state.hotDeals) chips.push({ key: "hotDeals", label: "Hot deals" });
    if (state.minRating) chips.push({ key: "minRating", label: `${state.minRating}★ & above` });
    if (state.minPrice || state.maxPrice) {
      chips.push({ key: "price", label: `KSh ${state.minPrice || 0} – ${state.maxPrice || "∞"}` });
    }
    Object.entries(attrFilterState).forEach(([attrId, values]) => {
      const def = attributeDefs.find((d) => String(d._id) === String(attrId));
      if (def && values.length) chips.push({ key: `attr_${attrId}`, label: `${def.name}: ${values.join(", ")}` });
    });

    if (!chips.length) {
      els.filterBanner.style.display = "none";
      els.filterBanner.innerHTML = "";
      return;
    }

    els.filterBanner.style.display = "flex";
    els.filterBanner.innerHTML = chips
      .map(
        (c) => `
      <div class="ce-chip">
        <span>${ssEscapeHtml(c.label)}</span>
        <button type="button" class="ce-chip__clear" data-clear="${c.key}"><i class="fa-solid fa-xmark"></i></button>
      </div>`
      )
      .join("");

    els.filterBanner.querySelectorAll("[data-clear]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.clear;
        if (key === "price") { state.minPrice = ""; state.maxPrice = ""; }
        else if (key.startsWith("attr_")) { delete attrFilterState[key.slice(5)]; }
        else if (key === "minRating") { state.minRating = ""; }
        else { state[key] = false; }
        pushURL();
        syncFormToState();
        loadAttributeFilters().then(() => { renderFilterBanner(); loadProducts(); });
      });
    });
  }

  /* ---------------- Products grid + infinite scroll ---------------- */
  function buildAttrQueryParam() {
    const nonEmpty = Object.entries(attrFilterState).filter(([, v]) => v && v.length);
    if (!nonEmpty.length) return undefined;
    const obj = {};
    nonEmpty.forEach(([k, v]) => { obj[k] = v.length === 1 ? v[0] : v; });
    return JSON.stringify(obj);
  }

  function fetchPage(pageNum) {
    return SS_API.getProducts({
      category: state.category || undefined,
      minPrice: state.minPrice || undefined,
      maxPrice: state.maxPrice || undefined,
      hotDeals: state.hotDeals || undefined,
      discountOnly: state.discountOnly || undefined,
      minRating: state.minRating || undefined,
      sort: state.sort || undefined,
      attributes: buildAttrQueryParam(),
      page: pageNum,
      limit: PAGE_SIZE,
    });
  }

  function refreshLoadMoreUI() {
    if (!totalCount || loadedCount >= totalCount) {
      els.loadMoreWrap.classList.remove("active");
      return;
    }
    els.loadMoreWrap.classList.add("active");
    els.loadMoreCount.textContent = `Showing ${loadedCount} of ${totalCount}`;
  }

  async function loadProducts() {
    page = 1;
    loadedCount = 0;
    totalCount = 0;
    els.loadMoreWrap.classList.remove("active");
    els.grid.innerHTML = ssSkeletonCards(PAGE_SIZE);
    els.resultCount.textContent = "Loading products…";
    els.titleCount.textContent = "";

    try {
      const res = await fetchPage(page);
      const products = res.products || res.data || (Array.isArray(res) ? res : []);
      totalCount = res.total ?? res.count ?? products.length;

      if (!products.length) {
        els.grid.innerHTML = `<div class="ce-empty">
          <i class="fa-solid fa-box-open"></i>
          <h3>No products match your filters</h3>
          <p>Try clearing a filter or browsing a different category.</p>
        </div>`;
        els.resultCount.textContent = "0 results";
        return;
      }

      products.forEach((p) => { window.__ssProductCache[p.id] = p; });
      els.grid.innerHTML = products.map(ssProductCard).join("");
      loadedCount = products.length;
      els.resultCount.textContent = `${totalCount} product${totalCount === 1 ? "" : "s"} found`;
      els.titleCount.textContent = `(${totalCount} products found)`;
      refreshLoadMoreUI();
    } catch (err) {
      els.grid.innerHTML = `<div class="ce-empty">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <h3>Couldn't load products</h3>
        <p>${err.message}</p>
      </div>`;
      els.resultCount.textContent = "";
    }
  }

  async function loadMoreProducts() {
    if (isLoadingMore || loadedCount >= totalCount) return;
    isLoadingMore = true;
    ssShowLoadingOverlay();
    try {
      const nextPage = page + 1;
      const res = await fetchPage(nextPage);
      const products = res.products || res.data || (Array.isArray(res) ? res : []);
      if (products.length) {
        products.forEach((p) => { window.__ssProductCache[p.id] = p; });
        els.grid.insertAdjacentHTML("beforeend", products.map(ssProductCard).join(""));
        loadedCount += products.length;
        page = nextPage;
      } else {
        totalCount = loadedCount;
      }
      refreshLoadMoreUI();
    } catch (_) {
      ssToast("Couldn't load more products", "fa-circle-exclamation");
    } finally {
      isLoadingMore = false;
      refreshLoadMoreUI();
      ssHideLoadingOverlay();
    }
  }

  const loadMoreObserver = new IntersectionObserver(
    (entries) => { if (entries[0].isIntersecting) loadMoreProducts(); },
    { rootMargin: "300px" }
  );
  if (els.loadMoreSentinel) loadMoreObserver.observe(els.loadMoreSentinel);

  /* ---------------- Full page load (category changed) ---------------- */
  async function load() {
    if (!categoryTree.length) {
      try {
        const data = await SS_API.getCategoryTree();
        categoryTree = Array.isArray(data) ? data : (data.categories || data.tree || []);
      } catch (_) {
        categoryTree = [];
      }
    }

    const path = state.category ? ssFindCategoryPath(categoryTree, state.category) : null;
    const node = currentNode(path);
    const children = node ? (node.children || []) : [];

    renderBreadcrumb(path);
    renderSubcatStrip(path, node, children);
    renderCatNav(path, categoryTree);
    syncFormToState();

    await loadAttributeFilters();
    renderFilterBanner();
    await loadProducts();
  }

  /* ---------------- Event wiring ---------------- */
  bindRangeSlider();

  els.discountChip.addEventListener("click", () => {
    state.discountOnly = !state.discountOnly;
    pushURL();
    syncFormToState();
    renderFilterBanner();
    loadProducts();
  });

  els.hotChip.addEventListener("click", () => {
    state.hotDeals = !state.hotDeals;
    pushURL();
    syncFormToState();
    renderFilterBanner();
    loadProducts();
  });

  els.sort.addEventListener("change", () => {
    state.sort = els.sort.value;
    pushURL();
    loadProducts();
  });

  els.applyBtn.addEventListener("click", () => {
    state.minPrice = els.minPrice.value;
    state.maxPrice = els.maxPrice.value;
    readAttrFilterStateFromDOM();
    pushURL();
    renderFilterBanner();
    loadProducts();
    if (window.matchMedia("(max-width:859px)").matches) {
      els.filtersAside.classList.remove("ce-open");
    }
  });

  els.clearBtn.addEventListener("click", () => {
    state = { category: state.category, minPrice: "", maxPrice: "", hotDeals: false, discountOnly: false, minRating: "", sort: "" };
    attrFilterState = {};
    pushURL();
    syncFormToState();
    loadAttributeFilters().then(() => { renderFilterBanner(); loadProducts(); });
  });

  els.filtersToggle.addEventListener("click", () => {
    els.filtersAside.classList.toggle("ce-open");
  });

  els.subcatPrev.addEventListener("click", () => els.subcatScroll.scrollBy({ left: -260, behavior: "smooth" }));
  els.subcatNext.addEventListener("click", () => els.subcatScroll.scrollBy({ left: 260, behavior: "smooth" }));

  window.addEventListener("popstate", () => {
    state = readParams();
    load();
  });

  load();
})();