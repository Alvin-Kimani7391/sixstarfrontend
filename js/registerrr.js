let selectedRole = "buyer";
const roleHints = {
  buyer: "You'll shop and check out as a regular buyer.",
  retailer: "You'll be able to list products for approval once your account is set up (seller tools are coming to this site soon).",
  wholesaler: "You'll be able to list bulk products for approval once your account is set up (seller tools are coming to this site soon)."
};

document.querySelectorAll(".role-card").forEach(card => {
  card.addEventListener("click", () => {
    document.querySelectorAll(".role-card").forEach(c => c.classList.remove("active"));
    card.classList.add("active");
    selectedRole = card.dataset.role;
    document.getElementById("roleHint").textContent = roleHints[selectedRole];
  });
});

document.getElementById("registerForm").addEventListener("submit", async e => {
  e.preventDefault();
  const errBox = document.getElementById("registerError");
  const btn = document.getElementById("registerBtn");
  errBox.classList.remove("show");

  const pass = document.getElementById("regPassword").value;
  const pass2 = document.getElementById("regPassword2").value;
  if (pass !== pass2) {
    errBox.textContent = "Passwords don't match.";
    errBox.classList.add("show");
    return;
  }

  btn.disabled = true; btn.textContent = "Creating account…";
  try {
    const res = await SS_API.register({
      name: document.getElementById("regName").value.trim(),
      email: document.getElementById("regEmail").value.trim(),
      phone: document.getElementById("regPhone").value.trim(),
      password: pass,
      role: selectedRole
    });
    const user = res.user || res;
    SS_AUTH.set({ name: user.name || document.getElementById("regName").value.trim(), role: selectedRole, email: user.email });
    ssToast("Account created!", "fa-circle-check");
    location.href = "index.html";
  } catch (err) {
    errBox.textContent = err.message || "Could not create your account. Please try again.";
    errBox.classList.add("show");
    btn.disabled = false; btn.textContent = "Create account";
  }
});
