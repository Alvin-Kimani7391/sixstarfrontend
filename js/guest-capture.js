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
     <script src="js/guest-capture.js"></script>   <!-- NEW -->
     <script src="js/ui.js"></script>
     <script src="js/home.js"></script>            <!-- or product-detail.js, etc -->

   WHY THIS FILE EXISTS:
   The admin Email Marketing & CRM panel personalizes promotional emails
   using each person's real search terms and recently viewed products
   (see EmailSubscriber on the backend). Nothing populates that data on
   its own — this script is what actually calls the backend's
   /api/guest/track-search and /api/guest/track-view endpoints, for BOTH
   anonymous guests (via a persistent guestId) and logged-in buyers (by
   also sending their email, so the history attaches to their real
   account). Without this file included, the CRM will always look empty,
   no matter how much backend logic exists behind it.

   WHAT IT DOES, WITHOUT TOUCHING ui.js (other than one event dispatch
   ui.js fires once the header DOM exists — see ss:header-rendered below):
   - Generates/persists an anonymous guestId (localStorage + cookie).
   - Hooks the EXISTING header search form (#headerSearchForm) and the
     "see all results" link ui.js renders inside #headerSuggestions, via
     event delegation — no edits to ui.js's own logic needed.
   - Adds a focus listener to #headerSearchInput that shows the person's
     own recent searches as clickable chips INSIDE the same
     #headerSuggestions box ui.js already uses, whenever the box is empty.
     ui.js's own listeners keep working exactly as before.
   - Exposes window.SSGuestCapture.trackView(productId) for product-
     detail.js to call.
   - Shows a small, dismissible "get deals in your inbox" banner to
     guests after a couple of searches/views, wired to
     /api/guest/capture-email.
   - After a Google One Tap / Google button sign-in, immediately links
     the guest's existing browsing history to their new account.

   WIRING NOTE (fixes a real bug): the header markup (#headerSearchForm
   etc.) is injected by ui.js's ssRenderHeader(), which runs in ui.js's
   own DOMContentLoaded handler — registered AFTER this file's handler
   since this script loads before ui.js. That means an attempt to wire
   the search box on THIS file's own DOMContentLoaded fires too early:
   the form doesn't exist yet. So wiring here is driven by a
   "ss:header-rendered" CustomEvent that ssRenderHeader() dispatches
   once it has actually built the header DOM — with an immediate
   best-effort attempt on DOMContentLoaded too, in case some future
   page renders the header before this script's handler runs. Both
   paths are safe to fire — wireHeaderSearch() guards against wiring
   the same form twice.
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
    if (!id) {
      id = uuid();
    }
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
    if (currentEmail()) return; // only nudge guests, not people already identified
    let n = 0;
    try { n = Number(localStorage.getItem(INTERACTION_COUNT_KEY)) || 0; } catch (_) {}
    n += 1;
    try { localStorage.setItem(INTERACTION_COUNT_KEY, String(n)); } catch (_) {}
    if (n === 3 || n === 8) maybeShowEmailBanner();
  }

  // ---------------- public tracking API ----------------

  function trackSearch(term) {
    term = (term || "").trim();
    if (!term) return;
    post("/guest/track-search", { term, guestId, email: currentEmail() || undefined });
    bumpInteractionCount();
    // Invalidate the cached activity so the very next focus on the search
    // box picks up this brand-new term instead of a stale list.
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

  // Called right after a successful login/Google sign-in so this guest's
  // pre-login browsing history merges onto their real account immediately,
  // instead of waiting for their next search/view.
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

  // ---------------- header search hooks (no ui.js logic edits needed) ----------------

  function wireHeaderSearch() {
    const form = document.getElementById("headerSearchForm");
    const input = document.getElementById("headerSearchInput");
    const box = document.getElementById("headerSuggestions");
    if (!form || !input || !box) return; // header not rendered yet — a later
                                          // ss:header-rendered call will retry

    // Guard against wiring the same form twice if this ever runs more than
    // once (e.g. the immediate DOMContentLoaded attempt AND the
    // ss:header-rendered event both succeed on some future page layout).
    if (form.dataset.ssgcWired === "1") return;
    form.dataset.ssgcWired = "1";

    // Track the term the moment a real search is submitted (form submit
    // fires alongside ui.js's own submit listener — this one just tracks,
    // it doesn't preventDefault or navigate, so ui.js's navigation still
    // happens exactly as before).
    form.addEventListener("submit", () => {
      trackSearch(input.value);
    });

    // ui.js renders a "#sugSeeAll" link inside the suggestions box when
    // there are search results — clicking it also counts as a real search.
    document.addEventListener("click", (e) => {
      if (e.target.closest && e.target.closest("#sugSeeAll")) {
        trackSearch(input.value);
      }
    });

    // Recent-searches dropdown: only kicks in when the input is EMPTY and
    // focused — ui.js's own focus handler already no-ops in that case, so
    // there's no conflict. The moment the person types anything, ui.js's
    // own "input" listener takes back over and replaces this box's content.
    input.addEventListener("focus", async () => {
      if (input.value.trim()) return;
      const activity = await getActivity();
      if (input.value.trim()) return; // person started typing while we waited
      renderRecentSearchesBox(box, input, activity);
    });
  }

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderRecentSearchesBox(box, input, activity) {
    const searches = (activity && activity.searches) || [];
    const viewed = (activity && activity.viewedProducts) || [];
    if (!searches.length && !viewed.length) {
      box.style.display = "none";
      return;
    }

    const searchChips = searches
      .map((t) => `<button type="button" class="ssgc-chip" data-term="${escapeHtml(t)}"><i class="fa-solid fa-clock-rotate-left"></i> ${escapeHtml(t)}</button>`)
      .join("");

    const viewedItems = viewed.slice(0, 4).map((p) => `
      <div class="ssgc-viewed-item" data-id="${p.id}">
        <img src="${p.image || "https://placehold.co/60x60/F3F4F8/15161A?text=%20"}" alt="">
        <div>
          <div class="ssgc-viewed-name">${escapeHtml(p.name)}</div>
          <div class="ssgc-viewed-price">KSh ${Number(p.price || 0).toLocaleString()}</div>
        </div>
      </div>`).join("");

    box.innerHTML = `
      <div class="ssgc-recent-wrap">
        ${searches.length ? `
          <div class="ssgc-recent-headrow">
            <span class="ssgc-recent-head"><i class="fa-solid fa-clock-rotate-left"></i> Your recent searches</span>
          </div>
          <div class="ssgc-chip-row">${searchChips}</div>` : ""}
        ${viewed.length ? `
          <div class="ssgc-recent-headrow" style="margin-top:12px;">
            <span class="ssgc-recent-head"><i class="fa-regular fa-eye"></i> Recently viewed</span>
          </div>
          <div class="ssgc-viewed-list">${viewedItems}</div>` : ""}
      </div>`;
    box.style.display = "block";

    box.querySelectorAll(".ssgc-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const term = chip.dataset.term;
        input.value = term;
        box.style.display = "none";
        trackSearch(term);
        window.location.href = `/product.html?search=${encodeURIComponent(term)}`;
      });
    });
    box.querySelectorAll(".ssgc-viewed-item").forEach((item) => {
      item.addEventListener("click", () => {
        window.location.href = `/product-detail.html?id=${item.dataset.id}`;
      });
    });
  }

  // ---------------- email capture banner (guests only) ----------------

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

  // Injected once, using the same design tokens defined in style.css
  // (--paper-dim, --ink, --line, --brand, --radius-md, --shadow-card,
  // --font-mono, etc.) so this box automatically matches light/dark mode
  // and the rest of the theme instead of carrying its own fixed palette.
  function injectBannerStyles() {
    if (document.getElementById("ssgcStyles")) return;
    const style = document.createElement("style");
    style.id = "ssgcStyles";
    style.textContent = `
      .ssgc-recent-wrap { padding: 12px 16px 14px; }
      .ssgc-recent-headrow { display:flex; align-items:center; padding-bottom:8px; border-bottom:1px solid var(--line-soft, #F6EEDF); margin-bottom:10px; }
      .ssgc-recent-head { font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .5px; color: var(--ink-faint, #9a9ba5); display:flex; align-items:center; gap:6px; }
      .ssgc-recent-head i { color: var(--brand, #FF5A1F); font-size: 11px; }
      .ssgc-chip-row { display: flex; flex-wrap: wrap; gap: 8px; }
      .ssgc-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight:600; padding: 7px 13px; border-radius: 999px; border: 1px solid var(--line, #F0E4D2); background: var(--paper-dim, #FDF1E2); cursor: pointer; color: var(--ink-soft, #6b6d78); transition: .15s ease; }
      .ssgc-chip i { color: var(--ink-faint, #9a9ba5); font-size: 10.5px; }
      .ssgc-chip:hover { background: var(--brand, #FF5A1F); border-color: var(--brand, #FF5A1F); color: #fff; }
      .ssgc-chip:hover i { color: #fff; }
      .ssgc-viewed-list { display: flex; flex-direction: column; gap: 6px; }
      .ssgc-viewed-item { display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 6px; border-radius: var(--radius-s, 9px); transition: background .15s ease; }
      .ssgc-viewed-item:hover { background: var(--paper-dim, #FDF1E2); }
      .ssgc-viewed-item img { width: 42px; height: 42px; object-fit: cover; border-radius: 8px; background: var(--paper-dim, #FDF1E2); flex-shrink: 0; border: 1px solid var(--line, #F0E4D2); }
      .ssgc-viewed-name { font-size: 12.5px; font-weight: 600; color: var(--ink, #17181C); line-height: 1.35; }
      .ssgc-viewed-price { font-size: 12px; color: var(--brand-dark, #da5521); font-weight: 800; font-family: var(--font-mono, monospace); margin-top:1px; }

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
        .ssgc-recent-wrap { padding: 10px 14px 12px; }
        .ssgc-chip { font-size: 12px; padding: 6px 11px; }
      }
    `;
    document.head.appendChild(style);
  }

  document.addEventListener("DOMContentLoaded", () => {
    injectBannerStyles();
    wireHeaderSearch(); // best-effort — a no-op if the header hasn't rendered yet
  });

  // The real wiring path: ui.js's ssRenderHeader() dispatches this once the
  // header DOM (form/input/suggestions box) actually exists.
  document.addEventListener("ss:header-rendered", wireHeaderSearch);
})();