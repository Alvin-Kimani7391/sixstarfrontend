/* ============================================================
   SIX STAR SUPPLIERS — toast helper
   Usage: ssToast("Saved!", "fa-circle-check")
   Expects a <div id="toast"></div> on the page (auto-created if missing).
   ============================================================ */

let ssToastTimeout;

function ssToast(message, iconClass = "fa-circle-check") {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    document.body.appendChild(el);
  }

  el.innerHTML = `<i class="fa-solid ${iconClass}"></i><span>${message}</span>`;
  el.classList.add("show");

  clearTimeout(ssToastTimeout);
  ssToastTimeout = setTimeout(() => el.classList.remove("show"), 3200);
}
