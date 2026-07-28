/* ============================================================
   SIX STAR SUPPLIERS — shared UI render helpers
   Used by index.html (and any other storefront page) to turn
   API responses into markup. Depends on SS_API being loaded first.
   ============================================================ */

// Keyed by product id, so product.html?id=... can look up full
// product data without a second API call after coming from a card.
window.__ssProductCache = window.__ssProductCache || {};

// ---------- skeleton loading placeholders ----------
function ssSkeletonCards(count = 4) {
  return `<div class="skel skeleton-card"></div>`.repeat(count);
}

// ---------- single product card ----------
function ssProductCard(p) {
  const id = p.id || p._id;
  const img = (p.images && p.images[0]) || "https://placehold.co/400x400/F1E4CE/5B564C?text=No+photo";
  const price = Number(p.displayPrice ?? p.finalPrice ?? 0).toLocaleString();
  const hasDiscount = p.discountPercent > 0;
  const stockPercent = Math.max(8, Math.min(100, Math.round((p.stock / (p.stock + 15)) * 100)));

  return `
    <a class="p-card" href="product.html?id=${id}">
      <div class="p-card__img">
        ${hasDiscount ? `<span class="p-card__discount">-${p.discountPercent}%</span>` : ""}
        <img src="${img}" alt="${ssEscape(p.name)}" loading="lazy">
      </div>
      <div class="p-card__body">
        <div class="p-card__name">${ssEscape(p.name)}</div>
        <div class="p-card__foot">
          <div>
            <span class="price-tag">KSh ${price}</span>
            ${hasDiscount ? `<div class="p-card__old">KSh ${Number(p.finalPrice).toLocaleString()}</div>` : ""}
          </div>
          <button type="button" class="p-card__add" data-add-cart="${id}" aria-label="Add to cart">
            <i class="fa-solid fa-plus"></i>
          </button>
        </div>
        <div class="stock-line"><span style="width:${stockPercent}%"></span></div>
        <small>${p.stock} in stock${p.ratingsCount ? ` · ${p.ratingsAverage}★ (${p.ratingsCount})` : ""}</small>
      </div>
    </a>`;
}

// ---------- category grid (Shop by Category) ----------
async function ssRenderCategoryGrid(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;

  el.innerHTML = `<div class="skel" style="width:72px;height:72px;border-radius:50%;"></div>`.repeat(6);

  try {
    const { categories } = await SS_API.getCategories();

    if (!categories || categories.length === 0) {
      el.innerHTML = `<p class="form-hint">No categories yet.</p>`;
      return;
    }

    el.innerHTML = categories
      .map((c) => {
        const id = c.id || c._id;
        return `
        <a class="cat-item" href="products.html?category=${id}">
          <div class="cat-thumb">
            ${c.image ? `<img src="${c.image}" alt="${ssEscape(c.name)}" loading="lazy">` : ""}
          </div>
          <span>${ssEscape(c.name)}</span>
        </a>`;
      })
      .join("");
  } catch (err) {
    el.innerHTML = `<p class="form-hint">Couldn't load categories. <a href="index.html">Retry</a></p>`;
  }
}

// ---------- hero ad banner ----------
async function ssRenderHeroAd(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;

  try {
    const { ads } = await SS_API.getAds("homepage_hero");

    if (!ads || ads.length === 0) {
      el.style.display = "none";
      return;
    }

    // If there are several active hero ads, rotate through them every 5s
    let index = 0;
    const render = () => {
      const ad = ads[index];
      const id = ad.id || ad._id;
      el.innerHTML = `
        <a class="hero-banner" href="${ad.linkUrl || '#'}" data-ad-click="${id}" ${ad.linkUrl ? 'target="_blank" rel="noreferrer"' : ""}>
          <img src="${ad.image}" alt="${ssEscape(ad.title)}" loading="lazy">
        </a>`;

      const link = el.querySelector("[data-ad-click]");
      if (link) {
        link.addEventListener("click", () => SS_API.trackAdClick(id));
      }
    };

    render();
    el.style.display = "";

    if (ads.length > 1) {
      setInterval(() => {
        index = (index + 1) % ads.length;
        render();
      }, 5000);
    }
  } catch (err) {
    el.style.display = "none";
  }
}

// ---------- add-to-cart delegation (works on any page that includes this file) ----------
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-add-cart]");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();

  const id = btn.dataset.addCart;
  const product = window.__ssProductCache[id];
  if (!product) return;

  if (typeof window.ssAddToCart === "function") {
    window.ssAddToCart(product);
  } else {
    console.warn("ssAddToCart() is not defined yet - wire up cart.js to make Add to Cart work.");
  }
});

// ---------- utils ----------
function ssEscape(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
