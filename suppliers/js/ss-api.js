/* ============================================================
   SIX STAR SUPPLIERS — API client
   Cookie-based authentication
   Uses httpOnly JWT cookie from Express backend.
   ============================================================ */

const SS_API = (() => {
  const BASE = SS_CONFIG.API_BASE;

  // ------------------------------------------------------------
  // Core request handler
  // ------------------------------------------------------------
  async function request(
    path,
    { method = "GET", body, isForm = false, query, requiresAuth = true } = {}
  ) {
    let url = `${BASE}${path}`;

    if (query) {
      const qs = new URLSearchParams(
        Object.entries(query).filter(
          ([, value]) => value !== undefined && value !== null && value !== ""
        )
      ).toString();

      if (qs) {
        url += `?${qs}`;
      }
    }

    const options = {
      method,
      credentials: "include",
      headers: {},
    };

    // ------------------------------------------------------------
    // Request body
    // ------------------------------------------------------------
    if (body !== undefined) {
      if (isForm) {
        // FormData automatically sets multipart boundary
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
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    // ------------------------------------------------------------
    // Unauthorized
    // ------------------------------------------------------------
    if (response.status === 401) {
      if (
        !window.location.pathname.includes("login.html") &&
        !window.location.pathname.includes("register.html")
      ) {
        if (window.SS_AUTH) SS_AUTH.clear();

        const redirect = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `login.html?redirect=${redirect}`;
      }

      const message = data?.message || data?.error || "Please login again.";
      const err = new Error(message);
      err.status = 401;
      err.data = data;
      throw err;
    }

    // ------------------------------------------------------------
    // Other errors
    // ------------------------------------------------------------
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

    logout() {
      return request("/auth/logout", { method: "POST" }).finally(() => {
        if (window.SS_AUTH) SS_AUTH.clear();
      });
    },

    getMe() {
      return request("/auth/me", { method: "GET" });
    },

    updateMe(payload) {
      return request("/auth/me", { method: "PUT", body: payload });
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

    getProductReviews(productId) {
      return request(`/products/${productId}/reviews`, { requiresAuth: false });
    },

    // ============================================================
    // SELLER PRODUCTS (wholesaler / retailer)
    // ============================================================

    getMyProducts(params = {}) {
      return request("/products/my-products", { query: params, requiresAuth: true });
    },

    createProduct(formData) {
      return request("/products", { method: "POST", body: formData, isForm: true, requiresAuth: true });
    },

    // Only works while the product is still "draft" or "rejected" (backend rule)
    updateProduct(id, formData) {
      return request(`/products/${id}`, { method: "PUT", body: formData, isForm: true, requiresAuth: true });
    },

    submitProduct(id) {
      return request(`/products/${id}/submit`, { method: "PATCH", requiresAuth: true });
    },

    deleteProduct(id) {
      return request(`/products/${id}`, { method: "DELETE", requiresAuth: true });
    },

    // ============================================================
    // ADMIN PRODUCTS
    // ============================================================

    getPendingProducts(params = {}) {
      return request("/admin/products/pending", { query: params, requiresAuth: true });
    },

    getAllProductsAdmin(params = {}) {
      return request("/admin/products", { query: params, requiresAuth: true });
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

    createOrder(payload) {
      return request("/orders", { method: "POST", body: payload, requiresAuth: true });
    },

    getMyOrders() {
      return request("/orders/my-orders", { requiresAuth: true });
    },

    getSellerOrders() {
      return request("/orders/seller-orders", { requiresAuth: true });
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

    addReview(productId, payload) {
      return request(`/products/${productId}/reviews`, { method: "POST", body: payload, requiresAuth: true });
    },

    // ============================================================
    // ADS
    // ============================================================

    getAds(placement) {
      return request("/ads", { query: { placement }, requiresAuth: false });
    },

    createAd(formData) {
      return request("/ads", { method: "POST", body: formData, isForm: true, requiresAuth: true });
    },

    trackAdClick(id) {
      // Fire-and-forget click tracking - never blocks navigation
      return request(`/ads/${id}/click`, { method: "PATCH", requiresAuth: false }).catch(() => {});
    },

    // ============================================================
    // CATEGORIES
    // ============================================================

    getCategories() {
      return request("/categories", { requiresAuth: false });
    },

    createCategory(payload) {
      return request("/categories", { method: "POST", body: payload, requiresAuth: true });
    },
  };
})();
