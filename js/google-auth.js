/* ============================================================
   SIX STAR SUPPLIERS — Google Sign-In
   Uses Google Identity Services. Renders a button into #googleBtn
   on login.html and register.html, and sends the resulting ID
   token to the backend for verification.
   ============================================================ */

// Called directly by Google once the person picks their account
window.handleGoogleCredential = async function (response) {
  try {
    const res = await SS_API.googleAuth({ credential: response.credential });
    const user = res.user;

    if (!user) {
      throw new Error("Google sign-in succeeded but no user was returned.");
    }

    SS_AUTH.set(user);
    ssToast("Signed in with Google", "fa-circle-check");

    const redirect = new URLSearchParams(location.search).get("redirect");
    let target = redirect;

    if (!target) {
      switch (user.role) {
        case "wholesaler":
        case "retailer":
          target = "seller-dashboard.html";
          break;
        case "admin":
          target = "admin-dashboard.html";
          break;
        case "buyer":
        default:
          target = "index.html";
      }
    }

    location.href = target;
  } catch (err) {
    console.error("Google sign-in error:", err);
    ssToast(err.message || "Google sign-in failed. Please try again.", "fa-circle-exclamation");
  }
};

function initGoogleButton() {
  const btn = document.getElementById("googleBtn");
  if (!btn) return;

  if (!window.google || !window.google.accounts) {
    // Script hasn't finished loading yet — try again shortly rather than failing silently
    return setTimeout(initGoogleButton, 200);
  }

  if (typeof SS_CONFIG === "undefined" || !SS_CONFIG.GOOGLE_CLIENT_ID) {
    console.warn("SS_CONFIG.GOOGLE_CLIENT_ID is not set — hiding Google sign-in button.");
    btn.style.display = "none";
    return;
  }

  google.accounts.id.initialize({
    client_id: SS_CONFIG.GOOGLE_CLIENT_ID,
    callback: window.handleGoogleCredential,
  });

  google.accounts.id.renderButton(btn, {
    theme: "outline",
    size: "large",
    shape: "pill",
    width: 320,
    text: "continue_with",
  });
}

document.addEventListener("DOMContentLoaded", initGoogleButton);