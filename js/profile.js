/* ============================================================
   PROFILE PAGE — details, orders (polling for live-ish status),
   cancel order, recently viewed products.
   ============================================================ */
(function () {
  const user = SS_AUTH.requireRole(['buyer', 'retailer', 'wholesaler']); // any logged-in role
  if (!user) return;

  const ORDER_STEPS = [
    { key: 'processing', label: 'Placed / Processing', icon: 'fa-box' },
    { key: 'shipped', label: 'Shipped', icon: 'fa-truck' },
    { key: 'delivered', label: 'Delivered', icon: 'fa-house' },
  ];
  const POLL_MS = 20000;
  let pollTimer = null;
  let pendingCancelId = null;

  const expandedOrderIds = new Set();

  const urlParams = new URLSearchParams(location.search);
  const deepLinkTab = urlParams.get('tab');
  const deepLinkOrderId = urlParams.get('orderId');

  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${msg}`;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 3200);
  }
  function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function money(n) {
    return 'KSh ' + Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 });
  }
  function dateTime(d) {
    return d ? new Date(d).toLocaleString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  }
  function initials(name) {
    return (name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  }

  /* ---------- tabs ---------- */
  const tabs = document.querySelectorAll('.acct-tab[data-tab]');

  function activateTab(tabName) {
    const target = document.getElementById('panel-' + tabName);
    if (!target) return;

    tabs.forEach((b) => b.classList.toggle('active', b.dataset.tab === tabName));
    document.querySelectorAll('.acct-panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + tabName));

    if (tabName === 'orders') {
      if (deepLinkOrderId) expandedOrderIds.add(deepLinkOrderId);
      loadOrders().then(() => {
        if (deepLinkOrderId) scrollToOrder(deepLinkOrderId);
      });
      startPolling();
    } else {
      stopPolling();
    }
    if (tabName === 'viewed') loadRecentlyViewed();
  }

  tabs.forEach((btn) => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });

  function scrollToOrder(id) {
    requestAnimationFrame(() => {
      const card = document.querySelector(`.order-card[data-order-id="${id}"]`);
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('order-card--highlight');
      setTimeout(() => card.classList.remove('order-card--highlight'), 2600);
    });
  }

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    if (!confirm('Are you sure you want to log out?')) return;
    try { await SS_API.logout(); } catch (_) {}
    SS_AUTH.clear();
    location.href = 'login.html';
  });

  /* ---------- sidebar + form: profile ---------- */
  function paintSidebar(u) {
    document.getElementById('sideName').textContent = u.name || 'My Account';
    document.getElementById('sideEmail').textContent = u.email || '';
    const av = document.getElementById('sideAvatar');
    const avForm = document.getElementById('formAvatarPreview');
    if (u.avatar) {
      av.innerHTML = `<img src="${esc(u.avatar)}" alt="" />`;
      avForm.innerHTML = `<img src="${esc(u.avatar)}" alt="" />`;
    } else {
      av.textContent = initials(u.name);
      avForm.textContent = initials(u.name);
    }
  }

  async function loadProfile() {
    try {
      const { user: u } = await SS_API.getProfile();
      paintSidebar(u);
      document.getElementById('fName').value = u.name || '';
      document.getElementById('fEmail').value = u.email || '';
      document.getElementById('fPhone').value = u.phone || '';
      document.getElementById('fAvatar').value = u.avatar || '';
      document.getElementById('addressField').style.display = u.role === 'buyer' ? '' : 'none';
      if (u.role === 'buyer') document.getElementById('fAddress').value = u.address || '';
      SS_AUTH.set({ ...SS_AUTH.get(), name: u.name, avatar: u.avatar, role: u.role });
    } catch (err) {
      paintSidebar(user);
    }
  }

  document.getElementById('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('profileError');
    const okEl = document.getElementById('profileSuccess');
    errEl.classList.remove('show'); okEl.classList.remove('show');
    const btn = document.getElementById('profileSaveBtn');
    btn.disabled = true;

    const payload = {
      name: document.getElementById('fName').value.trim(),
      phone: document.getElementById('fPhone').value.trim(),
      avatar: document.getElementById('fAvatar').value.trim(),
      address: document.getElementById('fAddress').value.trim(),
    };

    try {
      const { user: u } = await SS_API.updateProfile(payload);
      paintSidebar(u);
      okEl.textContent = 'Profile updated successfully.';
      okEl.classList.add('show');
      toast('Profile updated');
    } catch (err) {
      errEl.textContent = err.message || 'Could not update profile.';
      errEl.classList.add('show');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('pwError');
    const okEl = document.getElementById('pwSuccess');
    errEl.classList.remove('show'); okEl.classList.remove('show');
    const btn = document.getElementById('pwSaveBtn');
    btn.disabled = true;

    try {
      await SS_API.changePassword({
        currentPassword: document.getElementById('pCurrent').value,
        newPassword: document.getElementById('pNew').value,
      });
      okEl.textContent = 'Password updated successfully.';
      okEl.classList.add('show');
      e.target.reset();
      toast('Password updated');
    } catch (err) {
      errEl.textContent = err.message || 'Could not update password.';
      errEl.classList.add('show');
    } finally {
      btn.disabled = false;
    }
  });

  /* ---------- orders: progress stages ---------- */
  function stepIndex(orderStatus) {
    const i = ORDER_STEPS.findIndex((s) => s.key === orderStatus);
    return i === -1 ? 0 : i;
  }

  function orderProgressHTML(orderStatus) {
    if (orderStatus === 'cancelled') {
      return `<div class="order-progress cancelled-flag"><p style="font-size:.8rem;color:var(--brick);font-weight:700;"><i class="fa-solid fa-ban"></i> This order was cancelled</p></div>`;
    }
    const current = stepIndex(orderStatus);
    return `<div class="order-progress">
      ${ORDER_STEPS.map((s, i) => `
        <div class="op-step ${i < current ? 'done' : ''} ${i === current ? 'current' : ''}">
          <span class="op-line"></span>
          <span class="op-dot"><i class="fa-solid ${i <= current ? 'fa-check' : s.icon}"></i></span>
          <span class="op-label">${s.label}</span>
        </div>`).join('')}
    </div>`;
  }

  /* ---------- orders: expandable detail panel ---------- */
  function calcItemsSubtotal(o) {
    return (o.items || []).reduce((sum, it) => sum + (Number(it.priceAtPurchase) || 0) * (Number(it.quantity) || 0), 0);
  }

  function orderDetailHTML(o) {
    const items = o.items || [];
    const subtotal = calcItemsSubtotal(o);
    const dd = o.deliveryDetails || {};
    const transportFee = dd.transportFee || 0;
    const wholesaleFee = dd.wholesaleDeliveryFee || 0;
    const notes = dd.notes || [];
    const addr = o.shippingAddress || {};

    return `
      <div class="order-detail-section">
        <h4><i class="fa-solid fa-list"></i> Items (${items.length})</h4>
        <div class="detail-items">
          ${items.map((it) => `
            <div class="detail-item-row">
              <img src="${esc(it.image || '')}" alt="${esc(it.name || '')}" onerror="this.style.visibility='hidden'" />
              <div class="detail-item-info">
                <div class="detail-item-name">${esc(it.name)}${it.sellerRole === 'wholesaler' ? `<span class="mini-chip wholesale">Wholesale</span>` : ''}</div>
                ${it.variantLabel ? `<div class="detail-item-variant">${esc(it.variantLabel)}</div>` : ''}
                <div class="detail-item-qty">${it.quantity} × ${money(it.priceAtPurchase)}</div>
              </div>
              <div class="detail-item-total">${money((Number(it.priceAtPurchase) || 0) * (Number(it.quantity) || 0))}</div>
            </div>
          `).join('') || `<p class="form-hint">No item details available.</p>`}
        </div>
      </div>

      <div class="order-detail-section">
        <h4><i class="fa-solid fa-receipt"></i> Price breakdown</h4>
        <div class="detail-price-row"><span>Items subtotal</span><span>${money(subtotal)}</span></div>
        ${transportFee > 0 ? `<div class="detail-price-row"><span>Transport fee</span><span>${money(transportFee)}</span></div>` : ''}
        ${wholesaleFee > 0 ? `<div class="detail-price-row"><span>Wholesale delivery</span><span>${money(wholesaleFee)}</span></div>` : ''}
        ${notes.length ? `<div class="detail-notes"><i class="fa-solid fa-circle-info"></i><span>${notes.map(esc).join(' · ')}</span></div>` : ''}
        <div class="detail-price-row total"><span>Total paid</span><span>${money(o.totalAmount)}</span></div>
      </div>

      <div class="order-detail-section">
        <h4><i class="fa-solid fa-truck"></i> Delivery details</h4>
        <div class="detail-kv"><span>Recipient</span><span>${esc(addr.fullName || '—')}</span></div>
        <div class="detail-kv"><span>Phone</span><span>${esc(addr.phone || '—')}</span></div>
        <div class="detail-kv"><span>Town / Area</span><span>${esc(addr.city || '—')}</span></div>
        <div class="detail-kv"><span>Address / Landmark</span><span>${esc(addr.address || addr.notes || '—')}</span></div>
      </div>

      <div class="order-detail-section">
        <h4><i class="fa-solid fa-money-bill-wave"></i> Payment</h4>
        <div class="detail-kv"><span>Status</span><span class="order-status-pill ${esc(o.paymentStatus)}">${esc((o.paymentStatus || '').replace(/_/g, ' '))}</span></div>
        ${o.mpesaCode ? `<div class="detail-kv"><span>M-Pesa code</span><span class="mono">${esc(o.mpesaCode)}</span></div>` : ''}
        ${o.verifiedAt ? `<div class="detail-kv"><span>Verified on</span><span>${dateTime(o.verifiedAt)}</span></div>` : ''}
        <div class="detail-kv"><span>Placed on</span><span>${dateTime(o.createdAt)}</span></div>
        <div class="detail-kv"><span>Last updated</span><span>${dateTime(o.updatedAt)}</span></div>
      </div>
    `;
  }

  function toggleOrderDetail(id) {
    const panel = document.getElementById('detail-' + id);
    const btn = document.querySelector(`.btn-details-toggle[data-toggle-detail="${id}"]`);
    if (!panel) return;

    const willOpen = panel.hasAttribute('hidden');
    if (willOpen) {
      panel.removeAttribute('hidden');
      expandedOrderIds.add(id);
    } else {
      panel.setAttribute('hidden', '');
      expandedOrderIds.delete(id);
    }

    if (btn) {
      btn.classList.toggle('open', willOpen);
      const label = btn.querySelector('span');
      if (label) label.textContent = willOpen ? 'Hide details' : 'View details';
    }
  }

  function orderCardHTML(o) {
    const items = o.items || [];
    const canCancel = o.orderStatus === 'processing'
      && !(o.paymentStatus === 'confirmed' && o.orderStatus !== 'processing');
    const orderRef = o.orderNumber ? o.orderNumber : ('#' + esc(o._id?.slice(-8).toUpperCase()));
    const isOpen = expandedOrderIds.has(o._id);

    return `
      <div class="order-card" data-order-id="${o._id}">
        <div class="order-card__head">
          <div>
            <div class="order-id">${orderRef}</div>
            <div class="order-date">${dateTime(o.createdAt)}</div>
          </div>
          <span class="order-status-pill ${esc(o.orderStatus)}">${esc(o.orderStatus)}</span>
        </div>
        ${o.paymentStatus === 'pending_verification'
          ? `<div class="payment-pending-badge"><i class="fa-solid fa-clock"></i> Payment awaiting verification</div>` : ''}
        ${o.paymentStatus === 'rejected'
          ? `<div class="payment-rejected-badge"><i class="fa-solid fa-triangle-exclamation"></i> Payment could not be verified — order cancelled</div>` : ''}
        <div class="order-items">
          ${items.length
            ? items.slice(0, 6).map((it) => `<img src="${esc(it.image || '')}" alt="${esc(it.name || '')}" onerror="this.style.visibility='hidden'" />`).join('')
              + (items.length > 6 ? `<span class="order-items-more" data-toggle-detail="${o._id}" title="View all ${items.length} items">+${items.length - 6}</span>` : '')
            : '<span style="font-size:.8rem;color:var(--ink-soft);">No item details</span>'}
        </div>
        ${orderProgressHTML(o.orderStatus)}
        <div class="order-foot">
          <div class="order-total">${money(o.totalAmount)}</div>
          <div class="order-actions">
            <button class="btn-details-toggle ${isOpen ? 'open' : ''}" data-toggle-detail="${o._id}">
              <span>${isOpen ? 'Hide details' : 'View details'}</span> <i class="fa-solid fa-chevron-down"></i>
            </button>
           
            <button class="btn-cancel-order" data-cancel="${o._id}" ${canCancel ? '' : 'disabled'}>
              ${canCancel ? 'Cancel order' : 'Not cancellable'}
            </button>
          </div>
        </div>
        <div class="order-detail" id="detail-${o._id}" ${isOpen ? '' : 'hidden'}>
          ${orderDetailHTML(o)}
        </div>
      </div>`;
  }

  async function loadOrders(silent) {
    const list = document.getElementById('ordersList');
    if (!silent) {
      list.innerHTML = `<div class="skel skeleton-card" style="margin-bottom:14px;"></div><div class="skel skeleton-card"></div>`;
    }
    try {
      const { orders } = await SS_API.getMyOrders();
      if (!orders || !orders.length) {
        list.innerHTML = `<div class="empty-mini"><i class="fa-solid fa-box-open"></i>No orders yet. <a href="product.html" style="color:var(--teal-deep);font-weight:700;">Start shopping</a></div>`;
        return;
      }
      list.innerHTML = orders.map(orderCardHTML).join('');
      list.querySelectorAll('[data-cancel]:not([disabled])').forEach((btn) => {
        btn.addEventListener('click', () => openCancelConfirm(btn.dataset.cancel));
      });
      list.querySelectorAll('[data-toggle-detail]').forEach((btn) => {
        btn.addEventListener('click', () => toggleOrderDetail(btn.dataset.toggleDetail));
      });
    } catch (err) {
      if (!silent) list.innerHTML = `<div class="empty-mini"><i class="fa-solid fa-triangle-exclamation"></i>${esc(err.message || 'Could not load your orders.')}</div>`;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => loadOrders(true), POLL_MS);
  }
  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }
  window.addEventListener('beforeunload', stopPolling);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopPolling();
    else if (document.getElementById('panel-orders').classList.contains('active')) startPolling();
  });

  function openCancelConfirm(id) {
    pendingCancelId = id;
    document.getElementById('cancelOverlay').classList.add('open');
  }
  document.getElementById('cancelDismiss').addEventListener('click', () => {
    pendingCancelId = null;
    document.getElementById('cancelOverlay').classList.remove('open');
  });
  document.getElementById('cancelConfirm').addEventListener('click', async () => {
    if (!pendingCancelId) return;
    const btn = document.getElementById('cancelConfirm');
    btn.disabled = true;
    try {
      await SS_API.cancelOrder(pendingCancelId);
      toast('Order cancelled');
      document.getElementById('cancelOverlay').classList.remove('open');
      loadOrders(true);
    } catch (err) {
      toast(err.message || 'Could not cancel order');
    } finally {
      btn.disabled = false;
      pendingCancelId = null;
    }
  });

  /* ---------- recently viewed ---------- */
  function viewedCardHTML(entry) {
    const p = entry.product;
    if (!p) return '';
    const img = (p.images && p.images[0]) || '';
    // Backend field names per the product model are finalPrice (stored) and
    // displayPrice (a computed/virtual discounted price). The extra fallbacks
    // below are defensive: if /users/recently-viewed ever returns the product
    // without that virtual applied (e.g. a .lean() populate on the backend),
    // we still resolve a real price instead of silently landing on 0.
    const basePrice = p.finalPrice ?? p.price ?? p.sellingPrice ?? p.basePrice ?? null;
    const price = p.displayPrice ?? basePrice ?? p.sellerPrice ?? 0;
    const hasDiscount = (p.discountPercent || 0) > 0 && basePrice && price < basePrice;
    return `
      <a href="product-detail.html?id=${p._id}" class="p-card" style="text-decoration:none;">
        ${p.isHotDeal ? `<div class="p-card__badges"><div class="p-card__hot"><i class="fa-solid fa-fire"></i> Hot deal</div></div>` : ''}
        <div class="p-card__img"><img src="${esc(img)}" alt="${esc(p.name)}" /></div>
        <div class="p-card__body">
          <div class="p-card__name">${esc(p.name)}</div>
          ${hasDiscount ? `<div class="p-card__old">${money(basePrice)}</div>` : ''}
          <div class="p-card__foot"><span class="price-tag">${money(price)}</span></div>
        </div>
      </a>
      <div class="rv-viewed-at">Viewed ${timeAgo(entry.viewedAt)}</div>`;
  }
  function timeAgo(dateStr) {
    if (!dateStr) return '';
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  async function loadRecentlyViewed() {
    const grid = document.getElementById('viewedGrid');
    grid.innerHTML = `<div class="skel skeleton-card"></div><div class="skel skeleton-card"></div><div class="skel skeleton-card"></div>`;
    try {
      const { items } = await SS_API.getRecentlyViewed();
      if (!items || !items.length) {
        grid.innerHTML = `<div class="empty-mini" style="grid-column:1/-1;"><i class="fa-solid fa-eye-slash"></i>Nothing viewed yet — browse the <a href="product.html" style="color:var(--teal-deep);font-weight:700;">catalog</a> to build your history.</div>`;
        return;
      }
      grid.innerHTML = items.map(viewedCardHTML).join('');
    } catch (err) {
      grid.innerHTML = `<div class="empty-mini" style="grid-column:1/-1;"><i class="fa-solid fa-triangle-exclamation"></i>${esc(err.message || 'Could not load recently viewed products.')}</div>`;
    }
  }

  /* ---------- init ---------- */
  loadProfile();

  if (deepLinkTab && document.getElementById('panel-' + deepLinkTab)) {
    activateTab(deepLinkTab);
  } else if (deepLinkOrderId) {
    activateTab('orders');
  }
})();