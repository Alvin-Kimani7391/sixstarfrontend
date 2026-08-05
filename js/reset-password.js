/* ============================================================
   SIX STAR SUPPLIERS — Reset Password
   Reads the token from the URL (?token=...) that was emailed
   to the user, then submits the new password against it.
   ============================================================ */

const resetToken = new URLSearchParams(location.search).get("token");
const resetForm = document.getElementById("resetForm");
const errBox = document.getElementById("rpError");

if (!resetToken) {
  resetForm.style.display = "none";
  document.getElementById("rpNoToken").style.display = "block";
} else {
  resetForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    errBox.classList.remove("show");

    const password = document.getElementById("password").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    if (password !== confirmPassword) {
      errBox.textContent = "Passwords don't match.";
      errBox.classList.add("show");
      return;
    }
    if (password.length < 6) {
      errBox.textContent = "Password must be at least 6 characters.";
      errBox.classList.add("show");
      return;
    }

    const btn = document.getElementById("rpBtn");
    btn.disabled = true;
    btn.textContent = "Updating…";

    try {
      const res = await SS_API.resetPassword(resetToken, { password });
      const user = res.user;

      if (user) {
        SS_AUTH.set(user);
      }

      ssToast("Password updated — you're logged in", "fa-circle-check");

      let target = "/index.html";
      if (user) {
        switch (user.role) {
          case "wholesaler":
          case "retailer":
            target = "/six-star-suppliers/seller-dashboard.html";
            break;
          case "admin":
            target = "/site/admin-dashboard.html";
            break;
        }
      }
      location.href = target;
    } catch (err) {
      errBox.textContent = err.message || "Couldn't reset your password. The link may have expired.";
      errBox.classList.add("show");
      btn.disabled = false;
      btn.textContent = "Update password";
    }
  });
}