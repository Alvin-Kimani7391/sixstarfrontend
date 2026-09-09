(() => {
  const token = new URLSearchParams(location.search).get("token");

  const formStage = document.getElementById("formStage");
  const invalidStage = document.getElementById("invalidStage");
  const successStage = document.getElementById("successStage");
  const resetForm = document.getElementById("resetForm");
  const resetError = document.getElementById("resetError");
  const resetBtn = document.getElementById("resetBtn");

  if (!token) {
    formStage.style.display = "none";
    invalidStage.style.display = "block";
    return;
  }

  resetForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    resetError.classList.remove("show");

    const password = document.getElementById("newPassword").value;
    const confirm = document.getElementById("confirmPassword").value;

    if (password !== confirm) {
      resetError.textContent = "Passwords do not match.";
      resetError.classList.add("show");
      return;
    }
    if (password.length < 6) {
      resetError.textContent = "Password must be at least 6 characters.";
      resetError.classList.add("show");
      return;
    }

    resetBtn.disabled = true;
    resetBtn.textContent = "Updating…";

    try {
      const res = await SS_AGENT_API.resetPassword({ token, password });
      SS_AGENT_AUTH.set(res.agent);
      formStage.style.display = "none";
      successStage.style.display = "block";
      ssToast("Password updated", "fa-circle-check");
      setTimeout(() => { location.href = "agent.html"; }, 1500);
    } catch (err) {
      if (err.status === 400) {
        formStage.style.display = "none";
        invalidStage.style.display = "block";
        return;
      }
      resetError.textContent = err.message || "Couldn't update your password. Please try again.";
      resetError.classList.add("show");
      resetBtn.disabled = false;
      resetBtn.textContent = "Update Password";
    }
  });
})();