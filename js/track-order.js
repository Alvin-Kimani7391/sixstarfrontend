/* NOTE: your route table doesn't list a "get single order" endpoint, so this
   calls GET /api/orders/:id (see the "(assumed)" note in js/api.js). If your
   backend exposes tracking differently (e.g. a dedicated /track route),
   update SS_API.getOrder() in js/api.js to match. */

const STEPS = [
  { key: "placed", title: "Order placed", desc: "We've received your order and M-Pesa message." },
  { key: "payment_review", title: "Payment verification", desc: "Our team is confirming your M-Pesa payment." },
  { key: "confirmed", title: "Order confirmed", desc: "Payment verified — we're preparing your items." },
  { key: "shipped", title: "Out for delivery", desc: "Your order is on its way to you." },
  { key: "delivered", title: "Delivered", desc: "Order delivered. Enjoy!" }
];

function stepIndexFromStatus(status) {
  const s = (status || "").toLowerCase();
  if (["delivered", "complete", "completed"].includes(s)) return 4;
  if (["shipped", "out_for_delivery", "dispatched"].includes(s)) return 3;
  if (["confirmed", "payment_confirmed", "processing"].includes(s)) return 2;
  if (["pending_payment", "payment_pending", "pending"].includes(s)) return 1;
  if (["rejected", "payment_rejected", "cancelled", "canceled"].includes(s)) return -1;
  return 0;
}

function renderTimeline(order) {
  const box = document.getElementById("timeline");
  const status = order.status || order.paymentStatus || "placed";
  const idx = stepIndexFromStatus(status);

  if (idx === -1) {
    box.innerHTML = `<div class="timeline-step current">
      <div class="timeline-dot"><i class="fa-solid fa-xmark"></i></div>
      <div><div class="timeline-title">Payment not verified</div>
      <div class="timeline-desc">${order.rejectionReason || order.reason || "Contact us on WhatsApp for help resolving this order."}</div></div>
    </div>`;
    return;
  }

  box.innerHTML = STEPS.map((step, i) => `
    <div class="timeline-step ${i < idx ? "done" : i === idx ? "current" : ""}">
      <div class="timeline-dot">${i < idx ? '<i class="fa-solid fa-check"></i>' : i + 1}</div>
      <div>
        <div class="timeline-title">${step.title}</div>
        <div class="timeline-desc">${step.desc}</div>
      </div>
    </div>
  `).join("");
}

document.getElementById("trackForm").addEventListener("submit", async e => {
  e.preventDefault();
  const errBox = document.getElementById("trackError");
  const resultBox = document.getElementById("trackResult");
  const btn = document.getElementById("trackBtn");
  errBox.classList.remove("show");
  resultBox.style.display = "none";

  const id = document.getElementById("orderId").value.trim();
  btn.disabled = true; btn.textContent = "Looking up…";

  try {
    const order = await SS_API.getOrder(id);
    renderTimeline(order.order || order);
    resultBox.style.display = "block";
  } catch (err) {
    errBox.textContent = "We couldn't find that order. Double-check the reference and try again, or message us on WhatsApp.";
    errBox.classList.add("show");
  } finally {
    btn.disabled = false; btn.textContent = "Track order";
  }
});

// prefill from a just-completed checkout, if any
document.addEventListener("DOMContentLoaded", () => {
  const last = sessionStorage.getItem("ss_last_order");
  if (last) document.getElementById("orderId").value = last;
});
