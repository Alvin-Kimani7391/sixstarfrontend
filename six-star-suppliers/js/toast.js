/* ============================================================
   SIX STAR SUPPLIERS — toast helper
   Expects a <div id="toast"><i class="fa-solid"></i><span></span></div>
   somewhere on the page (see partials in each html file).
   ============================================================ */

let ssToastTimer = null;

function ssToast(message, icon = "fa-circle-check") {
  const el = document.getElementById("toast");
  if (!el) return;
  const iconEl = el.querySelector("i");
  const textEl = el.querySelector("span");
  if (iconEl) iconEl.className = `fa-solid ${icon}`;
  if (textEl) textEl.textContent = message;

  el.classList.add("show");
  clearTimeout(ssToastTimer);
  ssToastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}
