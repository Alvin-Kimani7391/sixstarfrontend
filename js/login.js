/* ============================================================
   SIX STAR SUPPLIERS — Login
   Cookie-based authentication.

   Three possible outcomes of POST /auth/login, checked in this order
   (matching the backend's own priority):
     1. emailVerificationRequired -> account exists & password is right,
        but the email was never OTP-verified (new buyer who hasn't
        finished onboarding, OR a pre-existing account from before this
        feature shipped). Sent to verify-email.html before anything else.
     2. otpRequired                -> seller whose verification is
        APPROVED gets a 6-digit login 2FA stage, same as before.
     3. normal success             -> straight through.
   ============================================================ */

(() => {
  const els = {
    credentialsStage: document.getElementById("credentialsStage"),
    loginForm: document.getElementById("loginForm"),
    loginError: document.getElementById("loginError"),
    loginBtn: document.getElementById("loginBtn"),

    otpStage: document.getElementById("otpStage"),
    otpStageEmail: document.getElementById("otpStageEmail"),
    otpError: document.getElementById("otpError"),
    loginOtpForm: document.getElementById("loginOtpForm"),
    otpInputRow: document.getElementById("otpInputRow"),
    otpSubmitBtn: document.getElementById("otpSubmitBtn"),
    otpResendBtn: document.getElementById("otpResendBtn"),
    otpCooldown: document.getElementById("otpCooldown"),
    otpBackBtn: document.getElementById("otpBackBtn"),
  };

  let pendingOtpToken = null;
  let resendCooldownTimer = null;
  let resendCooldownEndsAt = null;

  function showCredentialsStage() {
    pendingOtpToken = null;
    if (resendCooldownTimer) clearInterval(resendCooldownTimer);
    els.otpStage.style.display = "none";
    els.credentialsStage.style.display = "block";
    els.loginBtn.disabled = false;
    els.loginBtn.textContent = "Log in";
  }

  function showOtpStage(maskedEmail, otpToken) {
    pendingOtpToken = otpToken;
    els.otpStageEmail.textContent = maskedEmail || "your email";
    els.credentialsStage.style.display = "none";
    els.otpStage.style.display = "block";
    startResendCooldown(60);

    const digitInputs = Array.from(els.otpInputRow.querySelectorAll("[data-otp-digit]"));
    digitInputs.forEach((input) => (input.value = ""));
    digitInputs[0]?.focus();
  }

  function wireOtpDigitInputs() {
    const digitInputs = Array.from(els.otpInputRow.querySelectorAll("[data-otp-digit]"));
    digitInputs.forEach((input, idx) => {
      input.addEventListener("input", () => {
        input.value = input.value.replace(/\D/g, "").slice(0, 1);
        if (input.value && digitInputs[idx + 1]) digitInputs[idx + 1].focus();
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Backspace" && !input.value && digitInputs[idx - 1]) digitInputs[idx - 1].focus();
      });
      input.addEventListener("paste", (e) => {
        const text = (e.clipboardData || window.clipboardData).getData("text").replace(/\D/g, "");
        if (!text) return;
        e.preventDefault();
        text.split("").slice(0, digitInputs.length).forEach((ch, i) => {
          if (digitInputs[i]) digitInputs[i].value = ch;
        });
        const next = digitInputs[Math.min(text.length, digitInputs.length - 1)];
        if (next) next.focus();
      });
    });
  }
  wireOtpDigitInputs();

  // ---------- Password show/hide toggle ----------
  // Generic: wires up every [data-toggle-password="<inputId>"] button on the
  // page. Purely a display-state flip (input type text <-> password) — no
  // network calls, nothing sent anywhere. Safe to reuse verbatim on any
  // other auth page (register.html, reset-password.html, etc.).
  function wirePasswordToggles() {
    document.querySelectorAll("[data-toggle-password]").forEach((btn) => {
      const targetId = btn.getAttribute("data-toggle-password");
      const input = document.getElementById(targetId);
      const icon = btn.querySelector("i");
      if (!input || !icon) return;

      btn.addEventListener("click", () => {
        const willShow = input.type === "password";
        input.type = willShow ? "text" : "password";
        icon.classList.toggle("fa-eye", !willShow);
        icon.classList.toggle("fa-eye-slash", willShow);
        btn.setAttribute("aria-label", willShow ? "Hide password" : "Show password");

        // Keep focus + caret position on the input, not the toggle button
        input.focus({ preventScroll: true });
        const len = input.value.length;
        input.setSelectionRange?.(len, len);
      });
    });
  }
  wirePasswordToggles();

  // Single source of truth for "where does this role land after a fully
  // completed login" — used for the normal-success redirect AND to build
  // the ?next= param when we have to detour through verify-email.html
  // first. Normalized to plain relative filenames to match every other
  // page in the app (register.html, seller-dashboard.js, etc.) — see the
  // note above if /six-star-suppliers/ and /site/ were actually intentional.
  function destinationForUser(user) {
    switch (user.role) {
      case "wholesaler":
      case "retailer":
        return "/six-star-suppliers/seller-dashboard.html";
      case "admin":
        return "/site/admin.html";
      case "buyer":
      default:
        return "/index.html";
    }
  }

  function targetForUser(user) {
    const redirect = new URLSearchParams(location.search).get("redirect");
    return redirect || destinationForUser(user);
  }

  function redirectForUser(user) {
    location.href = targetForUser(user);
  }

  function completeLogin(user) {
    if (!user) {
      throw new Error("Login successful but user data was not returned.");
    }
    SS_AUTH.set(user);
    ssToast("Logged in successfully", "fa-circle-check");
    redirectForUser(user);
  }

  // Password was correct but the account's email was never OTP-verified —
  // could be a brand-new buyer mid-onboarding, or an account that predates
  // this feature. The backend already issued a session cookie for this
  // case (see authController.loginUser), so we just cache the user and
  // detour through verify-email.html before letting them any further in.
  function goToVerifyEmail(user) {
    SS_AUTH.set(user);
    const next = encodeURIComponent(targetForUser(user));
    location.href = `verify-email.html?next=${next}`;
  }

  // ---------- Stage 1: credentials ----------
  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const errBox = els.loginError;
    const btn = els.loginBtn;

    errBox.classList.remove("show");
    btn.disabled = true;
    btn.textContent = "Logging in…";

    try {
      const res = await SS_API.login({
        email: document.getElementById("email").value.trim(),
        password: document.getElementById("password").value,
      });

      console.log("Login response:", res);

      // ---- Unverified email (any role) gets stopped here first ----
      if (res.emailVerificationRequired) {
        goToVerifyEmail(res.user);
        return;
      }

      // ---- Sellers with an approved verification get stopped here for 2FA OTP ----
      if (res.otpRequired) {
        btn.disabled = false;
        btn.textContent = "Log in";
        showOtpStage(res.maskedEmail, res.otpToken);
        return;
      }

      completeLogin(res.user);
    } catch (err) {
      console.error("Login error:", err);

      errBox.textContent = err.message || "Login failed. Check your details and try again.";
      errBox.classList.add("show");

      btn.disabled = false;
      btn.textContent = "Log in";
    }
  });

  // ---------- Stage 2: login OTP (sellers only) ----------
  els.loginOtpForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const digitInputs = Array.from(els.otpInputRow.querySelectorAll("[data-otp-digit]"));
    const code = digitInputs.map((i) => i.value).join("");

    els.otpError.classList.remove("show");

    if (code.length < 6) {
      els.otpError.textContent = "Enter all 6 digits.";
      els.otpError.classList.add("show");
      return;
    }
    if (!pendingOtpToken) {
      els.otpError.textContent = "Your verification session expired. Please log in again.";
      els.otpError.classList.add("show");
      return;
    }

    els.otpSubmitBtn.disabled = true;
    els.otpSubmitBtn.textContent = "Verifying…";

    try {
      const res = await SS_API.verifyLoginOtp({ otpToken: pendingOtpToken, code });
      completeLogin(res.user);
    } catch (err) {
      els.otpError.textContent = err.message || "Incorrect code. Please try again.";
      els.otpError.classList.add("show");
      digitInputs.forEach((i) => (i.value = ""));
      digitInputs[0]?.focus();
      els.otpSubmitBtn.disabled = false;
      els.otpSubmitBtn.textContent = "Verify & log in";
    }
  });

  els.otpResendBtn.addEventListener("click", async () => {
    if (!pendingOtpToken) return;
    els.otpResendBtn.disabled = true;
    els.otpError.classList.remove("show");

    try {
      const res = await SS_API.resendLoginOtp({ otpToken: pendingOtpToken });
      pendingOtpToken = res.otpToken;
      els.otpStageEmail.textContent = res.maskedEmail || els.otpStageEmail.textContent;
      ssToast("Code resent — check your inbox", "fa-paper-plane");
      startResendCooldown(60);
    } catch (err) {
      els.otpError.textContent = err.message || "Couldn't resend the code. Try again shortly.";
      els.otpError.classList.add("show");
      els.otpResendBtn.disabled = false;
    }
  });

  els.otpBackBtn.addEventListener("click", showCredentialsStage);
})();