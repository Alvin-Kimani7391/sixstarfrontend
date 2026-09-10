(function () {
  const COOKIE_NAME = "ss_ref";
  const STORAGE_KEY = "ss_referral";
  const MAX_AGE_DAYS = 30;

  // Derives the *registrable* parent domain (e.g. "sixstarsuppliers.com" from
  // "www.sixstarsuppliers.com" or "checkout.sixstarsuppliers.com") so the
  // cookie we write is valid across www / bare-domain / any subdomain,
  // instead of being locked to whichever exact host set it.
  // Falls back to no Domain attribute at all on localhost/IP hosts (those
  // can't take a Domain attribute).
  function getCookieDomain() {
    const host = location.hostname;
    if (host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return "";
    const parts = host.split(".");
    if (parts.length < 2) return "";
    // last two labels = registrable domain for a standard TLD (adjust if
    // you're on a multi-part TLD like co.ke — see note below)
    return "." + parts.slice(-2).join(".");
  }
  const COOKIE_DOMAIN = getCookieDomain();

  function readCookie(name) {
    const m = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
    return m ? decodeURIComponent(m[2]) : null;
  }

  function readStoredReferral() {
    const cookieCode = readCookie(COOKIE_NAME);
    if (cookieCode) return { code: cookieCode.toUpperCase(), source: "cookie" };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const ageDays = (Date.now() - (parsed.savedAt || 0)) / 86400000;
        if (parsed.code && ageDays <= MAX_AGE_DAYS) {
          return { code: String(parsed.code).toUpperCase(), type: parsed.type, source: "localStorage" };
        }
      }
    } catch (_) {}
    return null;
  }

  function persistReferral(code, type) {
    const safeCode = encodeURIComponent(code);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ code, type, savedAt: Date.now() }));
    } catch (_) {}
    try {
      const domainAttr = COOKIE_DOMAIN ? `; Domain=${COOKIE_DOMAIN}` : "";
      document.cookie = `${COOKIE_NAME}=${safeCode}; max-age=${MAX_AGE_DAYS * 86400}; path=/${domainAttr}; SameSite=Lax`;
    } catch (_) {}
  }

  window.SS_REFERRAL = {
    getCode() {
      const s = readStoredReferral();
      return s ? s.code : "";
    },
    debug() {
      const s = readStoredReferral();
      console.log("[SS_REFERRAL] hostname:", location.hostname);
      console.log("[SS_REFERRAL] cookie domain used on write:", COOKIE_DOMAIN || "(none — exact host only)");
      console.log("[SS_REFERRAL] raw document.cookie:", document.cookie);
      console.log("[SS_REFERRAL] localStorage:", localStorage.getItem(STORAGE_KEY));
      console.log("[SS_REFERRAL] resolved:", s);
      return s;
    },
    clear() {
      try {
        localStorage.removeItem(STORAGE_KEY);
        const domainAttr = COOKIE_DOMAIN ? `; Domain=${COOKIE_DOMAIN}` : "";
        document.cookie = `${COOKIE_NAME}=; max-age=0; path=/${domainAttr}; SameSite=Lax`;
      } catch (_) {}
    },
  };

  try {
    const params = new URLSearchParams(location.search);
    const ref = params.get("ref");

    // Even with no ?ref= on this page, re-write whatever we already have —
    // refreshes the 30-day window on every page view and re-syncs cookie
    // <-> localStorage if one of them got wiped (in-app browsers like
    // WhatsApp/Instagram webviews are notorious for isolating storage).
    if (!ref) {
      const existing = readStoredReferral();
      if (existing && existing.code) persistReferral(existing.code, existing.type);
      return;
    }

    const code = ref.trim().toUpperCase();
    const intent = params.get("intent") || "";
    const channel = params.get("channel") || "direct";

    let type = "general";
    const path = location.pathname.toLowerCase();
    if (path.includes("register.html")) type = intent === "seller" ? "seller" : "buyer";
    else if (path.includes("product-detail.html")) type = "product";
    else if (path.includes("agent-apply.html")) type = "agent_profile";

    const targetId = type === "product" ? params.get("id") || params.get("productId") : undefined;

    const base = (window.SS_CONFIG && window.SS_CONFIG.API_BASE) || "";
    if (base) {
      fetch(`${base}/agents/track/${encodeURIComponent(code)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, channel, targetId }),
        keepalive: true,
      }).catch(() => {});
    }

    persistReferral(code, type);
  } catch (e) { /* never block page load over tracking */ }
})();