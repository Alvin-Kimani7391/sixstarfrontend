/* ============================================================
   SIX STAR SUPPLIERS — checkout page
   ============================================================ */

(async () => {
  const user = await SS_AUTH.requireRole(["buyer"]);
  if (!user) return;

  const cart = ssGetCart();
  if (!cart.length) {
    window.location.href = "cart.html";
    return;
  }

  document.getElementById("fullName").value = user.name || "";
  document.getElementById("deliveryPhone").value = user.phone || "";

  // ---------- render read-only items summary ----------
  const itemsList = document.getElementById("checkoutItemsList");
  itemsList.innerHTML = cart
    .map(
      (item) => `
    <div class="cart-item">
      <img src="${item.image || 'https://placehold.co/100x100/F1E4CE/5B564C?text=No+photo'}" alt="">
      <div>
        <div class="cart-item__name">${escapeHtml(item.name)}</div>
        <div class="text-muted">Qty: ${item.quantity} × KSh ${item.price.toLocaleString()}</div>
      </div>
      <div class="price-tag">KSh ${(item.price * item.quantity).toLocaleString()}</div>
    </div>`
    )
    .join("");

  const total = ssGetCartTotal();
  document.getElementById("checkoutSubtotal").textContent = `KSh ${total.toLocaleString()}`;
  document.getElementById("checkoutTotal").textContent = `KSh ${total.toLocaleString()}`;

  // ---------- agent dropdown ----------
  try {
    const { agents } = await SS_API.getAgents();
    const select = document.getElementById("agentCode");
    agents.forEach((a) => {
      const opt = document.createElement("option");
      opt.value = a.code;
      opt.textContent = `${a.name} (${a.code})`;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error("Couldn't load agents:", err);
  }

  // ---------- place order ----------
  const placeOrderBtn = document.getElementById("placeOrderBtn");
  const errorEl = document.getElementById("checkoutError");

  placeOrderBtn.addEventListener("click", async () => {
    errorEl.classList.remove("show");

    const fullName = document.getElementById("fullName").value.trim();
    const phone = document.getElementById("deliveryPhone").value.trim();
    const address = document.getElementById("deliveryAddress").value.trim();
    const city = document.getElementById("deliveryCity").value.trim();
    const notes = document.getElementById("deliveryNotes").value.trim();
    const agentCode = document.getElementById("agentCode").value;
    const mpesaMessage = document.getElementById("mpesaMessage").value.trim();

    if (!fullName || !phone || !address || !city) {
      showError("Please fill in your full delivery details.");
      return;
    }
    if (!mpesaMessage || mpesaMessage.length < 10) {
      showError("Please paste your full M-Pesa confirmation message.");
      return;
    }

    const payload = {
      items: cart.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      shippingAddress: { fullName, phone, address, city, notes },
      mpesaMessage,
    };
    if (agentCode) payload.agentCode = agentCode;

    placeOrderBtn.disabled = true;
    placeOrderBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Placing order...`;

    try {
      // NOTE: api.js exposes this as placeOrder(), not createOrder() — using the
      // wrong name here silently threw before any request was even sent.
      const { order } = await SS_API.placeOrder(payload);

      // Save the order reference + checkout phone so the track-order page can
      // prefill both fields automatically when the buyer lands there.
      sessionStorage.setItem("ss_last_order", order.orderNumber || order._id || order.id);
      sessionStorage.setItem("ss_last_order_phone", phone);

      ssClearCart();
      showOrderPlaced(order);
    } catch (err) {
      showError(err.message || "Couldn't place your order. Please try again.");
      placeOrderBtn.disabled = false;
      placeOrderBtn.innerHTML = `<i class="fa-solid fa-check"></i> Place Order`;
    }
  });

  // ---------- success overlay: show order number, then go to track-order.html ----------
  function showOrderPlaced(order) {
    const orderRef = order.orderNumber || ("#" + String(order._id || order.id || "").slice(-8).toUpperCase());
    const orderId = order._id || order.id;

    const overlay = document.createElement("div");
    overlay.className = "order-placed-overlay";
    overlay.innerHTML = `
      <div class="order-placed-card">
        <div class="order-placed-icon"><i class="fa-solid fa-circle-check"></i></div>
        <h2>Order placed!</h2>
        <p>Your order reference is</p>
        <div class="order-placed-number">${escapeHtml(orderRef)}</div>
        <p class="text-muted">Save this number — you'll need it to track your order.</p>
        <button class="btn btn-primary" id="orderPlacedContinueBtn">
          Continue to tracking <i class="fa-solid fa-arrow-right"></i>
        </button>
      </div>
    `;
    document.body.appendChild(overlay);

    const goToTracking = () => {
      window.location.href = `track-order.html?orderId=${encodeURIComponent(orderId)}`;
    };

    document.getElementById("orderPlacedContinueBtn").addEventListener("click", goToTracking);

    // auto-continue after a few seconds so the buyer isn't stuck if they miss the button
    setTimeout(goToTracking, 6000);
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.add("show");
    errorEl.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function escapeHtml(str = "") {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
})();