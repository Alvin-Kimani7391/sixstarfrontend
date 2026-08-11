/* ============================================================
   shops.js — Shop Directory page (shops.html)
   ============================================================ */

let ssShopsState = { page: 1, limit: 12, search: "", verified: false, featured: false, sort: "featured" };

// ============================================================
// SEO — dynamic <title>/<meta description>/canonical + a ListItem JSON-LD
// block for whatever's currently showing. SS_SEO comes from js/seo-meta.js
// (load it before this file in shop.html, same as product.html does); every
// call here is guarded so this file still works fine if that script isn't
// present.
//
// Shop cards link to /shop/:slug (see ssShopCard() below), not
// product-detail.html?id=, so this builds its own ItemList directly via
// SS_SEO.setJsonLd() rather than reusing setItemListJsonLd() (which is
// product-URL-shaped).
// ============================================================
function ssUpdateShopsSeoMeta() {
  if (typeof SS_SEO === "undefined") return;

  const origin = location.origin;
  let title;
  let description;
  let canonical = `${origin}${location.pathname}${location.search}`;

  if (ssShopsState.search) {
    title = `"${ssShopsState.search}" — Shop search | Six Star Suppliers`;
    description = `Shops matching "${ssShopsState.search}" on Six Star Suppliers — verified wholesalers and retailers.`;
  } else if (ssShopsState.verified && ssShopsState.featured) {
    title = "Featured Verified Shops — Six Star Suppliers";
    description = "Browse our featured, verified shops on Six Star Suppliers — trusted sellers reviewed and approved before going live.";
  } else if (ssShopsState.verified) {
    title = "Verified Shops — Six Star Suppliers";
    description = "Browse verified shops on Six Star Suppliers — every seller here has passed our verification checks.";
  } else if (ssShopsState.featured) {
    title = "Featured Shops — Six Star Suppliers";
    description = "Discover our featured shops on Six Star Suppliers, hand-picked for quality and reliability.";
  } else {
    title = "Shops — Six Star Suppliers | Kenya";
    description = "Browse verified shops on Six Star Suppliers — trusted wholesalers and retailers, all orders handled securely through the marketplace.";
    canonical = `${origin}/shop.html`;
  }

  SS_SEO.setMeta({ title, description, canonical, type: "website" });
}

// Builds an ItemList of shop storefronts pointing at their pretty /shop/:slug
// URLs, so crawlers get a structured summary of the directory page instead
// of just the rendered cards.
function ssUpdateShopsItemList(shops) {
  if (typeof SS_SEO === "undefined" || !SS_SEO.setJsonLd) return;
  if (!shops || !shops.length) return;

  SS_SEO.setJsonLd("ss-shoplist-jsonld", {
    "@context": "https://schema.org/",
    "@type": "ItemList",
    itemListElement: shops.map((s, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${location.origin}/shop/${encodeURIComponent(s.slug)}`,
      name: s.shopName,
    })),
  });
}

async function ssLoadShops() {
  const grid = document.getElementById("shopsGrid");
  const countEl = document.getElementById("shopsCount");
  const paginationEl = document.getElementById("shopsPagination");
  grid.innerHTML = ssShopSkeletons(6);

  ssUpdateShopsSeoMeta();

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
    ssUpdateShopsItemList(shops);
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
    <a class="shop-card" href="/shop/templates/${encodeURIComponent(s.slug)}">
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