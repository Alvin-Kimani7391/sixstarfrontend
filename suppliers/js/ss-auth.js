/* ============================================================
   SIX STAR SUPPLIERS — auth guard
   If you already have your own SS_AUTH (you mentioned login is
   handled), skip including this file - don't load two copies.
   This is only here so seller-dashboard.js has something to call
   if this page doesn't already have an auth script loaded.
   ============================================================ */

const SS_AUTH = (() => {
  let cachedUser = null;

  return {
    // Redirects to login.html if not authenticated, or if the
    // logged-in user's role isn't in `roles`. Returns the user object
    // on success, or null after redirecting.
    async requireRole(roles = []) {
      try {
        const { user } = await SS_API.getMe();
        if (roles.length && !roles.includes(user.role)) {
          window.location.href = "index.html"; // logged in, but wrong role
          return null;
        }
        cachedUser = user;
        return user;
      } catch (err) {
        const redirect = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `login.html?redirect=${redirect}`;
        return null;
      }
    },

    getCachedUser() {
      return cachedUser;
    },

    clear() {
      cachedUser = null;
    },
  };
})();
