/* ============================================================
   SIX STAR SUPPLIERS — Login
   Cookie-based authentication.
   Two-step for sellers whose verification is APPROVED: the backend
   responds with { otpRequired: true, otpToken, maskedEmail } instead
   of a session, and this page swaps in a 6-digit OTP stage before
   completing login. Everyone else (buyers, admins, unverified/pending
   sellers, Google sign-ins) logs in exactly as before, in one step.
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

  function startResendCooldown(seconds) {
    resendCooldownEndsAt = Date.now() + seconds * 1000;
    els.otpResendBtn.disabled = true;
    if (resendCooldownTimer) clearInterval(resendCooldownTimer);

    const tick = () => {
      const remainingMs = resendCooldownEndsAt - Date.now();
      if (remainingMs <= 0) {
        clearInterval(resendCooldownTimer);
        resendCooldownTimer = null;
        els.otpCooldown.textContent = "";
        els.otpResendBtn.disabled = false;
        return;
      }
      const remaining = Math.ceil(remainingMs / 1000);
      const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
      const ss = String(remaining % 60).padStart(2, "0");
      els.otpCooldown.textContent = `(${mm}:${ss})`;
    };
    tick();
    resendCooldownTimer = setInterval(tick, 250);
  }

  function redirectForUser(user) {
    const redirect = new URLSearchParams(location.search).get("redirect");
    let target;

    if (redirect) {
      target = redirect;
    } else {
      switch (user.role) {
        case "wholesaler":
        case "retailer":
          target = "/six-star-suppliers/seller-dashboard.html";
          break;
        case "buyer":
          target = "/index.html";
          break;
        case "admin":
          target = "/site/admin-dashboard.html";
          break;
        default:
          target = "/index.html";
      }
    }
    location.href = target;
  }

  function completeLogin(user) {
    if (!user) {
      throw new Error("Login successful but user data was not returned.");
    }
    SS_AUTH.set(user);
    ssToast("Logged in successfully", "fa-circle-check");
    redirectForUser(user);
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

      // ---- Sellers with an approved verification get stopped here for OTP ----
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