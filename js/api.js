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
// SHOPS - PUBLIC
// ============================================================
getShops(params = {}) {
  return request("/shops", { query: params, requiresAuth: false });
},
getShopBySlug(slug) {
  return request(`/shops/${slug}`, { requiresAuth: false });
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
    // Public, fire-and-forget view counter — hits PATCH /products/:id/view
    // (productController.trackProductViewCount). Guests are included, so this
    // must NOT require auth.
    trackProductViewCount(productId) {
      return request(`/products/${productId}/view`, { method: "PATCH", requiresAuth: false });
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