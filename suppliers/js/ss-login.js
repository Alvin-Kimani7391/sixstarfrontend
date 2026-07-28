/* ============================================================
   SIX STAR SUPPLIERS — login page logic
   Works for every role (buyer, wholesaler, retailer, admin).
   After login, sends the person to:
     - the ?redirect= URL they came from (if any, and it's safe), or
     - their role's home page otherwise
   ============================================================ */

(async () => {
  const els = {
    form: document.getElementById("loginForm"),
    email: document.getElementById("loginEmail"),
    password: document.getElementById("loginPassword"),
    togglePassword: document.getElementById("togglePassword"),
    error: document.getElementById("loginError"),
    submitBtn: document.getElementById("loginSubmitBtn"),
  };

  function hideLoader() {
    const loader = document.getElementById("pageLoader");
    if (loader) {
      loader.classList.add("hide");
      loader.style.display = "none";
    }
  }

  function showError(msg) {
    if (!els.error) return;
    els.error.textContent = msg;
    els.error.classList.add("show");
  }

  function clearError() {
    if (els.error) els.error.classList.remove("show");
  }

  // Where a person lands after logging in, per role
  function roleHome(role) {
    if (role === "admin") return "admin.html";
    if (role === "wholesaler" || role === "retailer") return "seller-dashboard.html";
    return "index.html";
  }

  // Only trust a redirect target if it's a relative path on this site -
  // never follow an absolute URL from the query string (open-redirect guard)
  function getSafeRedirect() {
    const raw = new URLSearchParams(window.location.search).get("redirect");
    if (!raw) return null;
    if (raw.startsWith("http") || raw.startsWith("//") || raw.includes("://")) return null;
    return raw;
  }

  function goToDestination(role) {
    const redirect = getSafeRedirect();
    window.location.href = redirect || roleHome(role);
  }

  // If already logged in, skip the form entirely
  try {
    const { user } = await SS_API.getMe();
    goToDestination(user.role);
    return; // don't hide the loader / show the form - we're navigating away
  } catch (err) {
    // not logged in - show the form as normal
  }

  hideLoader();

  if (els.togglePassword) {
    els.togglePassword.addEventListener("click", () => {
      const isHidden = els.password.type === "password";
      els.password.type = isHidden ? "text" : "password";
      els.togglePassword.innerHTML = isHidden
        ? '<i class="fa-solid fa-eye-slash"></i>'
        : '<i class="fa-solid fa-eye"></i>';
    });
  }

  if (els.form) {
    els.form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearError();

      const email = els.email.value.trim();
      const password = els.password.value;

      if (!email || !password) {
        showError("Please enter your email and password.");
        return;
      }

      els.submitBtn.disabled = true;
      els.submitBtn.textContent = "Logging in...";

      try {
        const { user } = await SS_API.login({ email, password });
        ssToast(`Welcome back, ${user.name || "there"}`, "fa-circle-check");
        goToDestination(user.role);
      } catch (err) {
        showError(err.message || "Couldn't log in. Please check your details and try again.");
        els.submitBtn.disabled = false;
        els.submitBtn.textContent = "Log In";
      }
    });
  }
})();