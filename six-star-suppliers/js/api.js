/* ============================================================
   SIX STAR SUPPLIERS — API client
   Cookie-based authentication (httpOnly JWT cookie from Express backend).

   This merges two earlier versions of api.js into one:
   - the newer one (auth + seller/admin product & order management)
   - the older one (buyer profile, buyer orders, reviews, agents)

   Where both files had a different name for the same endpoint, both
   names are kept as aliases so nothing already wired up in your HTML
   breaks. See the comments next to createOrder/placeOrder and
   addReview/postReview below.

   Also includes:
   - Seller verification (identity/business/tax onboarding gate, now
     preceded by a mandatory email-OTP step — see sendEmailOtp/verifyEmailOtp)
   - Legal documents (Terms, Seller Agreement, policies) + seller acceptance
   - Flash Sale (daily 2:00 PM – midnight deals): seller submission,
     seller's own submission list/cancel, and the public "active now" feed
   ============================================================ */

const SS_API = (() => {
  const BASE = SS_CONFIG.API_BASE;

  async function request(
    path,
    { method = "GET", body = null, isForm = false, query, requiresAuth = true } = {}
  ) {
    let url = `${BASE}${path}`;

    if (query) {
      const qs = new URLSearchParams(
        Object.entries(query).filter(
          ([, value]) => value !== undefined && value !== null && value !== ""
        )
      ).toString();
      if (qs) url += `?${qs}`;
    }

    const options = { method, credentials: "include", headers: {} };

    if (body !== undefined && body !== null) {
      if (isForm) {
        options.body = body; // FormData — browser sets the multipart header
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
        !window.location.pathname.includes("login.html") &&
        !window.location.pathname.includes("register.html")
      ) {
        SS_AUTH.clear();
        const redirect = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `login.html?redirect=${redirect}`;
      }
      const message = data?.message || data?.error || "Please login again.";
      const err = new Error(message);
      err.status = 401;
      err.data = data;
      throw err;
    }

    if (!response.ok) {
      const message = data?.message || data?.error || `Request failed (${response.status})`;
      const err = new Error(message);
      err.status = response.status;
      err.data = data;
      throw err;
    }

    return data;
  }

  return {
    // ============================================================
    // AUTH
    // ============================================================
    register(payload) {
      return request("/auth/register", { method: "POST", body: payload, requiresAuth: false });
    },
    login({ email, password }) {
      return request("/auth/login", { method: "POST", body: { email, password }, requiresAuth: false });
    },
    // Sends the Google ID token (from Google Identity Services) to the backend for verification.
    googleAuth({ credential }) {
      return request("/auth/google", { method: "POST", body: { credential }, requiresAuth: false });
    },


    // Second step of a seller login gated by a login OTP.
    verifyLoginOtp({ otpToken, code }) {
      return request("/auth/login/verify-otp", { method: "POST", body: { otpToken, code }, requiresAuth: false });
    },
    resendLoginOtp({ otpToken }) {
      return request("/auth/login/resend-otp", { method: "POST", body: { otpToken }, requiresAuth: false });
    },


    // Always resolves (never throws for "email not found") — the backend intentionally
    // returns the same generic message either way, so it can't be used to enumerate accounts.
    forgotPassword({ email }) {
      return request("/auth/forgot-password", { method: "POST", body: { email }, requiresAuth: false });
    },
    // token comes from the ?token= query param on reset-password.html (the link that was emailed).
    resetPassword(token, { password }) {
      return request(`/auth/reset-password/${token}`, { method: "POST", body: { password }, requiresAuth: false });
    },
    logout() {
      return request("/auth/logout", { method: "POST" }).finally(() => { SS_AUTH.clear(); });
    },
    getMe() {
      return request("/auth/me", { method: "GET" });
    },

    // ============================================================
    // USER PROFILE  (from /users/* — separate from /auth/me)
    // ============================================================
    getProfile() {
      return request("/users/profile", { requiresAuth: true });
    },
    updateProfile(payload) {
      return request("/users/profile", { method: "PUT", body: payload, requiresAuth: true });
    },
    changePassword(payload) {
      return request("/users/change-password", { method: "PUT", body: payload, requiresAuth: true });
    },
    getRecentlyViewed() {
      return request("/users/recently-viewed", { requiresAuth: true });
    },
    trackProductView(productId) {
      return request(`/users/recently-viewed/${productId}`, { method: "POST", requiresAuth: true });
    },

    // ============================================================
    // SELLER PROFILE (post-approval, editable-only-safe-fields view)
    // ============================================================
    getMySellerProfile() {
      return request("/seller-profile/me", { requiresAuth: true });
    },
    updateMySellerProfile(formData) {
      return request("/seller-profile/me", { method: "PUT", body: formData, isForm: true, requiresAuth: true });
    },

    // ============================================================
    // PRODUCTS - PUBLIC
    // ============================================================
    getProducts(params = {}) {
      return request("/products", { query: params, requiresAuth: false });
    },
    getProduct(id) {
      return request(`/products/${id}`, { requiresAuth: false });
    },
    // Public "someone looked at this product" ping — separate from trackProductView
    // above (which tracks the logged-in BUYER's own recently-viewed list). This one
    // increments the product's own view counter and feeds the seller's analytics
    // dashboard. Fires for guests too, so it never requires auth.
    trackProductViewCount(id) {
      return request(`/products/${id}/view`, { method: "PATCH", requiresAuth: false });
    },

    // ============================================================
    // SELLER PRODUCTS
    // ============================================================
    getMyProducts(params = {}) {
      return request("/products/my-products", { query: params, requiresAuth: true });
    },
    createProduct(formData) {
      return request("/products", { method: "POST", body: formData, isForm: true, requiresAuth: true });
    },
    updateProduct(id, formData) {
      return request(`/products/${id}`, { method: "PUT", body: formData, isForm: true, requiresAuth: true });
    },
    submitProduct(id) {
      return request(`/products/${id}/submit`, { method: "PATCH", requiresAuth: true });
    },
    // Seller/wholesaler product-view analytics: lifetime + 14-day totals, a daily
    // trend, and a per-product view-count breakdown. Used by the dashboard's
    // Analytics screen.
    getMyProductAnalytics() {
      return request("/products/analytics", { requiresAuth: true });
    },

    // ============================================================
    // FLASH SALE (daily 2:00 PM – midnight deals)
    // ============================================================
    // Public feed of everything currently live right now, with stock left.
    getActiveFlashSales() {
      return request("/flash-sales/active", { requiresAuth: false });
    },
    // Seller submits a live product — { productId, flashSalePrice, stock, saleDate }.
    // saleDate is a plain "YYYY-MM-DD"; the backend derives the 2:00 PM–midnight window.
    submitFlashSale(payload) {
      return request("/flash-sales", { method: "POST", body: payload, requiresAuth: true });
    },
    // Seller's own submissions, any status (pending/approved/scheduled/active/ended/etc).
    getMyFlashSales() {
      return request("/flash-sales/my", { requiresAuth: true });
    },
    // Cancel a submission that hasn't gone live yet.
    cancelFlashSale(id) {
      return request(`/flash-sales/${id}/cancel`, { method: "PATCH", requiresAuth: true });
    },

    // ============================================================
    // SHOP (seller's own optional shop)
    // ============================================================
    // Returns { success, shop } where shop is null if the seller hasn't created one yet.
    getMyShop() {
      return request("/shops/my-shop", { requiresAuth: true });
    },
    // Accepts EITHER a FormData (when the seller is uploading a logo/banner
    // file — the dashboard's create/edit shop form now always sends this) OR
    // a plain object (used internally by things like the Settings tab's
    // layout/theme-only updates, which don't touch images). isForm is picked
    // automatically so both call shapes keep working.
    createShop(payload) {
      return request("/shops", {
        method: "POST",
        body: payload,
        isForm: payload instanceof FormData,
        requiresAuth: true,
      });
    },
    updateMyShop(payload) {
      return request("/shops/my-shop", {
        method: "PUT",
        body: payload,
        isForm: payload instanceof FormData,
        requiresAuth: true,
      });
    },
    // Pause ("go dark" on the storefront) / resume an already-approved shop.
    // Matches PATCH /api/shops/my-shop/toggle-active on the backend.
    toggleShopActive() {
      return request("/shops/my-shop/toggle-active", { method: "PATCH", requiresAuth: true });
    },

    // ============================================================
    // SELLER VERIFICATION (onboarding gate — must be approved before
    // the seller dashboard is accessible)
    // ============================================================

    // ---- Email verification (must pass before submitVerification is accepted) ----
    // Sends/resends a 6-digit code to the logged-in seller's account email.
    // Returns { success, email, expiresInSeconds } or { success, alreadyVerified: true }.
    sendEmailOtp() {
      return request("/seller-verification/email/send-code", { method: "POST", requiresAuth: true });
    },
    // Returns { success, verified, email }.
    verifyEmailOtp(code) {
      return request("/seller-verification/email/verify-code", {
        method: "POST",
        body: { code },
        requiresAuth: true,
      });
    },

    // Returns { success, verification, eligibleTiers, emailVerified, email, categoryOptions } —
    // verification is null if the seller hasn't submitted anything yet.
    getMyVerification() {
      return request("/seller-verification/me", { requiresAuth: true });
    },
    // formData: tier, identity (incl. dateOfBirth/nationality) / tax / business
    // (incl. businessAge) / businessAddress / warehouse* / return* / store*
    // (incl. storeDescription) / categories (JSON array string) / social
    // fields, plus any of idFrontImage / idBackImage / selfieWithId /
    // kraPinCertificate / vatCertificate / registrationCertificate /
    // cr12Document / partnershipAgreement / businessLicenseDoc / storeLogo /
    // storeBanner file fields that apply.
    submitVerification(formData) {
      return request("/seller-verification", { method: "POST", body: formData, isForm: true, requiresAuth: true });
    },

    // ============================================================
    // LEGAL DOCUMENTS (Terms, Seller Agreement, policies) —
    // sellers must accept every published mandatory one to get verified
    // ============================================================
    // Returns { success, documents } — each document flagged with `accepted`.
    getRequiredLegalDocuments() {
      return request("/legal-documents/required", { requiresAuth: true });
    },
    acceptLegalDocument(id) {
      return request(`/legal-documents/${id}/accept`, { method: "POST", requiresAuth: true });
    },

    // ============================================================
    // ADMIN — SELLER VERIFICATION REVIEW
    // ============================================================
    getPendingVerifications() {
      return request("/admin/seller-verifications/pending", { requiresAuth: true });
    },
    approveVerification(id) {
      return request(`/admin/seller-verifications/${id}/approve`, { method: "PATCH", requiresAuth: true });
    },
    rejectVerification(id, reason) {
      return request(`/admin/seller-verifications/${id}/reject`, { method: "PATCH", body: { reason }, requiresAuth: true });
    },

    // ============================================================
    // ADMIN — LEGAL DOCUMENT MANAGEMENT
    // ============================================================
    getAllLegalDocumentsAdmin(params = {}) {
      return request("/admin/legal-documents", { query: params, requiresAuth: true });
    },
    createLegalDocument(formData) {
      return request("/admin/legal-documents", { method: "POST", body: formData, isForm: true, requiresAuth: true });
    },
    updateLegalDocument(id, formData) {
      return request(`/admin/legal-documents/${id}`, { method: "PATCH", body: formData, isForm: true, requiresAuth: true });
    },
    publishLegalDocument(id) {
      return request(`/admin/legal-documents/${id}/publish`, { method: "PATCH", requiresAuth: true });
    },
    archiveLegalDocument(id) {
      return request(`/admin/legal-documents/${id}/archive`, { method: "PATCH", requiresAuth: true });
    },
    deleteLegalDocument(id) {
      return request(`/admin/legal-documents/${id}`, { method: "DELETE", requiresAuth: true });
    },
    getDocumentAcceptances(id) {
      return request(`/admin/legal-documents/${id}/acceptances`, { requiresAuth: true });
    },

    // ============================================================
    // ADMIN — FLASH SALE REVIEW
    // ============================================================
    getPendingFlashSalesAdmin() {
      return request("/admin/flash-sales/pending", { requiresAuth: true });
    },
    getAllFlashSalesAdmin(params = {}) {
      return request("/admin/flash-sales", { query: params, requiresAuth: true });
    },
    approveFlashSaleAdmin(id) {
      return request(`/admin/flash-sales/${id}/approve`, { method: "PATCH", requiresAuth: true });
    },
    rejectFlashSaleAdmin(id, reason) {
      return request(`/admin/flash-sales/${id}/reject`, { method: "PATCH", body: { reason }, requiresAuth: true });
    },

    // ============================================================
    // ADMIN PRODUCTS
    // ============================================================
    getPendingProducts(params = {}) {
      return request("/admin/products/pending", { query: params, requiresAuth: true });
    },
    approveProduct(id, payload) {
      return request(`/admin/products/${id}/approve`, { method: "PATCH", body: payload, requiresAuth: true });
    },
    rejectProduct(id, reason) {
      return request(`/admin/products/${id}/reject`, { method: "PATCH", body: { reason }, requiresAuth: true });
    },

    // ============================================================
    // ORDERS
    // ============================================================
    // createOrder / placeOrder both POST /orders — kept as aliases since each
    // version of api.js used a different name for checkout. Point any new code
    // at createOrder; placeOrder stays only so older pages don't break.
    createOrder(payload) {
      return request("/orders", { method: "POST", body: payload, requiresAuth: true });
    },
    placeOrder(payload) {
      return request("/orders", { method: "POST", body: payload, requiresAuth: true });
    },
    getMyOrders() {
      return request("/orders/my-orders", { requiresAuth: true });
    },
    getOrder(id) {
      return request(`/orders/${id}`, { requiresAuth: true });
    },
    trackOrder(orderId, phone) {
      return request("/orders/track", { query: { orderId, phone }, requiresAuth: false });
    },
    cancelOrder(id) {
      return request(`/orders/${id}/cancel`, { method: "PATCH", requiresAuth: true });
    },
    getSellerOrders() {
      return request("/orders/seller-orders", { method: "GET", requiresAuth: true });
    },
    updateOrderStatus(id, orderStatus) {
      return request(`/orders/${id}/status`, { method: "PATCH", body: { orderStatus }, requiresAuth: true });
    },
    getPendingPayments(params = {}) {
      return request("/admin/orders/pending-payment", { query: params, requiresAuth: true });
    },
    verifyPayment(id, decision) {
      return request(`/admin/orders/${id}/verify-payment`, { method: "PATCH", body: { decision }, requiresAuth: true });
    },

    // ============================================================
    // REVIEWS
    // ============================================================
    getProductReviews(productId) {
      return request(`/products/${productId}/reviews`, { requiresAuth: false });
    },
    // addReview / postReview both POST the same endpoint — same alias situation as orders above.
    addReview(productId, payload) {
      return request(`/products/${productId}/reviews`, { method: "POST", body: payload, requiresAuth: true });
    },
    postReview(productId, payload) {
      return request(`/products/${productId}/reviews`, { method: "POST", body: payload, requiresAuth: true });
    },

    // ============================================================
    // ADS
    // ============================================================
    getAds(placement) {
      return request("/ads", { query: { placement }, requiresAuth: false });
    },
    trackAdClick(id) {
      return request(`/ads/${id}/click`, { method: "PATCH", requiresAuth: false });
    },
    createAd(formData) {
      return request("/ads", { method: "POST", body: formData, isForm: true, requiresAuth: true });
    },

    // ============================================================
    // AGENTS
    // ============================================================
    getAgents() {
      return request("/agents", { requiresAuth: false });
    },

    // ============================================================
    // CATEGORIES
    // ============================================================
    getCategories() {
      return request("/categories", { requiresAuth: false });
    },
    // Nested Parent Category -> Category -> Sub Category tree, used to drive the
    // seller's cascading category picker during product creation.
    getCategoryTree() {
      return request("/categories/tree", { requiresAuth: false });
    },
    getCategoryBySlug(slug) {
      return request(`/categories/${slug}`, { requiresAuth: false });
    },
    createCategory(payload) {
      return request("/categories", { method: "POST", body: payload, requiresAuth: true });
    },
    // The attribute definitions assigned to a leaf category — drives which extra
    // fields (Brand, Size, Color, ...) render on the product creation form.
    getCategoryAttributes(categoryId) {
      return request(`/categories/${categoryId}/attributes`, { requiresAuth: false });
    },
  };
})();