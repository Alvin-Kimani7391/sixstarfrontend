/* ============================================================
   SIX STAR SUPPLIERS — Toast notifications
   Expects this markup somewhere in the page body:

     <div id="toast"><i class="fa-solid fa-circle-check"></i><span></span></div>

   Usage:
     ssToast("Logged in successfully", "fa-circle-check");
     ssToast("Couldn't save your profile", "fa-triangle-exclamation");
   ============================================================ */

let ssToastTimer = null;

function ssToast(message, iconClass = "fa-circle-check") {
  const toastEl = document.getElementById("toast");
  if (!toastEl) {
    console.warn("ssToast: #toast element not found in the DOM.", message);
    return;
  }

  const iconEl = toastEl.querySelector("i");
  const textEl = toastEl.querySelector("span");

  if (textEl) textEl.textContent = message;

  if (iconEl) {
    // Reset to a clean Font Awesome solid icon each time, then apply the requested one
    iconEl.className = `fa-solid ${iconClass}`;
  }

  // Restart the animation/timer even if a toast is already showing
  toastEl.classList.remove("show");
  // Force reflow so re-adding the class retriggers the CSS transition
  void toastEl.offsetWidth;
  toastEl.classList.add("show");

  clearTimeout(ssToastTimer);
  ssToastTimer = setTimeout(() => {
    toastEl.classList.remove("show");
  }, 3200);
}