/* ============================================================
   SIX STAR SUPPLIERS — Referral click tracker
   Include this on every public storefront page (index.html,
   register.html, product.html, product-detail.html, etc.) right
   after js/config.js:
       <script src="js/config.js"></script>
       <script src="js/referral-tracker.js"></script>
   Fires POST /api/agents/track/:code exactly once per page load
   when a ?ref= param is present, and remembers the code for 30
   days so a later registration/order can still be attributed even
   if the person doesn't convert on this exact page.
   ============================================================ */
(function () {
  try {
    const params = new URLSearchParams(location.search);
    const ref = params.get("ref");
    if (!ref) return;

    const code = ref.trim().toUpperCase();
    const intent = params.get("intent") || ""; // buyer | seller (from register.html)
    const channel = params.get("channel") || "direct";

    // Infer a click "type" from the page + intent, matching the enum used
    // by ReferralClick.type on the backend.
    let type = "general";
    const path = location.pathname.toLowerCase();
    if (path.includes("register.html")) {
      type = intent === "seller" ? "seller" : "buyer";
    } else if (path.includes("product-detail.html")) {
      type = "product";
    } else if (path.includes("agent-apply.html")) {
      type = "agent_profile";
    }

    const targetId =
      type === "product" ? params.get("id") || params.get("productId") : undefined;

    const base = (window.SS_CONFIG && window.SS_CONFIG.API_BASE) || "";
    if (!base) return;

    // keepalive lets this fire-and-forget even if the user navigates away
    // immediately (common on a landing page).
    fetch(`${base}/agents/track/${encodeURIComponent(code)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, channel, targetId }),
      keepalive: true,
    }).catch(() => {});

    // Remember the referral for 30 days so registration (elsewhere in your
    // auth flow) can still attribute the signup to this agent even if it
    // happens on a different page/visit.
    const payload = { code, type, savedAt: Date.now() };
    localStorage.setItem("ss_referral", JSON.stringify(payload));
    document.cookie = `ss_ref=${code}; max-age=${30 * 24 * 60 * 60}; path=/; SameSite=Lax`;
  } catch (e) {
    /* never block page load over tracking */
  }
})();