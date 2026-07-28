/* ============================================================
   SIX STAR SUPPLIERS — Forgot Password (request link)
   ============================================================ */

document.getElementById("forgotForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const errBox = document.getElementById("fpError");
  const successBox = document.getElementById("fpSuccess");
  const btn = document.getElementById("fpBtn");

  errBox.classList.remove("show");
  successBox.classList.remove("show");
  btn.disabled = true;
  btn.textContent = "Sending…";

  try {
    const email = document.getElementById("email").value.trim();
    const res = await SS_API.forgotPassword({ email });

    // Backend always returns a generic success message, even if the email
    // doesn't exist — that's intentional, so we just display it as-is.
    successBox.textContent = res.message || "If an account exists for that email, we've sent reset instructions.";
    successBox.classList.add("show");
    document.getElementById("forgotForm").reset();
  } catch (err) {
    errBox.textContent = err.message || "Something went wrong. Please try again.";
    errBox.classList.add("show");
  } finally {
    btn.disabled = false;
    btn.textContent = "Send reset link";
  }
});