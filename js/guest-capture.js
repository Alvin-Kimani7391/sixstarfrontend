/* ============================================================
   SIX STAR SUPPLIERS — Guest & Buyer Activity Capture
   ============================================================
   Include this on EVERY storefront page, after config.js and
   after auth.js, e.g.:

     <script src="js/config.js"></script>
     <script src="js/referral-tracker.js"></script>
     <script src="js/api.js"></script>
     <script src="js/cart.js"></script>
     <script src="js/auth.js"></script>
     <script src="js/guest-capture.js"></script>
     <script src="js/ui.js"></script>
     <script src="js/home.js"></script>

   FIX (this version): the recently-viewed products in the search
   dropdown now render as compact 2-up cards (thumbnail + name +
   price + green discount pill), matching the "trending products"
   suggestion style seen on modern e-commerce search bars, and the
   "Recent searches" / "Recently viewed" section labels reuse
   ui.js's own .sug-header-bar styling (uppercase, gray, letter-
   spaced) so it matches "TRENDING SEARCHES"-style labels already
   established elsewhere in the UI.
   ============================================================ */
(function () {
  const GUEST_ID_COOKIE = "ss_guest_id";
  const GUEST_ID_STORAGE = "ss_guest_id";
  const EMAIL_BANNER_DISMISS_KEY = "ss_email_banner_dismissed_until";
  const INTERACTION_COUNT_KEY = "ss_guest_interaction_count";

  function apiBase() {
    return (window.SS_CONFIG && window.SS_CONFIG.API_BASE) || "";
  }

  function readCookie(name) {
    const m = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
    return m ? decodeURIComponent(m[2]) : null;
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getGuestId() {
    let id = null;
    try { id = localStorage.getItem(GUEST_ID_STORAGE); } catch (_) {}
    if (!id) id = readCookie(GUEST_ID_COOKIE);
    if (!id) id = uuid();
    try { localStorage.setItem(GUEST_ID_STORAGE, id); } catch (_) {}
    try {
      document.cookie = `${GUEST_ID_COOKIE}=${encodeURIComponent(id)}; max-age=${400 * 86400}; path=/; SameSite=Lax`;
    } catch (_) {}
    return id;
  }

  const guestId = getGuestId();

  function currentEmail() {
    try {
      if (window.SS_AUTH && typeof SS_AUTH.get === "function") {
        const u = SS_AUTH.get();
        return u && u.email ? u.email : "";
      }
    } catch (_) {}
    return "";
  }

  function post(path, body) {
    const base = apiBase();
    if (!base) return Promise.resolve();
    return fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
      credentials: "include",
    }).catch(() => {});
  }

  function bumpInteractionCount() {
    if (currentEmail()) return;
    let n = 0;
    try { n = Number(localStorage.getItem(INTERACTION_COUNT_KEY)) || 0; } catch (_) {}
    n += 1;
    try { localStorage.setItem(INTERACTION_COUNT_KEY, String(n)); } catch (_) {}
    if (n === 3 || n === 8) maybeShowEmailBanner();
  }

  function trackSearch(term) {
    term = (term || "").trim();
    if (!term) return;
    post("/guest/track-search", { term, guestId, email: currentEmail() || undefined });
    bumpInteractionCount();
    cachedActivity = null;
  }

  function trackView(productId) {
    if (!productId) return;
    post("/guest/track-view", { productId, guestId, email: currentEmail() || undefined });
    bumpInteractionCount();
    cachedActivity = null;
  }

  function captureEmail(email, name) {
    if (!email) return Promise.resolve();
    try { localStorage.setItem(EMAIL_BANNER_DISMISS_KEY, String(Date.now() + 365 * 86400000)); } catch (_) {}
    return post("/guest/capture-email", { email, guestId, name });
  }

  function notifyLogin(email) {
    if (!email) return;
    post("/guest/capture-email", { email, guestId });
    cachedActivity = null;
  }

  let cachedActivity = null;
  let lastActivityFetch = 0;

  async function getActivity(forceFresh = false) {
    const base = apiBase();
    if (!base) return { searches: [], viewedProducts: [] };
    const now = Date.now();
    if (!forceFresh && cachedActivity && now - lastActivityFetch < 15000) {
      return cachedActivity;
    }
    const email = currentEmail();
    const params = new URLSearchParams({ guestId });
    if (email) params.set("email", email);
    try {
      const res = await fetch(`${base}/guest/my-activity?${params.toString()}`, { credentials: "include" });
      if (!res.ok) return { searches: [], viewedProducts: [] };
      const data = await res.json();
      cachedActivity = data;
      lastActivityFetch = now;
      return data;
    } catch (_) {
      return { searches: [], viewedProducts: [] };
    }
  }

  window.SSGuestCapture = { trackSearch, trackView, captureEmail, notifyLogin, getActivity, getGuestId: () => guestId };

  function wireHeaderSearch() {
    const form = document.getElementById("headerSearchForm");
    const input = document.getElementById("headerSearchInput");
    const box = document.getElementById("headerSuggestions");
    if (!form || !input || !box) return;

    if (form.dataset.ssgcWired === "1") return;
    form.dataset.ssgcWired = "1";

    form.addEventListener("submit", () => {
      trackSearch(input.value);
    });

    document.addEventListener("click", (e) => {
      if (e.target.closest && e.target.closest("#sugSeeAll")) {
        trackSearch(input.value);
      }
    });

    input.addEventListener("focus", async () => {
      if (input.value.trim()) return;
      const activity = await getActivity();
      if (input.value.trim()) return;
      renderRecentSearchesBox(box, input, activity);
    });
  }

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function fmtPrice(n) {
    if (typeof window.ssFmtPrice === "function") return window.ssFmtPrice(n);
    return "KSh " + (Number(n) || 0).toLocaleString("en-KE");
  }

  // Renders recently-viewed products as compact 2-up cards (thumbnail +
  // name + price + green discount pill) — matching the "trending
  // products" suggestion style — followed by recent search terms as
  // chips under a "RECENT SEARCHES" label styled like ui.js's own
  // .sug-header-bar ("X results" / "TRENDING SEARCHES"-style label).
  function renderRecentSearchesBox(box, input, activity) {
    const searches = (activity && activity.searches) || [];
    const viewed = (activity && activity.viewedProducts) || [];
    if (!searches.length && !viewed.length) {
      box.style.display = "none";
      return;
    }

    const productCards = viewed.slice(0, 4).map((p) => `
      <div class="ssgc-pcard" data-id="${p.id}">
        <img class="ssgc-pcard__img" src="${p.image || "https://placehold.co/120x120/F3F4F8/15161A?text=%20"}" alt="" loading="lazy" onerror="this.style.opacity='0'">
        <div class="ssgc-pcard__info">
          <p class="ssgc-pcard__name">${escapeHtml(p.name)}</p>
          <div class="ssgc-pcard__meta">
            <span class="ssgc-pcard__price">${fmtPrice(p.price)}</span>
            ${p.discountPercent ? `<span class="ssgc-pcard__discount">${p.discountPercent}%</span>` : ""}
          </div>
        </div>
      </div>`).join("");

    const searchChips = searches
      .map((t) => `<button type="button" class="chip ssgc-chip" data-term="${escapeHtml(t)}">${escapeHtml(t)}</button>`)
      .join("");

    box.innerHTML = `
      ${viewed.length ? `
        <div class="sug-header-bar"><span>Recently viewed</span></div>
        <div class="ssgc-pcard-grid">${productCards}</div>` : ""}
      ${searches.length ? `
        <div class="sug-header-bar" ${viewed.length ? 'style="border-top:1px solid var(--line-soft);"' : ""}><span>Recent searches</span></div>
        <div class="ssgc-chip-row">${searchChips}</div>` : ""}`;
    box.style.display = "block";

    box.querySelectorAll(".ssgc-pcard").forEach((card) => {
      card.addEventListener("click", () => {
        window.location.href = `/product-detail.html?id=${card.dataset.id}`;
      });
    });
    box.querySelectorAll(".ssgc-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const term = chip.dataset.term;
        input.value = term;
        box.style.display = "none";
        trackSearch(term);
        window.location.href = `/product.html?search=${encodeURIComponent(term)}`;
      });
    });
  }

  function bannerDismissedRecently() {
    try {
      const until = Number(localStorage.getItem(EMAIL_BANNER_DISMISS_KEY)) || 0;
      return Date.now() < until;
    } catch (_) {
      return false;
    }
  }

  function dismissBannerFor(days) {
    try { localStorage.setItem(EMAIL_BANNER_DISMISS_KEY, String(Date.now() + days * 86400000)); } catch (_) {}
  }

  function maybeShowEmailBanner() {
    if (currentEmail() || bannerDismissedRecently()) return;
    if (document.getElementById("ssgcEmailBanner")) return;

    const banner = document.createElement("div");
    banner.id = "ssgcEmailBanner";
    banner.className = "ssgc-email-banner";
    banner.innerHTML = `
      <div class="ssgc-email-banner__inner">
        <div class="ssgc-email-banner__icon"><i class="fa-regular fa-envelope"></i></div>
        <div class="ssgc-email-banner__text">
          <strong>Want deals on what you're browsing?</strong>
          <span>Leave your email — we'll send offers based on what you search and view.</span>
        </div>
        <form class="ssgc-email-banner__form" id="ssgcEmailForm">
          <input type="email" placeholder="you@example.com" required id="ssgcEmailInput">
          <button type="submit">Notify me</button>
        </form>
        <button type="button" class="ssgc-email-banner__close" id="ssgcEmailClose" aria-label="Close">&times;</button>
      </div>`;
    document.body.appendChild(banner);
    requestAnimationFrame(() => banner.classList.add("show"));

    document.getElementById("ssgcEmailClose").addEventListener("click", () => {
      dismissBannerFor(3);
      banner.classList.remove("show");
      setTimeout(() => banner.remove(), 300);
    });

    document.getElementById("ssgcEmailForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("ssgcEmailInput").value.trim();
      if (!email) return;
      await captureEmail(email);
      banner.querySelector(".ssgc-email-banner__inner").innerHTML =
        `<div class="ssgc-email-banner__text" style="padding:14px 0;"><strong><i class="fa-solid fa-circle-check"></i> Thanks!</strong> <span>We'll email you deals that match what you're into.</span></div>`;
      setTimeout(() => { banner.classList.remove("show"); setTimeout(() => banner.remove(), 300); }, 2200);
    });
  }

  function injectBannerStyles() {
    if (document.getElementById("ssgcStyles")) return;
    const style = document.createElement("style");
    style.id = "ssgcStyles";
    style.textContent = `
      /* ---- recently-viewed product grid, matching the screenshot's
         2-up compact card layout: thumb + name + price + green pill ---- */
      .ssgc-pcard-grid{
        display:grid;
        grid-template-columns:1fr 1fr;
        gap:10px;
        padding:10px 16px 14px;
      }
      .ssgc-pcard{
        display:flex;
        align-items:center;
        gap:9px;
        padding:7px;
        border-radius:var(--radius-s, 9px);
        background:var(--paper-dim, #FDF1E2);
        cursor:pointer;
        transition:background .15s ease;
        min-width:0;
      }
      .ssgc-pcard:hover{ background:var(--line-soft, #F6EEDF); }
      .ssgc-pcard__img{
        width:48px; height:48px; flex-shrink:0;
        object-fit:cover; border-radius:8px;
        background:var(--surface, #fff);
        border:1px solid var(--line, #F0E4D2);
      }
      .ssgc-pcard__info{ min-width:0; flex:1; }
      .ssgc-pcard__name{
        font-size:11.5px; font-weight:600; color:var(--ink, #17181C);
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
        margin-bottom:4px; line-height:1.3;
      }
      .ssgc-pcard__meta{ display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
      .ssgc-pcard__price{
        font-family:var(--font-mono, monospace);
        font-size:12px; font-weight:800; color:var(--ink, #17181C);
      }
      .ssgc-pcard__discount{
        font-size:10px; font-weight:800; color:#fff;
        background:var(--price, #12A150);
        padding:2px 8px; border-radius:999px; line-height:1.4;
        flex-shrink:0;
      }

      /* ---- recent search term chips: reuse the theme's existing
         .chip class so these match product-filter chips elsewhere ---- */
      .ssgc-chip-row{ display:flex; flex-wrap:wrap; gap:8px; padding:10px 16px 14px; }
      .ssgc-chip{ cursor:pointer; }
      .ssgc-chip:hover{
        background:var(--grad-brand-deep, linear-gradient(135deg,#FF5A1F,#da5521));
        border-color:transparent; color:#fff;
      }

      @media (max-width:420px){
        .ssgc-pcard-grid{ padding:8px 12px 12px; gap:8px; }
        .ssgc-pcard__img{ width:42px; height:42px; }
        .ssgc-pcard__name{ font-size:11px; }
        .ssgc-pcard__price{ font-size:11.5px; }
        .ssgc-chip-row{ padding:8px 12px 12px; gap:6px; }
      }

      /* ---- email capture banner (unrelated, unchanged) ---- */
      .ssgc-email-banner { position: fixed; left: 0; right: 0; bottom: -140px; z-index: 9999; transition: bottom .35s ease; display: flex; justify-content: center; padding: 0 12px; }
      .ssgc-email-banner.show { bottom: 16px; }
      .ssgc-email-banner__inner { background: var(--navy-deep, #101d31); color: #fff; border-radius: var(--radius-md, 14px); box-shadow: var(--shadow-card-hover, 0 16px 32px rgba(23,24,28,.14)); padding: 14px 16px; display: flex; align-items: center; gap: 12px; max-width: 560px; width: 100%; flex-wrap: wrap; }
      .ssgc-email-banner__icon { font-size: 20px; color: var(--sun, #FFC93C); flex-shrink: 0; }
      .ssgc-email-banner__text { flex: 1; min-width: 180px; font-size: 12.5px; line-height: 1.5; }
      .ssgc-email-banner__text strong { display: block; font-size: 13.5px; margin-bottom: 2px; }
      .ssgc-email-banner__text span { color: rgba(255,255,255,.7); }
      .ssgc-email-banner__form { display: flex; gap: 6px; }
      .ssgc-email-banner__form input { border: none; border-radius: 8px; padding: 9px 10px; font-size: 12.5px; width: 170px; }
      .ssgc-email-banner__form button { border: none; border-radius: 8px; padding: 9px 14px; font-size: 12.5px; font-weight: 700; background: var(--brand, #FF5A1F); color: #fff; cursor: pointer; white-space: nowrap; }
      .ssgc-email-banner__close { background: none; border: none; color: rgba(255,255,255,.6); font-size: 18px; cursor: pointer; line-height: 1; }
      @media (max-width: 480px) {
        .ssgc-email-banner__form { width: 100%; }
        .ssgc-email-banner__form input { flex: 1; width: auto; }
      }
    `;
    document.head.appendChild(style);
  }

  document.addEventListener("DOMContentLoaded", () => {
    injectBannerStyles();
    wireHeaderSearch();
  });

  document.addEventListener("ss:header-rendered", wireHeaderSearch);
})();