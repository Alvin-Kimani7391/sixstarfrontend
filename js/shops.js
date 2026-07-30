/* ============================================================
   shops.js — Shop Directory page (shops.html)
   ============================================================ */

let ssShopsState = { page: 1, limit: 12, search: "", verified: false, featured: false, sort: "featured" };

async function ssLoadShops() {
  const grid = document.getElementById("shopsGrid");
  const countEl = document.getElementById("shopsCount");
  const paginationEl = document.getElementById("shopsPagination");
  grid.innerHTML = ssShopSkeletons(6);

  const params = {
    page: ssShopsState.page,
    limit: ssShopsState.limit,
    sort: ssShopsState.sort,
  };
  if (ssShopsState.search) params.search = ssShopsState.search;
  if (ssShopsState.verified) params.verified = "true";
  if (ssShopsState.featured) params.featured = "true";

  try {
    const res = await SS_API.getShops(params);
    const shops = res.shops || [];
    const total = res.total ?? shops.length;
    countEl.textContent = `${total} shop${total === 1 ? "" : "s"}`;

    if (!shops.length) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1;">
          <i class="fa-solid fa-store-slash"></i>
          <h3>No shops match your filters</h3>
          <p>Try clearing a filter or searching a different term.</p>
        </div>`;
      paginationEl.innerHTML = "";
      return;
    }

    grid.innerHTML = shops.map(ssShopCard).join("");
    ssRenderShopsPagination(paginationEl, res.page || 1, res.pages || 1);
  } catch (err) {
    console.error("ssLoadShops failed:", err);
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <h3>Couldn't load shops</h3>
        <p>Check your connection and try again.</p>
      </div>`;
    paginationEl.innerHTML = "";
  }
}

function ssShopSkeletons(n) {
  return Array.from({ length: n }).map(() => `<div class="shop-card skel"><div class="shop-card__banner"></div></div>`).join("");
}

function ssShopCard(s) {
  const initial = (s.shopName || "?").trim().charAt(0).toUpperCase();
  return `
    <a class="shop-card" href="/shop/${encodeURIComponent(s.slug)}">
      <div class="shop-card__banner">
        ${s.isFeatured ? `<span class="shop-featured-ribbon"><i class="fa-solid fa-star"></i> Featured</span>` : ""}
        ${s.banner ? `<img src="${s.banner}" alt="${s.shopName}" loading="lazy">` : ""}
      </div>
      <div class="shop-card__logo">${s.logo ? `<img src="${s.logo}" alt="">` : initial}</div>
      <div class="shop-card__body">
        <div class="shop-card__name-row">
          <span class="shop-card__name">${s.shopName}</span>
          ${s.verificationStatus === "verified" ? `<span class="shop-verified"><i class="fa-solid fa-check"></i> Verified</span>` : ""}
        </div>
        ${s.businessCategory ? `<span class="shop-card__category">${s.businessCategory}</span>` : ""}
        <p class="shop-card__desc">${s.description || "No description yet."}</p>
        <div class="shop-card__meta">
          <span><i class="fa-solid fa-bag-shopping"></i>${s.productCount ?? 0} products</span>
        </div>
      </div>
      <div class="shop-card__foot">
        <span class="btn btn-outline btn-sm btn-block">Visit Shop <i class="fa-solid fa-arrow-right"></i></span>
      </div>
    </a>`;
}

function ssRenderShopsPagination(el, page, pages) {
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
      if (!p || p === ssShopsState.page) return;
      ssShopsState.page = p;
      ssLoadShops();
      window.scrollTo({ top: document.getElementById("shopsToolbar").offsetTop - 100, behavior: "smooth" });
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("shopSearchForm");
  const input = document.getElementById("shopSearchInput");
  const urlParams = new URLSearchParams(location.search);
  if (urlParams.get("search")) {
    ssShopsState.search = urlParams.get("search");
    input.value = ssShopsState.search;
  }

  form.addEventListener("submit", e => {
    e.preventDefault();
    ssShopsState.search = input.value.trim();
    ssShopsState.page = 1;
    ssLoadShops();
  });

  document.querySelectorAll(".shops-toolbar__filters .chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const type = chip.dataset.filter;
      if (type === "verified") ssShopsState.verified = !ssShopsState.verified;
      if (type === "featured") ssShopsState.featured = !ssShopsState.featured;
      chip.classList.toggle("active");
      ssShopsState.page = 1;
      ssLoadShops();
    });
  });

  document.getElementById("shopSortSelect").addEventListener("change", (e) => {
    ssShopsState.sort = e.target.value;
    ssShopsState.page = 1;
    ssLoadShops();
  });

  ssLoadShops();
});