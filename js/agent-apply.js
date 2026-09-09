(() => {
  const channelPicker = document.getElementById("channelPicker");
  channelPicker.querySelectorAll(".channel-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      channelPicker.querySelectorAll(".channel-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      chip.querySelector("input").checked = true;
    });
  });

  document.getElementById("applyForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errBox = document.getElementById("applyError");
    const btn = document.getElementById("applyBtn");
    errBox.classList.remove("show");

    if (!document.getElementById("termsCheck").checked || !document.getElementById("marketingPolicyCheck").checked) {
      errBox.textContent = "Please accept the Terms of Service and Marketing Policy to continue.";
      errBox.classList.add("show");
      return;
    }

    btn.disabled = true;
    btn.textContent = "Submitting…";

    const fd = new FormData();
    fd.append("name", document.getElementById("name").value.trim());
    fd.append("phone", document.getElementById("phone").value.trim());
    fd.append("email", document.getElementById("email").value.trim());
    fd.append("password", document.getElementById("password").value);
    fd.append("location", document.getElementById("location").value.trim());
    fd.append("bio", document.getElementById("bio").value.trim());
    fd.append("preferredChannel", document.querySelector('input[name="channel"]:checked')?.value || "whatsapp");
    fd.append("termsAccepted", "true");
    fd.append("marketingPolicyAccepted", "true");

    const avatarFile = document.getElementById("avatarInput").files[0];
    if (avatarFile) fd.append("avatar", avatarFile);

    try {
      const res = await SS_AGENT_API.apply(fd);
      ssToast("Application submitted — we'll review it shortly", "fa-circle-check");
      if (res.agent) SS_AGENT_AUTH.set(res.agent);
      setTimeout(() => { location.href = "agent-login.html"; }, 1200);
    } catch (err) {
      errBox.textContent = err.message || "Couldn't submit your application. Please try again.";
      errBox.classList.add("show");
      btn.disabled = false;
      btn.textContent = "Submit Application";
    }
  });
})();