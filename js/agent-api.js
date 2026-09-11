/* ============================================================
   SIX STAR SUPPLIERS — Agent API client
   Cookie-based auth via the `agentToken` cookie (see
   middleware/agentAuthMiddleware.js). Mirrors the request()
   pattern used by js/api.js, scoped to the agent surface:
   /agents/*, /marketing/*, /campaigns/*, /sharing/*,
   /recruitment/*, /commissions/*, /agent-analytics/*,
   /engagement/*.
   ============================================================ */

const SS_AGENT_API = (() => {
  const BASE = SS_CONFIG.API_BASE;

  async function request(
    path,
    { method = "GET", body = null, isForm = false, query, requiresAuth = true } = {}
  ) {
    let url = `${BASE}${path}`;

    if (query) {
      const qs = new URLSearchParams(
        Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "")
      ).toString();
      if (qs) url += `?${qs}`;
    }

    const options = { method, credentials: "include", headers: {} };

    if (body !== undefined && body !== null) {
      if (isForm) {
        options.body = body;
      } else {
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body);
      }
    }

    let response;
    try {
      response = await fetch(url, options);
    } catch (error) {
      throw new Error("Unable to connect to server. Check your internet connection.");
    }

    let data = null;
    const text = await response.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = null; }
    }

    if (response.status === 401) {
      if (
        requiresAuth &&
        !location.pathname.includes("agent-login.html") &&
        !location.pathname.includes("agent-apply.html")
      ) {
        SS_AGENT_AUTH.clear();
        const redirect = encodeURIComponent(location.pathname + location.search);
        location.href = `agent-login.html?redirect=${redirect}`;
      }
      const message = data?.message || data?.error || "Please log in again.";
      const err = new Error(message);
      err.status = 401; err.data = data;
      throw err;
    }

    if (!response.ok) {
      const message = data?.message || data?.error || `Request failed (${response.status})`;
      const err = new Error(message);
      err.status = response.status; err.data = data;
      throw err;
    }

    return data;
  }

  return {
    // ============================================================
    // AGENT AUTH
    // ============================================================
    apply(formData) {
      return request("/agents/apply", { method: "POST", body: formData, isForm: true, requiresAuth: false });
    },
    login({ email, password }) {
      return request("/agents/login", { method: "POST", body: { email, password }, requiresAuth: false });
    },
    logout() {
      return request("/agents/logout", { method: "POST" }).finally(() => SS_AGENT_AUTH.clear());
    },
    forgotPassword({ email }) {
      return request("/agents/forgot-password", { method: "POST", body: { email }, requiresAuth: false });
    },
    resetPassword({ token, password }) {
      return request("/agents/reset-password", { method: "POST", body: { token, password }, requiresAuth: false });
    },
    getMe() {
      return request("/agents/me");
    },
    updateMe(formData) {
      return request("/agents/me", { method: "PATCH", body: formData, isForm: true });
    },
    changePassword(payload) {
      return request("/agents/change-password", { method: "PUT", body: payload });
    },

    // ============================================================
    // PUBLIC REFERRAL
    // ============================================================
    getPublicProfile(slug) {
      return request(`/agents/public/${slug}`, { requiresAuth: false });
    },
    trackClick(code, payload) {
      return request(`/agents/track/${code}`, { method: "POST", body: payload, requiresAuth: false });
    },

    // ============================================================
    // MARKETING CENTER
    // ============================================================
    getBrandKit() {
      return request("/marketing/brand-kit");
    },
    browseAssets(params = {}) {
      return request("/marketing/assets", { query: params });
    },
    getAsset(id) {
      return request(`/marketing/assets/${id}`);
    },
    downloadAsset(id) {
      return request(`/marketing/assets/${id}/download`, { method: "POST" });
    },
    shareAsset(id, payload) {
      return request(`/marketing/assets/${id}/share`, { method: "POST", body: payload });
    },
    toggleFavorite(id) {
      return request(`/marketing/assets/${id}/favorite`, { method: "POST" });
    },
    getMyMarketing() {
      return request("/marketing/my-marketing");
    },

    // ============================================================
    // CAMPAIGNS
    // ============================================================
    listCampaigns() {
      return request("/campaigns");
    },
    getCampaign(id) {
      return request(`/campaigns/${id}`);
    },
    downloadCampaignPack(id) {
      return request(`/campaigns/${id}/download-pack`);
    },

    // ============================================================
    // SHARING / QR / RECRUITMENT MESSAGES
    // ============================================================
    getQr(params) {
      return request("/sharing/qr", { query: params });
    },
    getShareMessage(payload) {
      return request("/sharing/message", { method: "POST", body: payload });
    },
    recruitBuyer(payload) {
      return request("/sharing/recruit-buyer", { method: "POST", body: payload });
    },
        sendInvite(payload) {
      return request("/sharing/send-invite", { method: "POST", body: payload });
    },
    recruitSeller(payload) {
      return request("/sharing/recruit-seller", { method: "POST", body: payload });
    },
    promoteProduct(productId) {
      return request(`/sharing/products/${productId}/promote`, { method: "POST" });
    },

        // ============================================================
    // WHATSAPP PRODUCT PROMO (NEW — mirrors the admin generator,
    // scoped to this agent's own referral code)
    // ============================================================
    searchShareProducts(q) {
      return request("/sharing/products/search", { query: { q } });
    },
    generateWhatsappPromo(payload) {
      return request("/sharing/whatsapp-promo/generate", { method: "POST", body: payload });
    },
    getWhatsappPromos() {
      return request("/sharing/whatsapp-promo");
    },
    deleteWhatsappPromo(id) {
      return request(`/sharing/whatsapp-promo/${id}`, { method: "DELETE" });
    },
    // ============================================================
    // RECRUITMENT CRM (leads)
    // ============================================================
    getFollowups() {
      return request("/recruitment/leads/followups");
    },
    getLeads(params = {}) {
      return request("/recruitment/leads", { query: params });
    },
    createLead(payload) {
      return request("/recruitment/leads", { method: "POST", body: payload });
    },
    getLead(id) {
      return request(`/recruitment/leads/${id}`);
    },
    updateLead(id, payload) {
      return request(`/recruitment/leads/${id}`, { method: "PATCH", body: payload });
    },
    addLeadNote(id, text) {
      return request(`/recruitment/leads/${id}/notes`, { method: "POST", body: { text } });
    },
    deleteLead(id) {
      return request(`/recruitment/leads/${id}`, { method: "DELETE" });
    },

    // ============================================================
    // COMMISSIONS
    // ============================================================
    getMyCommissions(params = {}) {
      return request("/commissions/my", { query: params });
    },
    getMyCommissionSummary() {
      return request("/commissions/my/summary");
    },
    getMyCommission(id) {
      return request(`/commissions/my/${id}`);
    },

    // ============================================================
    // ANALYTICS
    // ============================================================
    getMyAnalytics() {
      return request("/agent-analytics/my");
    },
    getMyChannelAnalytics() {
      return request("/agent-analytics/my/channels");
    },

    // ============================================================
    // ENGAGEMENT (notifications, leaderboard, achievements, academy)
    // ============================================================
    getLeaderboard(params = {}) {
      return request("/engagement/leaderboard", { query: params });
    },
    getAchievementDefs() {
      return request("/engagement/achievements");
    },
    getMyAchievements() {
      return request("/engagement/my-achievements");
    },
    getAcademy() {
      return request("/engagement/academy");
    },
    getNotifications(params = {}) {
      return request("/engagement/notifications", { query: params });
    },
    markNotificationRead(id) {
      return request(`/engagement/notifications/${id}/read`, { method: "PATCH" });
    },
    markAllNotificationsRead() {
      return request("/engagement/notifications/read-all", { method: "PATCH" });
    },
  };
})();