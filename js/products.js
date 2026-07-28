(function () {
  const grid = document.getElementById("productGrid");
  const pagination = document.getElementById("pagination");
  const resultCount = document.getElementById("resultCount");
  const catSelect = document.getElementById("f-category");
  const minInput = document.getElementById("f-min");
  const maxInput = document.getElementById("f-max");
  const hotChip = document.getElementById("f-hotdeals");
  const sortSelect = document.getElementById("f-sort");

  function readParams() {
    const p = new URLSearchParams(location.search);
    return {
      category: p.get("category") || "", // now expected to be a category _id, not a slug
      search: p.get("search") || "",
      minPrice: p.get("minPrice") || "",
      maxPrice: p.get("maxPrice") || "",
      hotDeals: p.get("hotDeals") === "true",
      sort: p.get("sort") || "",
      page: parseInt(p.get("page") || "1", 10)
    };
  }

  let state = readParams();
  let allCategories = []; // cached so we can look up the display name for the active category

  function syncFormToState() {
    catSelect.value = state.category || "";
    minInput.value = state.minPrice || "";
    maxInput.value = state.maxPrice || "";
    sortSelect.value = state.sort || "";
    hotChip.dataset.active = state.hotDeals ? "true" : "false";
    hotChip.classList.toggle("active", state.hotDeals);
  }

  function pushURL() {
    const p = new URLSearchParams();
    Object.entries(state).forEach(([k, v]) => {
      if (v !== "" && v !== false && !(k === "page" && v === 1)) p.set(k, v);
    });
    history.pushState({}, "", "product.html" + (p.toString() ? "?" + p.toString() : ""));
  }

  function categoryId(c) {
    // Category documents from the API come back as _id (Mongo) or occasionally id
    // depending on toJSON transforms — support both.
    return c._id || c.id;
  }

  async function populateCategories() {
    const cats = await ssLoadCategories();
    allCategories = cats;
    catSelect.innerHTML = `<option value="">All categories</option>` +
      cats.map(c => `<option value="${categoryId(c)}">${c.name}</option>`).join("");
    catSelect.value = state.category || "";
    renderCategoryBanner();
  }

  // Shows a small heading + "clear filter" link when arriving with a category
  // pre-selected (e.g. from the homepage mega menu), so it doesn't just look
  // like a plain, unfiltered product grid.
  function renderCategoryBanner() {
    let banner = document.getElementById("categoryBanner");
    if (!state.category) {
      if (banner) banner.remove();
      return;
    }
    const match = allCategories.find(c => categoryId(c) === state.category);
    const label = match ? match.name : "Selected category";

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

  function renderPagination(totalPages) {
    pagination.innerHTML = "";
    if (!totalPages || totalPages <= 1) return;
    const make = (label, page, cls = "") => {
      const btn = document.createElement("button");
      btn.textContent = label;
      if (cls) btn.classList.add(cls);
      if (page === state.page) btn.classList.add("active");
      btn.addEventListener("click", () => { state.page = page; pushURL(); load(); window.scrollTo({ top: 0, behavior: "smooth" }); });
      return btn;
    };
    if (state.page > 1) pagination.appendChild(make("←", state.page - 1, "nav"));
    const start = Math.max(1, state.page - 2);
    const end = Math.min(totalPages, start + 4);
    for (let i = start; i <= end; i++) pagination.appendChild(make(i, i));
    if (state.page < totalPages) pagination.appendChild(make("→", state.page + 1, "nav"));
  }


  async function load() {
    syncFormToState();
    renderCategoryBanner();
    grid.innerHTML = ssSkeletonCards(8);
    resultCount.textContent = "Loading products…";

    try {
      const res = await SS_API.getProducts({
        category: state.category || undefined,
        search: state.search || undefined,
        minPrice: state.minPrice || undefined,
        maxPrice: state.maxPrice || undefined,
        hotDeals: state.hotDeals || undefined,
        sort: state.sort || undefined,
        page: state.page,
        limit: window.SS_CONFIG.PRODUCTS_PER_PAGE
      });

      const products = res.products || res.data || (Array.isArray(res) ? res : []);
      const total = res.total ?? res.count ?? products.length;
      const totalPages = res.totalPages ?? Math.ceil(total / (res.limit || window.SS_CONFIG.PRODUCTS_PER_PAGE || 24));

      if (!products.length) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
          <i class="fa-solid fa-box-open"></i>
          <h3>No products match your filters</h3>
          <p>Try clearing a filter or searching a different term.</p>
        </div>`;
        resultCount.textContent = "0 results";
        pagination.innerHTML = "";
        return;
      }

      products.forEach(p => { window.__ssProductCache[p.id] = p; });
      grid.innerHTML = products.map(ssProductCard).join("");
      resultCount.textContent = `${total} product${total === 1 ? "" : "s"} found`;
      renderPagination(totalPages);
    } catch (err) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <h3>Couldn't load products</h3>
        <p>${err.message}</p>
      </div>`;
      resultCount.textContent = "";
    }
  }

  document.getElementById("f-apply").addEventListener("click", () => {
    state.category = catSelect.value;
    state.minPrice = minInput.value;
    state.maxPrice = maxInput.value;
    state.sort = sortSelect.value;
    state.page = 1;
    pushURL();
    load();
  });

  document.getElementById("f-clear").addEventListener("click", () => {
    state = { category: "", search: "", minPrice: "", maxPrice: "", hotDeals: false, sort: "", page: 1 };
    pushURL();
    load();
  });

  hotChip.addEventListener("click", () => {
    state.hotDeals = !state.hotDeals;
    state.page = 1;
    pushURL();
    load();
  });

  sortSelect.addEventListener("change", () => {
    state.sort = sortSelect.value;
    state.page = 1;
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