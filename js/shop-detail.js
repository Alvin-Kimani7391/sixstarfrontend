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
    ssLoadShopReviews();
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
        <div class="shop-passport__stat">
          <strong id="shopAvgRatingStat">${(shop.ratingsAverage || 0).toFixed(1)} <i class="fa-solid fa-star" style="font-size:.7em;color:var(--sun)"></i></strong>
          <span id="shopReviewCountStat">${shop.ratingsCount || 0} review${shop.ratingsCount === 1 ? "" : "s"}</span>
        </div>
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

// Lightweight refresh for just the passport's rating stat block — used after
// a review is submitted so the header updates instantly without re-rendering
// (and losing) the rest of the passport card, like the product count.
function ssUpdateShopRatingStats(shop) {
  const avgEl = document.getElementById("shopAvgRatingStat");
  const countEl = document.getElementById("shopReviewCountStat");
  if (avgEl) {
    avgEl.innerHTML = `${(shop.ratingsAverage || 0).toFixed(1)} <i class="fa-solid fa-star" style="font-size:.7em;color:var(--sun)"></i>`;
  }
  if (countEl) {
    countEl.textContent = `${shop.ratingsCount || 0} review${shop.ratingsCount === 1 ? "" : "s"}`;
  }
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

/* ============================================================
   SHOP REVIEWS
   ============================================================ */

function ssStarsHtml(rating, size = 14) {
  const full = Math.round(rating);
  let html = `<span class="star-row" style="font-size:${size}px;">`;
  for (let i = 1; i <= 5; i++) {
    html += `<i class="fa-solid fa-star" style="color:${i <= full ? "var(--sun)" : "var(--line)"}"></i>`;
  }
  html += "</span>";
  return html;
}

async function ssLoadShopReviews() {
  const shop = ssShopDetailState.shop;
  const listEl = document.getElementById("shopReviewsList");
  const summaryEl = document.getElementById("shopRatingSummary");
  listEl.innerHTML = `<p style="color:var(--ink-faint);">Loading reviews…</p>`;

  try {
    const res = await SS_API.getShopReviews(shop.id || shop._id);
    const reviews = res.reviews || [];
    const count = shop.ratingsCount || reviews.length;

    summaryEl.innerHTML = `
      ${ssStarsHtml(shop.ratingsAverage || 0, 16)}
      <strong style="margin-left:6px;">${(shop.ratingsAverage || 0).toFixed(1)}</strong>
      <span style="color:var(--ink-faint);font-size:12.5px;margin-left:4px;">(${count} review${count === 1 ? "" : "s"})</span>
    `;

    // Keep the passport header's stat block in sync with whatever we just
    // fetched, in case it's stale from a previous render.
    ssUpdateShopRatingStats(shop);

    if (!reviews.length) {
      listEl.innerHTML = `<p style="color:var(--ink-faint);">No reviews yet — be the first to review this shop.</p>`;
    } else {
      listEl.innerHTML = reviews.map(r => `
        <div class="shop-review-item">
          <div class="shop-review-item__head">
            <span class="shop-review-item__name">${r.buyer?.name || "Buyer"}</span>
            ${ssStarsHtml(r.rating, 12)}
          </div>
          ${r.comment ? `<p class="shop-review-item__comment">${r.comment}</p>` : ""}
          <span class="shop-review-item__date">${new Date(r.createdAt).toLocaleDateString()}</span>
        </div>
      `).join("");
    }
  } catch (err) {
    console.error("ssLoadShopReviews failed:", err);
    listEl.innerHTML = `<p style="color:var(--ink-faint);">Couldn't load reviews.</p>`;
  }

  ssRenderShopReviewForm();
}

function ssRenderShopReviewForm() {
  const wrap = document.getElementById("shopReviewFormWrap");
  const user = typeof SS_AUTH !== "undefined" && SS_AUTH.getUser ? SS_AUTH.getUser() : null;

  if (!user) {
    wrap.innerHTML = `<p class="shop-review-cta"><a href="/login.html">Log in</a> as a buyer to leave a review.</p>`;
    return;
  }
  if (user.role !== "buyer") { wrap.innerHTML = ""; return; }

  wrap.innerHTML = `
    <form id="shopReviewForm" class="shop-review-form">
      <div class="shop-review-form__stars" id="shopReviewStarsInput">
        ${[1, 2, 3, 4, 5].map(i => `<i class="fa-regular fa-star" data-val="${i}"></i>`).join("")}
      </div>
      <textarea id="shopReviewComment" placeholder="Share your experience with this shop (optional)" maxlength="1000"></textarea>
      <button type="submit" class="btn btn-primary btn-sm">Submit review</button>
    </form>
  `;

  let selectedRating = 0;
  const starEls = wrap.querySelectorAll("#shopReviewStarsInput i");
  starEls.forEach(star => {
    star.addEventListener("click", () => {
      selectedRating = Number(star.dataset.val);
      starEls.forEach(s => {
        const active = Number(s.dataset.val) <= selectedRating;
        s.className = active ? "fa-solid fa-star" : "fa-regular fa-star";
        s.style.color = active ? "var(--sun)" : "";
      });
    });
  });

  document.getElementById("shopReviewForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!selectedRating) { ssToast?.("Please select a star rating"); return; }

    const submitBtn = wrap.querySelector("button[type='submit']");
    if (submitBtn) submitBtn.disabled = true;

    try {
      await SS_API.addShopReview(ssShopDetailState.shop.id || ssShopDetailState.shop._id, {
        rating: selectedRating,
        comment: document.getElementById("shopReviewComment").value.trim(),
      });
      ssToast?.("Review submitted, thank you!");

      // With the backend recalculation hook now properly awaited, this
      // re-fetch is guaranteed to reflect the updated ratingsAverage/Count.
      const res = await SS_API.getShopBySlug(ssGetSlugFromUrl());
      ssShopDetailState.shop = res.shop;

      // Refresh the passport header stats immediately, then reload the
      // review list/summary underneath.
      ssUpdateShopRatingStats(res.shop);
      ssLoadShopReviews();
    } catch (err) {
      ssToast?.(err.message || "Couldn't submit review");
      if (submitBtn) submitBtn.disabled = false;
    }
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