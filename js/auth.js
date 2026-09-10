/* ============================================================
   AUTH — the backend sets an httpOnly auth cookie on login/register,
   so we can't read it from JS. We keep a small, non-authoritative
   copy of the user's name/role in localStorage purely for UI.
   ============================================================ */

const SS_AUTH = (() => {
  const KEY = "ss_user";

  function get() {
    try { 
      return JSON.parse(localStorage.getItem(KEY)); 
    }
    catch (_) { 
      return null; 
    }
  }

  function set(user) { 
    localStorage.setItem(KEY, JSON.stringify(user)); 
  }

  function clear() { 
    localStorage.removeItem(KEY); 
  }

  function isLoggedIn() { 
    return !!get(); 
  }

  // NEW — fixes "SS_AUTH.getUserId is not a function" thrown by
  // product-detail.html's view-tracking script. Returns the cached
  // user's _id (or null if logged out / never cached). Non-authoritative,
  // same caveat as the rest of this module — it's UI convenience only.
  function getUserId() {
    const user = get();
    return user ? (user._id || user.id || null) : null;
  }

  function requireRole(roles = []) {
    const user = get();

    if (!user) {
      location.href = "login.html";
      return null;
    }

    if (!roles.includes(user.role)) {
      location.href = "/index.html";
      return null;
    }

    return user;
  }

  return { 
    get, 
    set, 
    clear, 
    isLoggedIn,
    getUserId,
    requireRole
  };
})();


function SS_REDIRECT(user) {
  if (user.role === "retailer" || user.role === "wholesaler") {
    location.href = "/six-star-suppliers/seller-dashboard.html";
  } else {
    location.href = "/index.html";
  }
}