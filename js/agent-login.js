(() => {
  const credentialsStage = document.getElementById("credentialsStage");
  const forgotStage = document.getElementById("forgotStage");
  const loginForm = document.getElementById("loginForm");
  const loginError = document.getElementById("loginError");
  const loginBtn = document.getElementById("loginBtn");
  const forgotForm = document.getElementById("forgotForm");
  const forgotError = document.getElementById("forgotError");
  const forgotSuccess = document.getElementById("forgotSuccess");
  const forgotBtn = document.getElementById("forgotBtn");

  // Already logged in? skip straight to the dashboard.
  if (SS_AGENT_AUTH.isLoggedIn()) {
    SS_AGENT_API.getMe().then(() => { location.href = "agent.html"; }).catch(() => SS_AGENT_AUTH.clear());
  }

  document.getElementById("forgotLink").addEventListener("click", (e) => {
    e.preventDefault();
    credentialsStage.style.display = "none";
    forgotStage.style.display = "block";
  });
  document.getElementById("backToLoginLink").addEventListener("click", (e) => {
    e.preventDefault();
    forgotStage.style.display = "none";
    credentialsStage.style.display = "block";
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.classList.remove("show");
    loginBtn.disabled = true;
    loginBtn.textContent = "Logging in…";

    try {
      const res = await SS_AGENT_API.login({
        email: document.getElementById("email").value.trim(),
        password: document.getElementById("password").value,
      });
      SS_AGENT_AUTH.set(res.agent);
      const redirect = new URLSearchParams(location.search).get("redirect");
      location.href = redirect || "agent.html";
    } catch (err) {
      loginError.textContent = err.message || "Login failed. Check your details and try again.";
      loginError.classList.add("show");
      loginBtn.disabled = false;
      loginBtn.textContent = "Log In";
    }
  });

  forgotForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    forgotError.classList.remove("show");
    forgotSuccess.classList.remove("show");
    forgotBtn.disabled = true;
    forgotBtn.textContent = "Sending…";

    try {
      await SS_AGENT_API.forgotPassword({ email: document.getElementById("forgotEmail").value.trim() });
      forgotSuccess.textContent = "If an account exists for that email, we've sent reset instructions.";
      forgotSuccess.classList.add("show");
      forgotForm.reset();
    } catch (err) {
      forgotError.textContent = err.message || "Couldn't send the reset email. Try again shortly.";
      forgotError.classList.add("show");
    } finally {
      forgotBtn.disabled = false;
      forgotBtn.textContent = "Send Reset Link";
    }
  });
})();