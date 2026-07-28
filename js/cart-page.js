(function () {
  const empty = document.getElementById("cartEmpty");
  const wrap = document.getElementById("cartWrap");
  const itemsEl = document.getElementById("cartItems");

  function renderItems() {
    const items = SS_CART.getAll();
    if (!items.length) {
      empty.style.display = "block";
      wrap.style.display = "none";
      return;
    }
    empty.style.display = "none";
    wrap.style.display = "grid";

    itemsEl.innerHTML = items.map(i => `
      <div class="cart-item" data-id="${i.id}">
        <img src="${i.image || 'https://placehold.co/100/F1E4CE/1B1F23?text=SS'}" alt="${i.name}">
        <div>
          <div class="cart-item__name">${i.name}</div>
          <div class="cart-item__meta">
            <span class="price-tag">${ssFmtPrice(i.price)}</span>
            <div class="qty-stepper">
              <button data-act="minus" aria-label="Decrease">−</button>
              <span>${i.qty}</span>
              <button data-act="plus" aria-label="Increase">+</button>
            </div>
          </div>
        </div>
        <button class="cart-item__remove" data-act="remove"><i class="fa-solid fa-trash"></i></button>
      </div>
    `).join("");

    document.getElementById("sumCount").textContent = SS_CART.count();
    document.getElementById("sumSubtotal").textContent = ssFmtPrice(SS_CART.total());
    document.getElementById("sumTotal").textContent = ssFmtPrice(SS_CART.total());

    itemsEl.querySelectorAll(".cart-item").forEach(row => {
      const id = isNaN(row.dataset.id) ? row.dataset.id : Number(row.dataset.id);
      const item = items.find(i => i.id == id);
      row.querySelector('[data-act="minus"]').addEventListener("click", () => { SS_CART.setQty(id, item.qty - 1); renderItems(); });
      row.querySelector('[data-act="plus"]').addEventListener("click", () => { SS_CART.setQty(id, item.qty + 1); renderItems(); });
      row.querySelector('[data-act="remove"]').addEventListener("click", () => { SS_CART.remove(id); renderItems(); ssToast("Removed from cart", "fa-trash"); });
    });
  }

  document.getElementById("checkoutForm").addEventListener("submit", async e => {
    e.preventDefault();
    const errBox = document.getElementById("checkoutError");
    errBox.classList.remove("show");
    const btn = document.getElementById("placeOrderBtn");

    const items = SS_CART.getAll();
    if (!items.length) return;

    const payload = {
      items: items.map(i => ({ productId: i.id, quantity: i.qty })),
      shippingAddress: {
        fullName: document.getElementById("fullName").value.trim(),
        phone: document.getElementById("phone").value.trim(),
        town: document.getElementById("town").value.trim(),
        details: document.getElementById("addressDetail").value.trim()
      },
      mpesaMessage: document.getElementById("mpesaMessage").value.trim()
    };

    btn.disabled = true;
    btn.textContent = "Placing order…";

    try {
      const order = await SS_API.placeOrder(payload);
      const orderId = order.id || order.orderId || (order.order && order.order.id) || "—";
      SS_CART.clear();
      sessionStorage.setItem("ss_last_order", orderId);
      location.href = "order-confirmation.html";
    } catch (err) {
      errBox.textContent = err.message || "Could not place your order. Please try again.";
      errBox.classList.add("show");
      btn.disabled = false;
      btn.textContent = "Place order";
    }
  });

  renderItems();
})();
