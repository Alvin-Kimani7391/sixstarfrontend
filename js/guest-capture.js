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
   dropdown are now a horizontally-scrolling snap carousel of
   image-forward tiles — floating discount ribbon over the image,
   an edge fade so the rail visually signals there's more to swipe,
   and a tiny "N items" pill in the header when the list overflows
   — instead of the earlier static 2-up grid. "Recent searches"
   below it stays as a chip row, styled with ui.js's own
   .sug-header-bar label treatment.
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

  // Renders recently-viewed products as a horizontally-scrolling, snap-
  // aligned carousel of image-forward tiles (floating discount ribbon,
  // bold mono price) — reads as a live product rail rather than a static
  // grid — followed by recent search terms as chips under a header styled
  // like ui.js's own .sug-header-bar ("TRENDING SEARCHES"-style label).
  function renderRecentSearchesBox(box, input, activity) {
    const searches = (activity && activity.searches) || [];
    const viewed = (activity && activity.viewedProducts) || [];
    if (!searches.length && !viewed.length) {
      box.style.display = "none";
      return;
    }

    const viewedSlice = viewed.slice(0, 10);
    const overflow = viewedSlice.length > 3;

    const productTiles = viewedSlice.map((p) => `
      <div class="ssgc-tile" data-id="${p.id}">
        <div class="ssgc-tile__imgwrap">
          <img class="ssgc-tile__img" src="${p.image || "https://placehold.co/160x160/F3F4F8/15161A?text=%20"}" alt="" loading="lazy" onerror="this.style.opacity='0'">
          ${p.discountPercent ? `<span class="ssgc-tile__ribbon">-${p.discountPercent}%</span>` : ""}
        </div>
        <p class="ssgc-tile__name">${escapeHtml(p.name)}</p>
        <span class="ssgc-tile__price">${fmtPrice(p.price)}</span>
      </div>`).join("");

    const searchChips = searches
      .map((t) => `<button type="button" class="chip ssgc-chip" data-term="${escapeHtml(t)}">${escapeHtml(t)}</button>`)
      .join("");

    box.innerHTML = `
      ${viewed.length ? `
        <div class="sug-header-bar ssgc-rail-header">
          <span>Recently viewed</span>
          ${overflow ? `<span class="ssgc-rail-count">${viewedSlice.length}</span>` : ""}
        </div>
        <div class="ssgc-rail-wrap">
          <div class="ssgc-rail">${productTiles}</div>
        </div>` : ""}
      ${searches.length ? `
        <div class="sug-header-bar" ${viewed.length ? 'style="border-top:1px solid var(--line-soft);"' : ""}><span>Recent searches</span></div>
        <div class="ssgc-chip-row">${searchChips}</div>` : ""}`;
    box.style.display = "block";

    box.querySelectorAll(".ssgc-tile").forEach((tile) => {
      tile.addEventListener("click", () => {
        window.location.href = `/product-detail.html?id=${tile.dataset.id}`;
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
      /* ---- recently-viewed rail header: label + small overflow count pill ---- */
      .ssgc-rail-header{ display:flex; align-items:center; justify-content:space-between; gap:8px; }
      .ssgc-rail-count{
        font-family:var(--font-mono, monospace);
        font-size:10.5px; font-weight:800; letter-spacing:0;
        color:var(--brand, #FF5A1F);
        background:rgba(255,90,31,.1);
        padding:2px 7px; border-radius:999px;
        margin-right:16px;
      }

      /* ---- horizontal snap-scroll product rail ----
         Cards are image-forward tiles with a floating discount ribbon —
         built to read as a live carousel, not a static grid. Edge fade
         (mask-image) signals there's more without needing arrow buttons. */
      .ssgc-rail-wrap{
        position:relative;
        -webkit-mask-image: linear-gradient(to right, transparent 0, #000 20px, #000 calc(100% - 28px), transparent 100%);
        mask-image: linear-gradient(to right, transparent 0, #000 20px, #000 calc(100% - 28px), transparent 100%);
      }
      .ssgc-rail{
        display:flex;
        gap:12px;
        overflow-x:auto;
        scroll-snap-type:x proximity;
        padding:10px 20px 16px;
        scrollbar-width:none;
      }
      .ssgc-rail::-webkit-scrollbar{ display:none; }
      .ssgc-tile{
        flex:0 0 auto;
        width:112px;
        scroll-snap-align:start;
        cursor:pointer;
        transition:transform .18s cubic-bezier(.2,.7,.3,1);
      }
      .ssgc-tile:active{ transform:scale(.96); }
      .ssgc-tile__imgwrap{
        position:relative;
        width:112px; height:112px;
        border-radius:var(--radius-s, 12px);
        overflow:hidden;
        background:var(--paper-dim, #FDF1E2);
        border:1px solid var(--line, #F0E4D2);
        margin-bottom:7px;
      }
      .ssgc-tile__img{ width:100%; height:100%; object-fit:cover; display:block; }
      .ssgc-tile__ribbon{
        position:absolute; top:6px; left:6px;
        font-size:10px; font-weight:800; color:#fff;
        background:var(--price, #12A150);
        padding:3px 7px; border-radius:7px;
        line-height:1.2;
        box-shadow:0 2px 6px rgba(18,161,80,.35);
      }
      .ssgc-tile__name{
        font-size:11.5px; font-weight:600; color:var(--ink, #17181C);
        line-height:1.3;
        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;
        overflow:hidden;
        margin-bottom:3px;
        min-height:29px;
      }
      .ssgc-tile__price{
        font-family:var(--font-mono, monospace);
        font-size:12.5px; font-weight:800; color:var(--ink, #17181C);
      }

      /* ---- recent search term chips: reuse the theme's existing
         .chip class so these match product-filter chips elsewhere ---- */
      .ssgc-chip-row{ display:flex; flex-wrap:wrap; gap:8px; padding:10px 16px 14px; }
      .ssgc-chip{
        cursor:pointer;
        flex:0 0 auto;        /* stop flexbox shrinking the button below its text */
        white-space:nowrap;   /* stop text wrapping inside the button, which is what
                                  was squashing them into near-square "circles" */
        max-width:100%;       /* still allow it to fit inside a very narrow phone screen */
        overflow:hidden;
        text-overflow:ellipsis;
      }
      .ssgc-chip:hover{
        background:var(--grad-brand-deep, linear-gradient(135deg,#FF5A1F,#da5521));
        border-color:transparent; color:#fff;
      }

      @media (max-width:420px){
        .ssgc-rail{ padding:8px 16px 14px; gap:10px; }
        .ssgc-tile, .ssgc-tile__imgwrap{ width:98px; }
        .ssgc-tile__imgwrap{ height:98px; }
        .ssgc-tile__name{ font-size:11px; min-height:27px; }
        .ssgc-tile__price{ font-size:12px; }
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