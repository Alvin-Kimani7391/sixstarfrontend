/* ============================================================
   PROFILE PAGE — details, orders (polling for live-ish status),
   cancel order, recently viewed products.
   ============================================================ */
(function () {
  const user = SS_AUTH.requireRole(['buyer', 'retailer', 'wholesaler']); // any logged-in role
  if (!user) return;

  // NOTE: Order documents have TWO separate status fields on the backend:
  //   - paymentStatus: 'pending_verification' | 'confirmed' | 'rejected'
  //   - orderStatus:   'processing' | 'shipped' | 'delivered' | 'cancelled'
  // There is no combined "status" field — always read the correct one below.
  const ORDER_STEPS = [
    { key: 'processing', label: 'Placed / Processing', icon: 'fa-box' },
    { key: 'shipped', label: 'Shipped', icon: 'fa-truck' },
    { key: 'delivered', label: 'Delivered', icon: 'fa-house' },
  ];
  const POLL_MS = 20000;
  let pollTimer = null;
  let pendingCancelId = null;

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
  function initials(name) {
    return (name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  }

  /* ---------- tabs ---------- */
  const tabs = document.querySelectorAll('.acct-tab[data-tab]');
  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabs.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.acct-panel').forEach((p) => p.classList.remove('active'));
      document.getElementById('panel-' + btn.dataset.tab).classList.add('active');

      if (btn.dataset.tab === 'orders') {
        loadOrders();
        startPolling();
      } else {
        stopPolling();
      }
      if (btn.dataset.tab === 'viewed') loadRecentlyViewed();
    });
  });

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
      // fall back to cached localStorage copy so the page isn't empty
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

  /* ---------- orders ---------- */
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

  function orderCardHTML(o) {
    const items = o.items || [];
    // Cancellable while it's still processing and hasn't been confirmed+moved on
    // (mirrors the backend rule in cancelOrder — keep these two in sync).
    const canCancel = o.orderStatus === 'processing'
      && !(o.paymentStatus === 'confirmed' && o.orderStatus !== 'processing');
    const orderRef = o.orderNumber ? o.orderNumber : ('#' + esc(o._id?.slice(-8).toUpperCase()));

    return `
      <div class="order-card" data-order-id="${o._id}">
        <div class="order-card__head">
          <div>
            <div class="order-id">${orderRef}</div>
            <div class="order-date">${o.createdAt ? new Date(o.createdAt).toLocaleString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</div>
          </div>
          <span class="order-status-pill ${esc(o.orderStatus)}">${esc(o.orderStatus)}</span>
        </div>
        ${o.paymentStatus === 'pending_verification'
          ? `<div class="payment-pending-badge"><i class="fa-solid fa-clock"></i> Payment awaiting verification</div>` : ''}
        ${o.paymentStatus === 'rejected'
          ? `<div class="payment-rejected-badge"><i class="fa-solid fa-triangle-exclamation"></i> Payment could not be verified — order cancelled</div>` : ''}
        <div class="order-items">
          ${items.map((it) => `<img src="${esc(it.image || '')}" alt="${esc(it.name || '')}" onerror="this.style.visibility='hidden'" />`).join('') || '<span style="font-size:.8rem;color:var(--ink-soft);">No item details</span>'}
        </div>
        ${orderProgressHTML(o.orderStatus)}
        <div class="order-foot">
          <div class="order-total">${money(o.totalAmount)}</div>
          <div class="order-actions">
            <a href="track.html?orderId=${encodeURIComponent(o._id)}" class="btn btn-outline btn-sm">Track</a>
            <button class="btn-cancel-order" data-cancel="${o._id}" ${canCancel ? '' : 'disabled'}>
              ${canCancel ? 'Cancel order' : 'Not cancellable'}
            </button>
          </div>
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
    // Backend field names: finalPrice (base) + displayPrice (virtual, discounted). No `discountPrice`/`price` fields exist.
    const price = p.displayPrice ?? p.finalPrice ?? p.sellerPrice ?? 0;
    const hasDiscount = (p.discountPercent || 0) > 0 && p.finalPrice && price < p.finalPrice;
    return `
      <a href="product-detail.html?id=${p._id}" class="p-card" style="text-decoration:none;">
        ${p.isHotDeal ? `<div class="p-card__badges"><div class="p-card__hot"><i class="fa-solid fa-fire"></i> Hot deal</div></div>` : ''}
        <div class="p-card__img"><img src="${esc(img)}" alt="${esc(p.name)}" /></div>
        <div class="p-card__body">
          <div class="p-card__name">${esc(p.name)}</div>
          ${hasDiscount ? `<div class="p-card__old">${money(p.finalPrice)}</div>` : ''}
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
})();