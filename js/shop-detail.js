/* ============================================================
   shop-detail.js — Individual Shop Storefront (shop-detail.html)
   Reuses ssProductCard() / ssSkeletonCards() from ui.js so
   products render identically to every other page on the site.
   ============================================================ */

let ssShopDetailState = { shop: null, page: 1, limit: 12, sort: "-createdAt", search: "" };

function ssGetSlugFromUrl() {
  // Legacy support: shop-detail.html?slug=xyz or ?id=xyz
  const params = new URLSearchParams(location.search);
  if (params.get("slug")) return params.get("slug");
  if (params.get("id")) return params.get("id");

  // Pretty URL: /shop/miamii-bags -> "miamii-bags"
  const match = location.pathname.match(/\/shop\/([^/?#]+)/);
  if (match) return decodeURIComponent(match[1]);

  return "";
}

async function ssInitShopDetail() {
  const slug = ssGetSlugFromUrl();
  if (!slug) { ssShowShopNotFound(); return; }

  try {
    const res = await SS_API.getShopBySlug(slug);
    const shop = res.shop;
    if (!shop) { ssShowShopNotFound(); return; }
    ssShopDetailState.shop = shop;
    ssRenderShopPassport(shop);
    document.title = `${shop.shopName} — Six Star Suppliers`;
    ssLoadShopProducts();
  } catch (err) {
    console.error("ssInitShopDetail failed:", err);
    ssShowShopNotFound();
  }
}

function ssShowShopNotFound() {
  document.getElementById("shopDetailContent").style.display = "none";
  document.getElementById("shopNotFound").style.display = "block";
}

function ssRenderShopPassport(shop) {
  const bannerWrap = document.getElementById("shopBanner");
  bannerWrap.innerHTML = shop.banner
    ? `<img class="shop-hero__banner" src="${shop.banner}" alt="${shop.shopName} banner">`
    : `<div class="shop-hero__banner-fallback"></div>`;

  const initial = (shop.shopName || "?").trim().charAt(0).toUpperCase();
  const memberSince = shop.createdAt ? new Date(shop.createdAt).getFullYear() : "—";

  document.getElementById("shopPassportCard").innerHTML = `
    <div class="shop-passport__logo">${shop.logo ? `<img src="${shop.logo}" alt="">` : initial}</div>
    <div class="shop-passport__info">
      <div class="shop-passport__name-row">
        <span class="shop-passport__name">${shop.shopName}</span>
        ${shop.verificationStatus === "verified" ? `<span class="shop-verified"><i class="fa-solid fa-check"></i> Verified</span>` : ""}
      </div>
      ${shop.businessCategory ? `<div class="shop-passport__category">${shop.businessCategory}</div>` : ""}
      ${shop.description ? `<p class="shop-passport__desc">${shop.description}</p>` : ""}
      <div class="shop-passport__stats">
        <div class="shop-passport__stat"><strong id="shopProductCountStat">—</strong><span>Products</span></div>
        <div class="shop-passport__stat"><strong>${memberSince}</strong><span>On Six Star since</span></div>
        ${shop.businessHours ? `<div class="shop-passport__stat"><strong style="font-size:.82rem;">${shop.businessHours}</strong><span>Hours</span></div>` : ""}
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

async function ssLoadShopProducts() {
  const grid = document.getElementById("shopProductsGrid");
  const pagination = document.getElementById("shopProductsPagination");
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
    const products = res.products || [];
    const total = res.total ?? products.length;
    document.getElementById("shopProductCountStat").textContent = total;
    document.getElementById("shopProductsCount").textContent = `${total} product${total === 1 ? "" : "s"}`;

    if (!products.length) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1;">
          <i class="fa-solid fa-box-open"></i>
          <h3>No products here yet</h3>
          <p>This shop hasn't listed anything matching your filters.</p>
        </div>`;
      pagination.innerHTML = "";
      return;
    }

    grid.innerHTML = products.map(ssProductCard).join("");
    ssRenderShopProductsPagination(pagination, res.page || 1, res.pages || 1);
  } catch (err) {
    console.error("ssLoadShopProducts failed:", err);
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <h3>Couldn't load products</h3>
        <p>Check your connection and try again.</p>
      </div>`;
    pagination.innerHTML = "";
  }
}

function ssRenderShopProductsPagination(el, page, pages) {
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
      window.scrollTo({ top: document.getElementById("shopProductsToolbar").offsetTop - 100, behavior: "smooth" });
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  ssInitShopDetail();

  document.getElementById("shopProductSearchForm").addEventListener("submit", e => {
    e.preventDefault();
    ssShopDetailState.search = document.getElementById("shopProductSearchInput").value.trim();
    ssShopDetailState.page = 1;
    ssLoadShopProducts();
  });

  document.getElementById("shopProductSort").addEventListener("change", e => {
    ssShopDetailState.sort = e.target.value;
    ssShopDetailState.page = 1;
    ssLoadShopProducts();
  });
});