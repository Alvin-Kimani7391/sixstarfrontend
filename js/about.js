/* ============================================================
   ABOUT PAGE — about.js
   Load this AFTER js/auth.js and js/ui.js, at the bottom of
   about.html. Everything here is defensive: if a piece of markup
   or the auth module isn't present, that feature just skips
   itself instead of throwing.
   ============================================================ */
(function () {
  "use strict";

  /* ----------------------------------------------------------
     1. AUTH STATE
     Tries window.SS_AUTH first (get/isLoggedIn — matches the
     SS_AUTH module used elsewhere in the project). Falls back to
     a global ssAuthState() if that's what auth.js exposes on this
     page. If neither exists, treats the visitor as logged out.
     ---------------------------------------------------------- */
  function getAuthState() {
    try {
      if (window.SS_AUTH && typeof window.SS_AUTH.isLoggedIn === "function") {
        const loggedIn = window.SS_AUTH.isLoggedIn();
        const user = loggedIn && typeof window.SS_AUTH.get === "function" ? window.SS_AUTH.get() : null;
        return { loggedIn, user };
      }
      if (typeof window.ssAuthState === "function") {
        return window.ssAuthState();
      }
    } catch (e) {
      /* fall through to logged-out default */
    }
    return { loggedIn: false, user: null };
  }

  function isSeller(user) {
    return !!user && (user.role === "wholesaler" || user.role === "retailer");
  }

  /* ----------------------------------------------------------
     2. "OWN A SHOP" CTA — role aware
     Swaps the primary/secondary buttons depending on whether the
     visitor is logged out, a buyer, or a seller.
     ---------------------------------------------------------- */
  function initShopCta(state) {
    const primary = document.getElementById("shopCtaPrimary");
    const secondary = document.getElementById("shopCtaSecondary");
    if (!primary || !secondary) return;

    if (isSeller(state.user)) {
      primary.href = "/seller-dashboard.html";
      primary.innerHTML = '<i class="fa-solid fa-gauge"></i> Go to Seller Dashboard';
      secondary.href = "/seller-dashboard.html#shop";
      secondary.innerHTML = '<i class="fa-solid fa-store"></i> Manage My Shop';
      secondary.style.display = "";
    } else if (state.loggedIn) {
      primary.href = "/register.html";
      primary.innerHTML = '<i class="fa-solid fa-store"></i> Become a Seller';
      secondary.style.display = "none";
    }
    /* else: leave logged-out defaults (Register / Seller Login) as-is */
  }

  /* ----------------------------------------------------------
     3. BUYER / SELLER ROLE TABS
     Any element with [data-role-tab] toggles the matching
     [data-role-panel]. Auto-selects "seller" on load if the
     visitor is a logged-in seller, otherwise defaults to "buyer".
     ---------------------------------------------------------- */
  function initRoleTabs(state) {
    const tabs = Array.from(document.querySelectorAll("[data-role-tab]"));
    const panels = Array.from(document.querySelectorAll("[data-role-panel]"));
    if (!tabs.length || !panels.length) return;

    function activate(role) {
      tabs.forEach((t) => t.classList.toggle("active", t.dataset.roleTab === role));
      panels.forEach((p) => p.classList.toggle("active", p.dataset.rolePanel === role));
    }

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => activate(tab.dataset.roleTab));
    });

    activate(isSeller(state.user) ? "seller" : "buyer");
  }

  /* ----------------------------------------------------------
     4. FAQ AUDIENCE FILTER
     Buttons with [data-faq-filter="all|buyer|seller"] show/hide
     .faq-item elements based on their [data-audience] attribute.
     ---------------------------------------------------------- */
  function initFaqFilter() {
    const buttons = Array.from(document.querySelectorAll("[data-faq-filter]"));
    const items = Array.from(document.querySelectorAll(".faq-item[data-audience]"));
    if (!buttons.length || !items.length) return;

    function applyFilter(filter) {
      items.forEach((item) => {
        const audience = item.dataset.audience || "all";
        const show = filter === "all" || audience === "all" || audience === filter;
        item.hidden = !show;
      });
      buttons.forEach((b) => b.classList.toggle("active", b.dataset.faqFilter === filter));
    }

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => applyFilter(btn.dataset.faqFilter));
    });

    applyFilter("all");
  }

  /* ----------------------------------------------------------
     5. ANIMATED STAT COUNTERS
     Counts each [data-target] stat number up from 0 once it
     scrolls into view. Numbers are read from data-target so the
     real figures can be swapped in from an API later without
     touching this file — see the TODO below.
     ---------------------------------------------------------- */
  function initStatCounters() {
    const counters = Array.from(document.querySelectorAll(".stat-card__num[data-target]"));
    if (!counters.length) return;

    // TODO(Kimani): if/when a public stats endpoint exists (e.g.
    // GET /api/stats/public returning { sellers, products, counties, orders }),
    // fetch it here and overwrite each element's data-target before
    // the observer fires, instead of the static placeholder values
    // currently sitting in about.html.

    function animate(el) {
      const target = parseInt(el.dataset.target, 10) || 0;
      const duration = 1200;
      const start = performance.now();

      function tick(now) {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
        el.textContent = Math.round(eased * target).toLocaleString();
        if (progress < 1) requestAnimationFrame(tick);
        else el.textContent = target.toLocaleString();
      }
      requestAnimationFrame(tick);
    }

    if (!("IntersectionObserver" in window)) {
      counters.forEach(animate);
      return;
    }

    const observer = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            animate(entry.target);
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.4 }
    );

    counters.forEach((el) => observer.observe(el));
  }

  /* ----------------------------------------------------------
     6. SCROLL REVEAL
     Fades/slides in any .reveal element as it enters the
     viewport. Respects prefers-reduced-motion.
     ---------------------------------------------------------- */
  function initScrollReveal() {
    const items = Array.from(document.querySelectorAll(".reveal"));
    if (!items.length) return;

    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced || !("IntersectionObserver" in window)) {
      items.forEach((el) => el.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );

    items.forEach((el) => observer.observe(el));
  }

  /* ---------------------------------------------------------- */
  document.addEventListener("DOMContentLoaded", () => {
    const state = getAuthState();
    initShopCta(state);
    initRoleTabs(state);
    initFaqFilter();
    initStatCounters();
    initScrollReveal();
  });
})();