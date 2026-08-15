// ===================================================================
// ADMIN-RFQ.JS — RFQ / Live Quotes moderation
// A self-contained module so it doesn't require touching the bulk of
// admin.js. Wire it in with:
//
//   import { wireRFQTab, loadRFQs, loadFlaggedUsers } from './admin-rfq.js';
//   ... inside init(): wireRFQTab();
//   ... inside switchTab(tab): if (tab === 'rfq') loadRFQs();
//
// (see admin-js-additions.txt for the exact three lines/snippets)
// ===================================================================

import { apiGet, apiPatch, apiDelete } from './api.js';
import { showToast } from './toast.js';

let rfqSubtab = 'requests';
let rfqFilters = { status: '', search: '', flaggedOnly: false };
let rfqCache = [];
let flaggedUsersCache = [];
let rfqModalCurrentId = null;
let rfqModalMessages = [];
let rfqModalActiveThreadKey = null; // "senderId|receiverId" pair currently shown, or "all"

const RFQ_STATUS_LABEL = {
  OPEN: 'Open', BIDDING: 'Receiving Offers', SELLER_SELECTED: 'Seller Selected',
  CLOSED: 'Closed', EXPIRED: 'Expired', CANCELLED: 'Cancelled',
};

function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }
function money(n) { return 'KES ' + Number(n || 0).toLocaleString(); }
function debounce(fn, delay) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

// ===================================================================
// WIRING (called once from admin.js's init())
// ===================================================================
export function wireRFQTab() {
  document.querySelectorAll('#rfqSubtabBar button[data-rfq-subtab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#rfqSubtabBar button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      rfqSubtab = btn.dataset.rfqSubtab;
      document.getElementById('rfqPanelRequests').style.display = rfqSubtab === 'requests' ? 'block' : 'none';
      document.getElementById('rfqPanelFlagged').style.display = rfqSubtab === 'flagged' ? 'block' : 'none';
      if (rfqSubtab === 'flagged') loadFlaggedUsers();
    });
  });

  document.getElementById('rfqSearchInput').addEventListener('input', debounce((e) => {
    rfqFilters.search = e.target.value.trim().toLowerCase();
    renderRFQsTable();
  }, 300));
  document.getElementById('rfqStatusSelect').addEventListener('change', (e) => {
    rfqFilters.status = e.target.value;
    loadRFQs();
  });
  document.getElementById('rfqFlaggedOnlyCheck').addEventListener('change', (e) => {
    rfqFilters.flaggedOnly = e.target.checked;
    loadRFQs();
  });

  document.getElementById('rfqSuspendForm').addEventListener('submit', submitSuspendForm);

  // Close buttons for the two new modals ride on the existing generic
  // [data-close-modal] wiring already set up by admin.js's
  // wireModalCloseButtons() — nothing extra needed here as long as that
  // function runs after these modals exist in the DOM (it re-queries on
  // every call in the reference admin.js, so this just works).
}

// ===================================================================
// ALL REQUESTS
// ===================================================================
export async function loadRFQs() {
  const tbody = document.getElementById('rfqRequestsBody');
  tbody.innerHTML = `<tr><td colspan="7"><div class="spinner"></div></td></tr>`;
  try {
    const params = new URLSearchParams();
    if (rfqFilters.status) params.set('status', rfqFilters.status);
    if (rfqFilters.flaggedOnly) params.set('flagged', 'true');
    params.set('limit', '100');
    const { rfqs } = await apiGet(`/rfq/admin/all?${params.toString()}`);
    rfqCache = rfqs || [];
    renderRFQsTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${escapeHtml(err.message)}</p></div></td></tr>`;
  }
}

function renderRFQsTable() {
  const tbody = document.getElementById('rfqRequestsBody');
  let list = rfqCache;
  if (rfqFilters.search) {
    const q = rfqFilters.search;
    list = list.filter((r) =>
      (r.productName || '').toLowerCase().includes(q) ||
      (r.buyer?.name || '').toLowerCase().includes(q) ||
      (r.buyer?.email || '').toLowerCase().includes(q)
    );
  }

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="dash-empty"><i class="fa-solid fa-comments"></i><p>No requests match these filters.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(rfqRowHtml).join('');

  tbody.querySelectorAll('[data-rfq-view]').forEach((btn) =>
    btn.addEventListener('click', () => openRFQModal(list.find((r) => r._id === btn.dataset.rfqView)))
  );
  tbody.querySelectorAll('[data-rfq-suspend]').forEach((btn) =>
    btn.addEventListener('click', () => openSuspendModal(btn.dataset.rfqSuspend))
  );
  tbody.querySelectorAll('[data-rfq-unsuspend]').forEach((btn) =>
    btn.addEventListener('click', () => unsuspendRFQRow(btn.dataset.rfqUnsuspend))
  );
  tbody.querySelectorAll('[data-rfq-delete]').forEach((btn) =>
    btn.addEventListener('click', () => deleteRFQRow(btn.dataset.rfqDelete))
  );
}

function rfqRowHtml(r) {
  const flags = [];
  if (r.isSuspended) flags.push('<span class="pill pill-rejected">Suspended</span>');
  if (r.flaggedForReview) flags.push('<span class="pill pill-pending_review">Flagged</span>');

  return `
    <tr>
      <td class="wrap-cell"><strong>${escapeHtml(r.productName)}</strong><div class="text-muted">${r.quantity} ${escapeHtml(r.unit)} · ${escapeHtml(r.location)}</div></td>
      <td>${escapeHtml(r.buyer?.name || '-')}<div class="text-muted">${escapeHtml(r.buyer?.email || '')}</div></td>
      <td><span class="pill pill-${r.status.toLowerCase()}">${RFQ_STATUS_LABEL[r.status] || r.status}</span></td>
      <td>${r.bidCount || 0}</td>
      <td>${flags.join(' ') || '<span class="text-muted">—</span>'}</td>
      <td>${new Date(r.createdAt).toLocaleDateString()}</td>
      <td>
        <div class="row-actions">
          <button class="act-edit" data-rfq-view="${r._id}">Review</button>
          ${r.isSuspended
            ? `<button class="act-approve" data-rfq-unsuspend="${r._id}">Unsuspend</button>`
            : `<button class="act-suspend" data-rfq-suspend="${r._id}">Suspend</button>`}
          <button class="act-reject" data-rfq-delete="${r._id}">Delete</button>
        </div>
      </td>
    </tr>`;
}

async function unsuspendRFQRow(id) {
  try {
    await apiPatch(`/rfq/admin/${id}/suspend`, { suspend: false });
    showToast('Request unsuspended and back on the public board');
    loadRFQs();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteRFQRow(id) {
  if (!confirm('Permanently remove this request, its bids, and its chat history? This cannot be undone.')) return;
  try {
    await apiDelete(`/rfq/admin/${id}`);
    showToast('Request permanently removed');
    loadRFQs();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openSuspendModal(id) {
  document.getElementById('rfqSuspendReason').value = '';
  document.getElementById('rfqSuspendModal').dataset.rfqId = id;
  openModal('rfqSuspendModal');
}

async function submitSuspendForm(e) {
  e.preventDefault();
  const id = document.getElementById('rfqSuspendModal').dataset.rfqId;
  const reason = document.getElementById('rfqSuspendReason').value.trim();
  try {
    await apiPatch(`/rfq/admin/${id}/suspend`, { suspend: true, reason });
    showToast('Request suspended — pulled from the public board');
    closeModal('rfqSuspendModal');
    closeModal('rfqDetailModal');
    loadRFQs();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===================================================================
// RFQ DETAIL MODAL — bids + full chat-thread moderation review
// ===================================================================
async function openRFQModal(rfq) {
  if (!rfq) return;
  rfqModalCurrentId = rfq._id;
  rfqModalActiveThreadKey = 'all';

  document.getElementById('rfqModalProductName').textContent = rfq.productName;
  document.getElementById('rfqModalBuyerLine').textContent =
    `${rfq.buyer?.name || 'Unknown buyer'} · ${rfq.buyer?.email || ''}${rfq.buyer?.phone ? ' · ' + rfq.buyer.phone : ''}`;

  const statusPill = document.getElementById('rfqModalStatusPill');
  statusPill.className = `pill pill-${rfq.status.toLowerCase()}`;
  statusPill.textContent = RFQ_STATUS_LABEL[rfq.status] || rfq.status;

  document.getElementById('rfqModalBidCount').textContent = rfq.bidCount || 0;
  document.getElementById('rfqModalLocation').textContent = rfq.location || '—';
  document.getElementById('rfqModalRequiredDate').textContent = rfq.requiredDate ? new Date(rfq.requiredDate).toLocaleDateString() : '—';
  document.getElementById('rfqModalCreatedAt').textContent = new Date(rfq.createdAt).toLocaleString();

  const flagBits = [];
  if (rfq.isSuspended) flagBits.push('<span class="pill pill-rejected">Suspended</span>');
  if (rfq.flaggedForReview) flagBits.push('<span class="pill pill-pending_review">Flagged</span>');
  document.getElementById('rfqModalFlags').innerHTML = flagBits.join(' ') || '<span class="text-muted">None</span>';

  const suspendNote = document.getElementById('rfqModalSuspendNote');
  if (rfq.isSuspended && rfq.suspendReason) {
    suspendNote.style.display = 'block';
    suspendNote.textContent = `Suspended: ${rfq.suspendReason}`;
  } else {
    suspendNote.style.display = 'none';
  }

  const budgetLabel = rfq.budgetType === 'total'
    ? `${money(rfq.minBudget)} - ${money(rfq.maxBudget)} total`
    : `${money(rfq.minBudget)} - ${money(rfq.maxBudget)} / ${escapeHtml(rfq.unit)}`;
  document.getElementById('rfqModalDetailGrid').innerHTML = [
    verifField('Quantity', `${rfq.quantity} ${escapeHtml(rfq.unit)}`),
    verifField('Budget', budgetLabel),
    verifField('Delivery', rfq.deliveryRequired ? 'Required' : 'Buyer will pick up'),
    verifField('Delivery budget', rfq.deliveryBudget ? money(rfq.deliveryBudget) : '—'),
    verifField('Category', escapeHtml(rfq.category?.name || '—')),
    verifField('Expires', rfq.expiresAt ? new Date(rfq.expiresAt).toLocaleString() : '—'),
  ].join('');
  document.getElementById('rfqModalDescription').textContent = rfq.description || '';

  renderRFQModalActions(rfq);

  document.getElementById('rfqModalBidsBody').innerHTML = `<tr><td colspan="7"><div class="spinner"></div></td></tr>`;
  document.getElementById('rfqModalThreadPicker').innerHTML = '';
  document.getElementById('rfqModalMessages').innerHTML = `<div class="spinner"></div>`;

  openModal('rfqDetailModal');

  const [bidsRes, messagesRes] = await Promise.allSettled([
    apiGet(`/rfq/admin/${rfq._id}/bids`),
    apiGet(`/rfq/admin/${rfq._id}/messages`),
  ]);

  if (bidsRes.status === 'fulfilled') renderModalBids(bidsRes.value.bids || []);
  else document.getElementById('rfqModalBidsBody').innerHTML = `<tr><td colspan="7"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>Could not load bids.</p></div></td></tr>`;

  if (messagesRes.status === 'fulfilled') {
    rfqModalMessages = messagesRes.value.messages || [];
    renderModalThreadPicker();
    renderModalMessages();
  } else {
    document.getElementById('rfqModalMessages').innerHTML = `<div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>Could not load chat history.</p></div>`;
  }
}

function verifField(label, value) {
  return `<div class="verif-field"><span class="vf-label">${escapeHtml(label)}</span><span class="vf-value">${value || '<span class="text-muted">—</span>'}</span></div>`;
}

function renderRFQModalActions(rfq) {
  const wrap = document.getElementById('rfqModalActions');
  const buttons = [];
  if (rfq.isSuspended) {
    buttons.push(`<button type="button" class="btn btn-primary act-approve" id="rfqModalUnsuspendBtn">Unsuspend Request</button>`);
  } else {
    buttons.push(`<button type="button" class="btn btn-dark act-suspend" id="rfqModalSuspendBtn">Suspend Request</button>`);
  }
  buttons.push(`<button type="button" class="btn btn-dark act-reject" id="rfqModalDeleteBtn">Remove Permanently</button>`);
  wrap.innerHTML = buttons.join('');

  document.getElementById('rfqModalSuspendBtn')?.addEventListener('click', () => openSuspendModal(rfq._id));
  document.getElementById('rfqModalUnsuspendBtn')?.addEventListener('click', () => unsuspendRFQRow(rfq._id).then(() => closeModal('rfqDetailModal')));
  document.getElementById('rfqModalDeleteBtn')?.addEventListener('click', async () => {
    await deleteRFQRow(rfq._id);
    closeModal('rfqDetailModal');
  });
}

function renderModalBids(bids) {
  document.getElementById('rfqModalBidsCountLabel').textContent = `(${bids.length})`;
  const tbody = document.getElementById('rfqModalBidsBody');
  if (!bids.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="dash-empty" style="padding:24px;"><p>No offers submitted yet.</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = bids.map((b) => `
    <tr>
      <td>${escapeHtml(b.seller?.businessName || b.seller?.shopName || b.seller?.name || '-')}<div class="text-muted">${escapeHtml(b.seller?.email || '')}</div></td>
      <td>${money(b.unitPrice)}</td>
      <td>${b.quantityAvailable}</td>
      <td>${money(b.deliveryFee)}</td>
      <td><span class="pill pill-${b.status === 'pending' ? 'pending_review' : b.status}">${b.status}</span></td>
      <td class="wrap-cell">${escapeHtml(b.message || '—')}${b.messageFlagged ? ' <span class="pill pill-rejected">Flagged</span>' : ''}</td>
      <td>${new Date(b.createdAt).toLocaleString()}</td>
    </tr>`).join('');
}

// Groups messages by unordered sender/receiver pair so each buyer<->seller
// thread can be reviewed independently, plus an "All" option.
function threadKeyFor(msg) {
  const a = msg.sender?._id || msg.sender;
  const b = msg.receiver?._id || msg.receiver;
  return [a, b].sort().join('|');
}

function renderModalThreadPicker() {
  const picker = document.getElementById('rfqModalThreadPicker');
  const threads = new Map(); // key -> label
  rfqModalMessages.forEach((m) => {
    const key = threadKeyFor(m);
    if (!threads.has(key)) {
      const sellerParty = m.sender?.role !== 'buyer' ? m.sender : m.receiver;
      threads.set(key, sellerParty?.name || 'Thread');
    }
  });

  const chips = [`<span class="chip active" data-thread-key="all">All (${rfqModalMessages.length})</span>`];
  threads.forEach((label, key) => {
    const count = rfqModalMessages.filter((m) => threadKeyFor(m) === key).length;
    chips.push(`<span class="chip" data-thread-key="${key}">${escapeHtml(label)} (${count})</span>`);
  });
  picker.innerHTML = chips.join('');

  picker.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      picker.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      rfqModalActiveThreadKey = chip.dataset.threadKey;
      renderModalMessages();
    });
  });
}

function renderModalMessages() {
  const container = document.getElementById('rfqModalMessages');
  let list = rfqModalMessages;
  if (rfqModalActiveThreadKey && rfqModalActiveThreadKey !== 'all') {
    list = list.filter((m) => threadKeyFor(m) === rfqModalActiveThreadKey);
  }

  if (!list.length) {
    container.innerHTML = `<div class="dash-empty" style="padding:24px;"><p>No messages in this request yet.</p></div>`;
    return;
  }

  container.innerHTML = list.map((m) => {
    const senderLabel = `${escapeHtml(m.sender?.name || 'Unknown')} <span class="text-muted">(${escapeHtml(m.sender?.role || '')})</span>`;
    const flagged = m.moderationAction === 'masked';
    const blocked = m.moderationAction === 'blocked';
    let body;
    if (m.messageType === 'image') {
      body = `<a href="${escapeHtml(m.imageUrl)}" target="_blank" rel="noopener"><i class="fa-solid fa-image"></i> Photo attachment</a>`;
    } else {
      body = escapeHtml(m.message || '');
    }
    return `
      <div class="rfq-admin-msg ${flagged ? 'flagged' : ''} ${blocked ? 'blocked' : ''}">
        <div class="rfq-admin-msg__head">
          <span>${senderLabel}</span>
          <span class="text-muted">${new Date(m.createdAt).toLocaleString()}</span>
          ${flagged ? '<span class="pill pill-pending_review">Masked</span>' : ''}
          ${blocked ? '<span class="pill pill-rejected">Blocked attempt</span>' : ''}
        </div>
        <div class="rfq-admin-msg__body">${body}</div>
        ${m.moderationFlags?.length ? `<div class="rfq-admin-msg__flags">Flags: ${m.moderationFlags.map(escapeHtml).join(', ')}</div>` : ''}
      </div>`;
  }).join('');
}

// ===================================================================
// FLAGGED USERS
// ===================================================================
export async function loadFlaggedUsers() {
  const tbody = document.getElementById('rfqFlaggedBody');
  tbody.innerHTML = `<tr><td colspan="8"><div class="spinner"></div></td></tr>`;
  try {
    const { users } = await apiGet('/rfq/admin/flagged-users');
    flaggedUsersCache = users || [];
    renderFlaggedUsersTable();

    const badge = document.getElementById('rfqFlaggedBadge');
    if (flaggedUsersCache.length) {
      badge.textContent = flaggedUsersCache.length;
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${escapeHtml(err.message)}</p></div></td></tr>`;
  }
}

function renderFlaggedUsersTable() {
  const tbody = document.getElementById('rfqFlaggedBody');
  if (!flaggedUsersCache.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="dash-empty"><i class="fa-solid fa-shield-halved"></i><p>No flagged or restricted users right now.</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = flaggedUsersCache.map((u) => `
    <tr>
      <td><strong>${escapeHtml(u.name)}</strong></td>
      <td>${escapeHtml(u.email)}</td>
      <td><span class="pill pill-${u.role}">${u.role}</span></td>
      <td>${u.contactShareWarnings ?? 0}</td>
      <td>${u.messagingRestricted ? '<span class="pill pill-rejected">Restricted</span>' : '<span class="pill pill-active">Normal</span>'}</td>
      <td>${u.flaggedForReview ? '<span class="pill pill-pending_review">Flagged</span>' : '<span class="text-muted">—</span>'}</td>
      <td>${u.messagingRestrictedAt ? new Date(u.messagingRestrictedAt).toLocaleString() : '—'}</td>
      <td>
        <div class="row-actions">
          <button class="act-approve" data-lift-restriction="${u._id}">Lift Restriction</button>
        </div>
      </td>
    </tr>`).join('');

  tbody.querySelectorAll('[data-lift-restriction]').forEach((btn) =>
    btn.addEventListener('click', () => liftRestrictionRow(btn.dataset.liftRestriction))
  );
}

async function liftRestrictionRow(userId) {
  if (!confirm('Lift this user\'s messaging restriction and reset their warning count to zero?')) return;
  try {
    await apiPatch(`/rfq/admin/users/${userId}/lift-restriction`);
    showToast('Restriction lifted');
    loadFlaggedUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}