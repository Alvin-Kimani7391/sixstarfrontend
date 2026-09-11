/* ============================================================
   SIX STAR SUPPLIERS — Google Sign-In
   Uses Google Identity Services. Renders a button into #googleBtn
   on login.html and register.html, and sends the resulting ID
   token to the backend for verification.

   Google One Tap: on pages WITHOUT a #googleBtn (index.html,
   product-detail.html, etc), shows Google's native One-Tap account
   chooser to guests only (never to someone already logged in),
   capped to once per day per browser so it never feels naggy.

   FIX (this version): Google made FedCM mandatory for the One Tap /
   prompt() flow. Without `use_fedcm_for_prompt: true` in
   initialize(), Chrome silently refuses to render the prompt at all
   — no error is thrown, it just never appears, which is exactly
   what "One Tap isn't working" looks like from the outside. This
   version also adds itp_support for Safari, a bounded retry (the
   previous version could retry forever with zero diagnostics if the
   GSI script never loaded — e.g. blocked by an ad blocker/privacy
   extension, which is a very common real-world cause), and a
   moment-notification listener so the actual reason a prompt didn't
   display shows up in the console instead of failing silently.

   Include this file (plus the GSI <script> tag) on every storefront
   page you want One Tap to appear on — not just login/register:

     <script src="https://accounts.google.com/gsi/client" async defer></script>
     <script src="js/google-auth.js"></script>

   CHECKLIST if One Tap still doesn't show after this fix:
   - Confirm the GSI <script> tag above is actually present on the
     page (open devtools > Network and look for gsi/client).
   - Confirm no ad blocker / privacy extension is blocking
     accounts.google.com — check the console for a warning this file
     now logs after it gives up retrying.
   - Confirm SS_CONFIG.GOOGLE_CLIENT_ID is set and its OAuth client's
     "Authorized JavaScript origins" in Google Cloud Console includes
     the EXACT origin you're testing from (https://www.sixstarsuppliers.com,
     and separately http://localhost:PORT for local dev — these do
     not fall back to each other).
   - One Tap won't show if the visitor has no active Google session
     in that browser, or if they dismissed it recently (Google's own
     cooldown, separate from ours).
   ============================================================ */

const SS_GOOGLE_ONE_TAP_DISMISS_KEY = "ss_one_tap_last_shown";
const SS_GOOGLE_ONE_TAP_COOLDOWN_MS = 24 * 60 * 60 * 1000; // once per day

let _ssGoogleInitialized = false;

// Small bounded-retry helper: calls fn() every `delay` ms until it returns
// true (success) or `maxAttempts` is hit. Replaces the old unbounded
// setTimeout(self, ...) recursion, which could loop forever with no trace
// if the GSI script never loaded — logs a console warning once it gives up
// so a blocked/ad-blocked script is actually diagnosable instead of
// silently doing nothing.
function ssRetryUntil(fn, { delay = 300, maxAttempts = 30, onGiveUp } = {}) {
  let attempts = 0;
  (function tick() {
    attempts += 1;
    if (fn()) return; // success
    if (attempts >= maxAttempts) {
      if (typeof onGiveUp === "function") onGiveUp();
      return;
    }
    setTimeout(tick, delay);
  })();
}

function ssEnsureGoogleInitialized() {
  if (_ssGoogleInitialized) return true;
  if (!window.google || !window.google.accounts || !window.google.accounts.id) return false;
  if (typeof SS_CONFIG === "undefined" || !SS_CONFIG.GOOGLE_CLIENT_ID) return false;

  google.accounts.id.initialize({
    client_id: SS_CONFIG.GOOGLE_CLIENT_ID,
    callback: window.handleGoogleCredential,
    auto_select: false,
    cancel_on_tap_outside: true,
    // REQUIRED for One Tap / prompt() to render at all in current Chrome —
    // Google deprecated the non-FedCM prompt UX; without this flag the
    // prompt silently never displays, no error, no console output.
    use_fedcm_for_prompt: true,
    // Safari Intelligent Tracking Prevention support, so One Tap still has
    // a chance to work there instead of silently no-op'ing.
    itp_support: true,
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

  ssRetryUntil(
    () => {
      if (!ssEnsureGoogleInitialized()) return false;
      google.accounts.id.renderButton(btn, {
        theme: "outline",
        size: "large",
        shape: "pill",
        width: 320,
        text: "continue_with",
      });
      return true;
    },
    {
      delay: 200,
      maxAttempts: 30, // ~6s total
      onGiveUp: () => console.warn("[google-auth] Gave up waiting for Google Identity Services to load — the 'Continue with Google' button will not render. Check that accounts.google.com/gsi/client isn't being blocked by an extension/ad blocker."),
    }
  );
}

// One Tap — the small native Google account chooser that slides in from
// the corner. Only ever shown to guests, never on login/register pages
// (those already have the full-size button above), capped to once a day.
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

  ssRetryUntil(
    () => {
      if (!ssEnsureGoogleInitialized()) return false;
      fireOneTapPrompt();
      return true;
    },
    {
      delay: 300,
      maxAttempts: 25, // ~7.5s total
      onGiveUp: () => console.warn("[google-auth] Gave up waiting for Google Identity Services to load — One Tap will not show on this page load. Check that accounts.google.com/gsi/client isn't being blocked by an extension/ad blocker, and that the GSI <script> tag is actually present on this page."),
    }
  );
}

function fireOneTapPrompt() {
  // Mark "attempted today" up front so we never spam the prompt even if
  // something below throws — but we may clear this again below if Google
  // tells us the prompt genuinely never rendered, so a real next-page-load
  // retry isn't wasted on a no-op.
  try { localStorage.setItem(SS_GOOGLE_ONE_TAP_DISMISS_KEY, String(Date.now())); } catch (_) {}

  try {
    google.accounts.id.prompt((notification) => {
      // Optional diagnostics — safe no-op in browsers/GIS versions that
      // don't pass a notification object.
      if (!notification || typeof notification.isNotDisplayed !== "function") return;

      if (notification.isNotDisplayed()) {
        console.info("[google-auth] One Tap did not display:", notification.getNotDisplayedReason && notification.getNotDisplayedReason());
        // It never actually rendered (e.g. no Google session, opted out,
        // FedCM not available) — don't burn today's attempt on nothing.
        try { localStorage.removeItem(SS_GOOGLE_ONE_TAP_DISMISS_KEY); } catch (_) {}
      } else if (notification.isSkippedMoment()) {
        console.info("[google-auth] One Tap skipped:", notification.getSkippedReason && notification.getSkippedReason());
      } else if (notification.isDismissedMoment()) {
        console.info("[google-auth] One Tap dismissed by user:", notification.getDismissedReason && notification.getDismissedReason());
      }
    });
  } catch (err) {
    console.error("[google-auth] google.accounts.id.prompt() threw:", err);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initGoogleButton();
  // Give the page's own scripts (header render, auth state) a beat to
  // settle before deciding whether someone is logged in.
  setTimeout(initGoogleOneTap, 900);
});