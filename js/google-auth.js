/* ============================================================
   SIX STAR SUPPLIERS — Google Sign-In
   Uses Google Identity Services. Renders a button into #googleBtn
   on login.html and register.html, and sends the resulting ID
   token to the backend for verification.

   NEW — Google One Tap: on pages WITHOUT a #googleBtn (index.html,
   product-detail.html, etc), shows Google's native One-Tap account
   chooser to guests only (never to someone already logged in),
   exactly like the prompt most large e-commerce sites show. Capped
   to once per day per browser so it never feels naggy, and Google's
   own frequency rules (cooldown after a dismiss) apply on top of that.

   Include this file (plus the GSI <script> tag) on every storefront
   page you want One Tap to appear on — not just login/register:

     <script src="https://accounts.google.com/gsi/client" async defer></script>
     <script src="js/google-auth.js"></script>
   ============================================================ */

const SS_GOOGLE_ONE_TAP_DISMISS_KEY = "ss_one_tap_last_shown";
const SS_GOOGLE_ONE_TAP_COOLDOWN_MS = 24 * 60 * 60 * 1000; // once per day

let _ssGoogleInitialized = false;

function ssEnsureGoogleInitialized() {
  if (_ssGoogleInitialized) return true;
  if (!window.google || !window.google.accounts || !window.google.accounts.id) return false;
  if (typeof SS_CONFIG === "undefined" || !SS_CONFIG.GOOGLE_CLIENT_ID) return false;

  google.accounts.id.initialize({
    client_id: SS_CONFIG.GOOGLE_CLIENT_ID,
    callback: window.handleGoogleCredential,
    auto_select: false,
    cancel_on_tap_outside: true,
  });
  _ssGoogleInitialized = true;
  return true;
}

// Called directly by Google once the person picks their account
window.handleGoogleCredential = async function (response) {
  try {
    const res = await SS_API.googleAuth({ credential: response.credential });
    const user = res.user;

    if (!user) {
      throw new Error("Google sign-in succeeded but no user was returned.");
    }

    SS_AUTH.set(user);

    // Merge whatever this guest already searched/viewed onto their new
    // account immediately, instead of waiting for their next interaction.
    if (window.SSGuestCapture && typeof SSGuestCapture.notifyLogin === "function") {
      SSGuestCapture.notifyLogin(user.email);
    }

    ssToast("Signed in with Google", "fa-circle-check");

    const redirect = new URLSearchParams(location.search).get("redirect");
    let target = redirect;

    // On pages other than login/register (i.e. One Tap fired), just
    // reload in place instead of forcing a redirect — the person didn't
    // ask to go anywhere, they were just browsing.
    const cameFromOneTap = !document.getElementById("googleBtn");

    if (!target && !cameFromOneTap) {
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

    if (target) {
      location.href = target;
    } else {
      location.reload();
    }
  } catch (err) {
    console.error("Google sign-in error:", err);
    if (typeof ssToast === "function") {
      ssToast(err.message || "Google sign-in failed. Please try again.", "fa-circle-exclamation");
    }
  }
};

function initGoogleButton() {
  const btn = document.getElementById("googleBtn");
  if (!btn) return;

  if (!ssEnsureGoogleInitialized()) {
    // Script/config hasn't finished loading yet — try again shortly.
    return setTimeout(initGoogleButton, 200);
  }

  google.accounts.id.renderButton(btn, {
    theme: "outline",
    size: "large",
    shape: "pill",
    width: 320,
    text: "continue_with",
  });
}

// One Tap — the small native Google account chooser that slides in from
// the corner, same pattern used across most major e-commerce sites to
// convert anonymous browsers into accounts with a single tap. Only ever
// shown to guests, never on the login/register pages themselves (those
// already have the full-size button above), and capped to once a day.
function initGoogleOneTap() {
  const isAuthPage = !!document.getElementById("googleBtn");
  if (isAuthPage) return; // full button already covers this page

  let loggedIn = false;
  try {
    loggedIn = !!(window.SS_AUTH && typeof SS_AUTH.get === "function" && SS_AUTH.get());
  } catch (_) {}
  if (loggedIn) return;

  let lastShown = 0;
  try { lastShown = Number(localStorage.getItem(SS_GOOGLE_ONE_TAP_DISMISS_KEY)) || 0; } catch (_) {}
  if (Date.now() - lastShown < SS_GOOGLE_ONE_TAP_COOLDOWN_MS) return;

  if (!ssEnsureGoogleInitialized()) {
    return setTimeout(initGoogleOneTap, 300);
  }

  try { localStorage.setItem(SS_GOOGLE_ONE_TAP_DISMISS_KEY, String(Date.now())); } catch (_) {}

  google.accounts.id.prompt(); // shows the native "Continue as ..." chooser
}

document.addEventListener("DOMContentLoaded", () => {
  initGoogleButton();
  // Give the page's own scripts (header render, auth state) a beat to
  // settle before deciding whether someone is logged in.
  setTimeout(initGoogleOneTap, 900);
});