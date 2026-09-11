import { apiGet, apiPost, apiPatch, apiDelete } from './api.js';
import { showToast } from './toast.js';

// ===================================================================
// STATE
// ===================================================================
let emkSubtab = 'campaigns';
let emkCampaignsCache = [];
let emkCampaignStatusFilter = '';
let emkSegmentCategoriesCache = [];
let emkSubscriberFilters = { search: '', status: '', role: '', page: 1 };
let emkSubscribersCache = [];

// ===================================================================
// SMALL LOCAL HELPERS (admin.js keeps these module-private too, so we
// keep our own copies rather than depending on admin.js internals)
// ===================================================================
function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function debounce(fn, delay) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('show');
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('show');
}

// Base URL used ONLY for the raw-HTML preview endpoint, which has to be
// opened as a real page navigation (not a fetch/apiGet call) so the
// browser sends the admin's auth cookie. Adjust the global name(s) below
// to match whatever js/config.js actually exposes if this doesn't work.
function getApiBaseUrl() {
  return (
    window.API_BASE_URL ||
    window.API_URL ||
    window.API_BASE ||
    (window.CONFIG && window.CONFIG.API_URL) ||
    ''
  );
}

function insertAtCursor(textarea, text) {
  if (!textarea) return;
  const start = textarea.selectionStart || 0;
  const end = textarea.selectionEnd || 0;
  textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + text.length;
}

// ===================================================================
// BOOT
// ===================================================================
document.addEventListener('DOMContentLoaded', init);

function init() {
  const mainTabBtn = document.querySelector('[data-tab="emailmarketing"]');
  if (!mainTabBtn) return; // HTML block not pasted into admin.html yet

  mainTabBtn.addEventListener('click', () => loadEmailMarketingTab());

  wireEmkSubtabs();

  // Campaigns
  document.getElementById('emkCampaignStatusFilter')?.addEventListener('change', (e) => {
    emkCampaignStatusFilter = e.target.value;
    loadEmkCampaigns();
  });
  document.getElementById('emkNewCampaignBtn')?.addEventListener('click', () => openEmkCampaignModal(null));
  document.getElementById('emkCampaignForm')?.addEventListener('submit', submitEmkCampaignForm);
  document.getElementById('emkSaveDraftBtn')?.addEventListener('click', () => saveEmkCampaignDraft(true));
  document.getElementById('emkPreviewBtn')?.addEventListener('click', () => openEmkPreviewCurrent());
  document.getElementById('emkWhenNow')?.addEventListener('change', updateEmkScheduleUI);
  document.getElementById('emkWhenLater')?.addEventListener('change', updateEmkScheduleUI);
  document.getElementById('emkSegmentType')?.addEventListener('change', onEmkSegmentTypeChange);
  document.getElementById('emkSegmentTermInput')?.addEventListener('input', debounce(triggerEmkEstimate, 500));
  document.getElementById('emkSegmentCategorySelect')?.addEventListener('change', triggerEmkEstimate);
  document.getElementById('emkSegmentEmailsInput')?.addEventListener('input', debounce(triggerEmkEstimate, 500));

  document.querySelectorAll('[data-emk-content-chip]').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('[data-emk-content-chip]').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      const input = chip.querySelector('input');
      if (input) input.checked = true;
    });
  });
  document.querySelectorAll('.emk-placeholder-chip').forEach((btn) =>
    btn.addEventListener('click', () => insertAtCursor(document.getElementById('emkBodyHtml'), btn.dataset.insert))
  );

  // Subscribers
  document.getElementById('emkSubscriberSearch')?.addEventListener('input', debounce((e) => {
    emkSubscriberFilters.search = e.target.value.trim();
    emkSubscriberFilters.page = 1;
    loadEmkSubscribers();
  }, 400));
  document.getElementById('emkSubscriberStatusFilter')?.addEventListener('change', (e) => {
    emkSubscriberFilters.status = e.target.value;
    emkSubscriberFilters.page = 1;
    loadEmkSubscribers();
  });
  document.getElementById('emkSubscriberRoleFilter')?.addEventListener('change', (e) => {
    emkSubscriberFilters.role = e.target.value;
    emkSubscriberFilters.page = 1;
    loadEmkSubscribers();
  });

  // WhatsApp
  wireEmkWaProductSearch();
  document.getElementById('emkWaForm')?.addEventListener('submit', submitEmkWaForm);
}

function wireEmkSubtabs() {
  document.querySelectorAll('#emkSubtabBar button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#emkSubtabBar button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      emkSubtab = btn.dataset.emkSubtab;
      document.getElementById('emkPanelCampaigns').style.display = emkSubtab === 'campaigns' ? 'block' : 'none';
      document.getElementById('emkPanelSubscribers').style.display = emkSubtab === 'subscribers' ? 'block' : 'none';
      document.getElementById('emkPanelWhatsapp').style.display = emkSubtab === 'whatsapp' ? 'block' : 'none';
      loadEmailMarketingTab();
    });
  });
}

function loadEmailMarketingTab() {
  if (emkSubtab === 'campaigns') {
    loadEmkCampaigns();
  } else if (emkSubtab === 'subscribers') {
    loadEmkSubscriberStats();
    loadEmkTopSearches();
    loadEmkSubscribers();
  } else if (emkSubtab === 'whatsapp') {
    loadEmkWaPromos();
  }
}

// ===================================================================
// CAMPAIGNS
// ===================================================================
async function loadEmkCampaigns() {
  const tbody = document.getElementById('emkCampaignsBody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="8"><div class="spinner"></div></td></tr>`;
  try {
    const qs = emkCampaignStatusFilter ? `?status=${emkCampaignStatusFilter}` : '';
    const { campaigns } = await apiGet(`/marketing/email/campaigns${qs}`);
    emkCampaignsCache = campaigns;
    renderEmkCampaignStats(campaigns);

    if (!campaigns.length) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="dash-empty"><i class="fa-solid fa-envelope-open-text"></i><p>No campaigns yet — create your first one.</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = campaigns.map(emkCampaignRowHtml).join('');
    wireEmkCampaignRowActions(campaigns);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

function renderEmkCampaignStats(campaigns) {
  const grid = document.getElementById('emkCampaignStats');
  if (!grid) return;
  const totals = campaigns.reduce(
    (acc, c) => {
      acc.recipients += c.stats?.totalRecipients || 0;
      acc.sent += c.stats?.sent || 0;
      acc.opened += c.stats?.opened || 0;
      acc.clicked += c.stats?.clicked || 0;
      return acc;
    },
    { recipients: 0, sent: 0, opened: 0, clicked: 0 }
  );

  grid.innerHTML = `
    <div class="stat-card"><div class="stat-label">Campaigns</div><div class="stat-value">${campaigns.length}</div></div>
    <div class="stat-card"><div class="stat-label">Total Recipients</div><div class="stat-value">${totals.recipients.toLocaleString()}</div></div>
    <div class="stat-card"><div class="stat-label">Emails Sent</div><div class="stat-value">${totals.sent.toLocaleString()}</div></div>
    <div class="stat-card"><div class="stat-label">Opens / Clicks</div><div class="stat-value">${totals.opened.toLocaleString()} / ${totals.clicked.toLocaleString()}</div></div>
  `;
}

function emkSegmentLabel(segment) {
  if (!segment) return '-';
  const labels = {
    all_subscribers: 'Everyone subscribed',
    buyers: 'All buyers',
    sellers: 'All sellers',
    guests: 'Guests only',
    searched_term: `Searched "${segment.value || ''}"`,
    viewed_category: 'Viewed category',
    custom_emails: `${Array.isArray(segment.value) ? segment.value.length : 0} pasted emails`,
  };
  return labels[segment.type] || segment.type;
}

function emkCampaignRowHtml(c) {
  const when =
    c.status === 'scheduled' && c.scheduledAt
      ? new Date(c.scheduledAt).toLocaleString()
      : c.sentAt
      ? new Date(c.sentAt).toLocaleString()
      : '—';

  return `
    <tr>
      <td class="wrap-cell"><strong>${escapeHtml(c.name)}</strong><div class="text-muted">${escapeHtml(c.subject)}</div></td>
      <td class="text-muted">${escapeHtml(emkSegmentLabel(c.segment))}</td>
      <td><span class="pill pill-${c.status}">${c.status.replace(/_/g, ' ')}</span></td>
      <td class="text-muted">${when}</td>
      <td>${c.stats?.totalRecipients || 0}</td>
      <td>${c.stats?.opened || 0}</td>
      <td>${c.stats?.clicked || 0}</td>
      <td><div class="row-actions">${emkCampaignActionsHtml(c)}</div></td>
    </tr>`;
}

function emkCampaignActionsHtml(c) {
  const actions = [];
  if (['draft', 'scheduled'].includes(c.status)) {
    actions.push(`<button class="act-edit" data-emk-edit="${c._id}">Edit</button>`);
  }
  if (c.status === 'scheduled') {
    actions.push(`<button class="act-suspend" data-emk-cancel="${c._id}">Cancel</button>`);
  }
  actions.push(`<button class="act-edit" data-emk-preview="${c._id}">Preview</button>`);
  if (['sending', 'sent'].includes(c.status)) {
    actions.push(`<button class="act-edit" data-emk-logs="${c._id}">Logs</button>`);
  }
  actions.push(`<button class="act-edit" data-emk-duplicate="${c._id}">Duplicate</button>`);
  if (c.status !== 'sending') {
    actions.push(`<button class="act-reject" data-emk-delete="${c._id}">Delete</button>`);
  }
  return actions.join('');
}

function wireEmkCampaignRowActions(campaigns) {
  document.querySelectorAll('[data-emk-edit]').forEach((btn) =>
    btn.addEventListener('click', () => openEmkCampaignModal(campaigns.find((c) => c._id === btn.dataset.emkEdit)))
  );
  document.querySelectorAll('[data-emk-cancel]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('Cancel this scheduled campaign?')) return;
      try {
        await apiPatch(`/marketing/email/campaigns/${btn.dataset.emkCancel}/cancel`, {});
        showToast('Campaign cancelled');
        loadEmkCampaigns();
      } catch (err) {
        showToast(err.message, 'error');
      }
    })
  );
  document.querySelectorAll('[data-emk-preview]').forEach((btn) =>
    btn.addEventListener('click', () => openEmkPreviewById(btn.dataset.emkPreview))
  );
  document.querySelectorAll('[data-emk-logs]').forEach((btn) =>
    btn.addEventListener('click', () => openEmkLogsModal(campaigns.find((c) => c._id === btn.dataset.emkLogs)))
  );
  document.querySelectorAll('[data-emk-duplicate]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        await apiPost(`/marketing/email/campaigns/${btn.dataset.emkDuplicate}/duplicate`, {});
        showToast('Campaign duplicated as a draft');
        loadEmkCampaigns();
      } catch (err) {
        showToast(err.message, 'error');
      }
    })
  );
  document.querySelectorAll('[data-emk-delete]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this campaign permanently?')) return;
      try {
        await apiDelete(`/marketing/email/campaigns/${btn.dataset.emkDelete}`);
        showToast('Campaign deleted');
        loadEmkCampaigns();
      } catch (err) {
        showToast(err.message, 'error');
      }
    })
  );
}

// ---------- Campaign modal ----------
async function ensureEmkCategoriesLoaded() {
  if (emkSegmentCategoriesCache.length) return;
  try {
    const { categories } = await apiGet('/admin/categories');
    emkSegmentCategoriesCache = categories || [];
    const sel = document.getElementById('emkSegmentCategorySelect');
    if (sel) {
      sel.innerHTML = emkSegmentCategoriesCache.map((c) => `<option value="${c._id}">${escapeHtml(c.name)}</option>`).join('');
    }
  } catch (err) {
    emkSegmentCategoriesCache = [];
  }
}

async function openEmkCampaignModal(campaign) {
  await ensureEmkCategoriesLoaded();

  const modal = document.getElementById('emkCampaignModal');
  modal.dataset.campaignId = campaign?._id || '';
  document.getElementById('emkCampaignModalTitle').textContent = campaign ? 'Edit Campaign' : 'New Campaign';

  document.getElementById('emkName').value = campaign?.name || '';
  document.getElementById('emkFromName').value = campaign?.fromName || '';
  document.getElementById('emkSubject').value = campaign?.subject || '';
  document.getElementById('emkPreviewText').value = campaign?.previewText || '';
  document.getElementById('emkBodyHtml').value = campaign?.bodyHtml || '';
  document.getElementById('emkHeroImage').value = campaign?.heroImageUrl || '';
  document.getElementById('emkRecCount').value = campaign?.recommendedProductCount ?? 4;
  document.getElementById('emkCtaText').value = campaign?.ctaText || 'Shop Now';
  document.getElementById('emkCtaUrl').value = campaign?.ctaUrl || '';

  const contentType = campaign?.contentType || 'custom';
  document.querySelectorAll('[data-emk-content-chip]').forEach((chip) => {
    const active = chip.dataset.emkContentChip === contentType;
    chip.classList.toggle('active', active);
    const input = chip.querySelector('input');
    if (input) input.checked = active;
  });

  const segType = campaign?.segment?.type || 'all_subscribers';
  document.getElementById('emkSegmentType').value = segType;
  document.getElementById('emkSegmentTermInput').value = segType === 'searched_term' ? campaign?.segment?.value || '' : '';
  document.getElementById('emkSegmentCategorySelect').value = segType === 'viewed_category' ? campaign?.segment?.value || '' : '';
  document.getElementById('emkSegmentEmailsInput').value =
    segType === 'custom_emails' && Array.isArray(campaign?.segment?.value) ? campaign.segment.value.join('\n') : '';
  onEmkSegmentTypeChange();

  document.getElementById('emkWhenNow').checked = true;
  document.getElementById('emkWhenLater').checked = false;
  document.getElementById('emkScheduleAt').value = campaign?.scheduledAt ? campaign.scheduledAt.slice(0, 16) : '';
  updateEmkScheduleUI();

  openModal('emkCampaignModal');
}

function onEmkSegmentTypeChange() {
  const type = document.getElementById('emkSegmentType').value;
  document.getElementById('emkSegmentTermBox').style.display = type === 'searched_term' ? 'block' : 'none';
  document.getElementById('emkSegmentCategoryBox').style.display = type === 'viewed_category' ? 'block' : 'none';
  document.getElementById('emkSegmentEmailsBox').style.display = type === 'custom_emails' ? 'block' : 'none';
  triggerEmkEstimate();
}

function buildSegmentFromForm() {
  const type = document.getElementById('emkSegmentType').value;
  let value = null;
  if (type === 'searched_term') {
    value = document.getElementById('emkSegmentTermInput').value.trim().toLowerCase();
  } else if (type === 'viewed_category') {
    value = document.getElementById('emkSegmentCategorySelect').value;
  } else if (type === 'custom_emails') {
    value = document
      .getElementById('emkSegmentEmailsInput')
      .value.split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return { type, value };
}

async function triggerEmkEstimate() {
  const el = document.getElementById('emkRecipientCount');
  if (!el) return;
  const segment = buildSegmentFromForm();
  el.textContent = 'Estimated recipients: …';
  try {
    const { count } = await apiPost('/marketing/email/campaigns/estimate-segment', { segment });
    el.textContent = `Estimated recipients: ${(count || 0).toLocaleString()}`;
  } catch (err) {
    el.textContent = 'Estimated recipients: —';
  }
}

function collectEmkPayload() {
  const contentType = document.querySelector('[data-emk-content-chip].active')?.dataset.emkContentChip || 'custom';
  return {
    name: document.getElementById('emkName').value.trim(),
    subject: document.getElementById('emkSubject').value.trim(),
    previewText: document.getElementById('emkPreviewText').value.trim(),
    fromName: document.getElementById('emkFromName').value.trim(),
    contentType,
    heroImageUrl: document.getElementById('emkHeroImage').value.trim(),
    bodyHtml: document.getElementById('emkBodyHtml').value,
    ctaText: document.getElementById('emkCtaText').value.trim(),
    ctaUrl: document.getElementById('emkCtaUrl').value.trim(),
    recommendedProductCount: Number(document.getElementById('emkRecCount').value) || 0,
    segment: buildSegmentFromForm(),
  };
}

function updateEmkScheduleUI() {
  const later = document.getElementById('emkWhenLater')?.checked;
  const dt = document.getElementById('emkScheduleAt');
  const btn = document.getElementById('emkSendOrScheduleBtn');
  if (dt) dt.style.display = later ? 'inline-block' : 'none';
  if (btn) btn.textContent = later ? 'Schedule' : 'Send Now';
}

async function saveEmkCampaignDraft(showConfirmation) {
  const modal = document.getElementById('emkCampaignModal');
  const payload = collectEmkPayload();
  let id = modal.dataset.campaignId;

  try {
    let campaign;
    if (id) {
      ({ campaign } = await apiPatch(`/marketing/email/campaigns/${id}`, payload));
    } else {
      ({ campaign } = await apiPost('/marketing/email/campaigns', payload));
      id = campaign._id;
      modal.dataset.campaignId = id;
    }
    if (showConfirmation) {
      showToast('Draft saved');
      loadEmkCampaigns();
    }
    return campaign;
  } catch (err) {
    showToast(err.message, 'error');
    return null;
  }
}

async function submitEmkCampaignForm(e) {
  e.preventDefault();
  const modal = document.getElementById('emkCampaignModal');
  const payload = collectEmkPayload();
  let id = modal.dataset.campaignId;

  try {
    let campaign;
    if (id) {
      ({ campaign } = await apiPatch(`/marketing/email/campaigns/${id}`, payload));
    } else {
      ({ campaign } = await apiPost('/marketing/email/campaigns', payload));
      id = campaign._id;
      modal.dataset.campaignId = id;
    }

    const later = document.getElementById('emkWhenLater').checked;
    if (later) {
      const scheduledAt = document.getElementById('emkScheduleAt').value;
      if (!scheduledAt) {
        showToast('Pick a date and time to schedule this campaign', 'error');
        return;
      }
      await apiPatch(`/marketing/email/campaigns/${id}/schedule`, { scheduledAt });
      showToast('Campaign scheduled');
    } else {
      await apiPost(`/marketing/email/campaigns/${id}/send-now`, {});
      showToast('Campaign is sending now — refresh in a moment to see live stats');
    }

    closeModal('emkCampaignModal');
    loadEmkCampaigns();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function openEmkPreviewCurrent() {
  const modal = document.getElementById('emkCampaignModal');
  let id = modal.dataset.campaignId;
  if (!id) {
    const campaign = await saveEmkCampaignDraft(false);
    if (!campaign) return;
    id = campaign._id;
  }
  openEmkPreviewById(id);
}

function openEmkPreviewById(id) {
  const base = getApiBaseUrl();
  window.open(`${base}/marketing/email/campaigns/${id}/preview`, '_blank');
}

async function openEmkCampaignModalWithTermSegment(term) {
  await openEmkCampaignModal(null);
  document.getElementById('emkSegmentType').value = 'searched_term';
  onEmkSegmentTypeChange();
  document.getElementById('emkSegmentTermInput').value = term;
  triggerEmkEstimate();
}

async function openEmkLogsModal(campaign) {
  if (!campaign) return;
  document.getElementById('emkLogsCampaignName').textContent = campaign.name;
  const tbody = document.getElementById('emkLogsBody');
  tbody.innerHTML = `<tr><td colspan="5"><div class="spinner"></div></td></tr>`;
  openModal('emkLogsModal');

  try {
    const { logs } = await apiGet(`/marketing/email/campaigns/${campaign._id}/logs`);
    if (!logs.length) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="dash-empty"><p>No sends logged yet.</p></div></td></tr>`;
      return;
    }
    tbody.innerHTML = logs
      .map(
        (l) => `
      <tr>
        <td>${escapeHtml(l.email)}</td>
        <td><span class="pill pill-${l.status}">${l.status}</span></td>
        <td class="text-muted">${l.sentAt ? new Date(l.sentAt).toLocaleString() : '—'}</td>
        <td class="text-muted">${l.openedAt ? new Date(l.openedAt).toLocaleString() : '—'}</td>
        <td class="text-muted">${l.clickedAt ? new Date(l.clickedAt).toLocaleString() : '—'}</td>
      </tr>`
      )
      .join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="dash-empty"><p>${err.message}</p></div></td></tr>`;
  }
}

// ===================================================================
// SUBSCRIBERS / CRM
// ===================================================================
async function loadEmkSubscriberStats() {
  const grid = document.getElementById('emkSubscriberStats');
  if (!grid) return;
  grid.innerHTML = `<div class="stat-card"><div class="spinner"></div></div>`.repeat(4);
  try {
    const s = await apiGet('/marketing/email/subscribers/stats');
    grid.innerHTML = `
      <div class="stat-card"><div class="stat-label">Total Subscribers</div><div class="stat-value">${s.total}</div></div>
      <div class="stat-card"><div class="stat-label">Subscribed</div><div class="stat-value">${s.subscribed}</div></div>
      <div class="stat-card"><div class="stat-label">Guests (no account)</div><div class="stat-value">${s.guests}</div></div>
      <div class="stat-card"><div class="stat-label">With Search / View History</div><div class="stat-value">${s.withSearchHistory} / ${s.withViewHistory}</div></div>
    `;
  } catch (err) {
    grid.innerHTML = `<div class="dash-empty"><p>${err.message}</p></div>`;
  }
}

async function loadEmkTopSearches() {
  const row = document.getElementById('emkTopSearchesRow');
  if (!row) return;
  row.innerHTML = `<span class="text-muted">Loading…</span>`;
  try {
    const { terms } = await apiGet('/marketing/email/subscribers/top-searches');
    if (!terms.length) {
      row.innerHTML = `<span class="text-muted">No search activity logged yet.</span>`;
      return;
    }
    row.innerHTML = terms
      .map((t) => `<button type="button" class="emk-search-chip" data-emk-term-chip="${escapeHtml(t._id)}">${escapeHtml(t._id)} (${t.subscribers})</button>`)
      .join('');
    row.querySelectorAll('[data-emk-term-chip]').forEach((chip) =>
      chip.addEventListener('click', () => openEmkCampaignModalWithTermSegment(chip.dataset.emkTermChip))
    );
  } catch (err) {
    row.innerHTML = `<span class="text-muted">${err.message}</span>`;
  }
}

async function loadEmkSubscribers() {
  const tbody = document.getElementById('emkSubscribersBody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="9"><div class="spinner"></div></td></tr>`;
  try {
    const params = new URLSearchParams();
    if (emkSubscriberFilters.search) params.set('search', emkSubscriberFilters.search);
    if (emkSubscriberFilters.status) params.set('status', emkSubscriberFilters.status);
    if (emkSubscriberFilters.role) params.set('role', emkSubscriberFilters.role);
    params.set('page', emkSubscriberFilters.page);
    params.set('limit', 20);

    const { subscribers, page, pages } = await apiGet(`/marketing/email/subscribers?${params.toString()}`);
    emkSubscribersCache = subscribers;

    if (!subscribers.length) {
      tbody.innerHTML = `<tr><td colspan="9"><div class="dash-empty"><i class="fa-solid fa-address-book"></i><p>No subscribers match these filters.</p></div></td></tr>`;
      document.getElementById('emkSubscribersPagination').innerHTML = '';
      return;
    }

    tbody.innerHTML = subscribers.map(emkSubscriberRowHtml).join('');
    tbody.querySelectorAll('[data-emk-sub-view]').forEach((btn) =>
      btn.addEventListener('click', () => openEmkSubscriberModal(btn.dataset.emkSubView))
    );
    renderEmkSubscribersPagination(page, pages);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

function emkSubscriberRowHtml(s) {
  return `
    <tr>
      <td>${escapeHtml(s.email)}</td>
      <td>${escapeHtml(s.name || '-')}</td>
      <td><span class="pill pill-${s.role}">${s.role}</span></td>
      <td class="text-muted">${escapeHtml((s.source || '').replace(/_/g, ' '))}</td>
      <td><span class="pill ${s.status === 'subscribed' ? 'pill-active' : 'pill-rejected'}">${s.status}</span></td>
      <td>${s.searchHistory?.length || 0}</td>
      <td>${s.viewedProducts?.length || 0}</td>
      <td class="text-muted">${new Date(s.createdAt).toLocaleDateString()}</td>
      <td><div class="row-actions"><button class="act-edit" data-emk-sub-view="${s._id}">View</button></div></td>
    </tr>`;
}

function renderEmkSubscribersPagination(page, pages) {
  const el = document.getElementById('emkSubscribersPagination');
  if (!el) return;
  if (pages <= 1) {
    el.innerHTML = '';
    return;
  }
  let html = '';
  for (let i = 1; i <= pages; i++) {
    html += `<button class="${i === page ? 'active' : ''}" data-page="${i}">${i}</button>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('button').forEach((btn) =>
    btn.addEventListener('click', () => {
      emkSubscriberFilters.page = Number(btn.dataset.page);
      loadEmkSubscribers();
    })
  );
}

async function openEmkSubscriberModal(id) {
  try {
    const { subscriber } = await apiGet(`/marketing/email/subscribers/${id}`);

    document.getElementById('emkSubModalEmail').textContent = subscriber.email;
    const statusPill = document.getElementById('emkSubModalStatus');
    statusPill.className = `pill ${subscriber.status === 'subscribed' ? 'pill-active' : 'pill-rejected'}`;
    statusPill.textContent = subscriber.status;
    document.getElementById('emkSubModalRole').textContent = subscriber.role;
    document.getElementById('emkSubModalSource').textContent = (subscriber.source || '').replace(/_/g, ' ');
    document.getElementById('emkSubModalJoined').textContent = new Date(subscriber.createdAt).toLocaleString();
    document.getElementById('emkSubModalSent').textContent = subscriber.emailsSentCount || 0;
    document.getElementById('emkSubModalEngagement').textContent = `${subscriber.emailsOpenedCount || 0} / ${subscriber.emailsClickedCount || 0}`;

    const searchesEl = document.getElementById('emkSubModalSearches');
    searchesEl.innerHTML = (subscriber.searchHistory || []).length
      ? subscriber.searchHistory.map((s) => `<span class="emk-search-chip" style="cursor:default;">${escapeHtml(s.term)} (${s.count})</span>`).join('')
      : '<span class="text-muted">No searches logged.</span>';

    const viewedEl = document.getElementById('emkSubModalViewed');
    viewedEl.innerHTML = (subscriber.viewedProducts || []).length
      ? subscriber.viewedProducts
          .map((v) => `<div class="od-row"><span>${escapeHtml(v.product?.name || 'Product')}</span><span class="text-muted">${v.viewCount}x</span></div>`)
          .join('')
      : '<span class="text-muted">No products viewed.</span>';

    const actions = document.getElementById('emkSubModalActions');
    actions.innerHTML = `
      <button type="button" class="btn ${subscriber.status === 'subscribed' ? 'btn-dark' : 'btn-primary'}" id="emkSubToggleBtn">
        ${subscriber.status === 'subscribed' ? 'Unsubscribe' : 'Resubscribe'}
      </button>
      <button type="button" class="btn btn-dark act-reject" id="emkSubDeleteBtn">Delete Subscriber</button>`;

    document.getElementById('emkSubToggleBtn').addEventListener('click', async () => {
      try {
        await apiPatch(`/marketing/email/subscribers/${subscriber._id}`, {
          status: subscriber.status === 'subscribed' ? 'unsubscribed' : 'subscribed',
        });
        showToast('Subscriber updated');
        closeModal('emkSubscriberModal');
        loadEmkSubscribers();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    document.getElementById('emkSubDeleteBtn').addEventListener('click', async () => {
      if (!confirm('Delete this subscriber permanently?')) return;
      try {
        await apiDelete(`/marketing/email/subscribers/${subscriber._id}`);
        showToast('Subscriber deleted');
        closeModal('emkSubscriberModal');
        loadEmkSubscribers();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    openModal('emkSubscriberModal');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===================================================================
// WHATSAPP PROMOS
// ===================================================================
function wireEmkWaProductSearch() {
  const input = document.getElementById('emkWaProductSearch');
  if (!input) return;
  input.addEventListener(
    'input',
    debounce(async () => {
      const q = input.value.trim();
      const resultsEl = document.getElementById('emkWaProductResults');
      if (!q) {
        resultsEl.innerHTML = '';
        return;
      }
      try {
        const { products } = await apiGet(`/admin/products?search=${encodeURIComponent(q)}&limit=6`);
        resultsEl.innerHTML = products.length
          ? products
              .map(
                (p) => `
          <div class="assigned-attr-row" data-emk-wa-pick="${p._id}" data-emk-wa-name="${escapeHtml(p.name)}" style="cursor:pointer;">
            <span class="attr-name">${escapeHtml(p.name)}</span>
            <span class="text-muted">KSh ${(p.finalPrice || p.sellerPrice || 0).toLocaleString()}</span>
          </div>`
              )
              .join('')
          : `<div class="assigned-attr-empty">No products found.</div>`;

        resultsEl.querySelectorAll('[data-emk-wa-pick]').forEach((row) =>
          row.addEventListener('click', () => {
            document.getElementById('emkWaProductId').value = row.dataset.emkWaPick;
            input.value = row.dataset.emkWaName;
            resultsEl.innerHTML = '';
          })
        );
      } catch (err) {
        resultsEl.innerHTML = `<div class="assigned-attr-empty">${err.message}</div>`;
      }
    }, 350)
  );
}

async function submitEmkWaForm(e) {
  e.preventDefault();
  const payload = {
    productId: document.getElementById('emkWaProductId').value || undefined,
    customMessage: document.getElementById('emkWaCustomMessage').value.trim(),
    imageUrl: document.getElementById('emkWaImageUrl').value.trim(),
  };
  try {
    await apiPost('/marketing/email/whatsapp-promo/generate', payload);
    showToast('Promo generated');
    document.getElementById('emkWaForm').reset();
    document.getElementById('emkWaProductId').value = '';
    document.getElementById('emkWaProductResults').innerHTML = '';
    loadEmkWaPromos();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadEmkWaPromos() {
  const grid = document.getElementById('emkWaGrid');
  if (!grid) return;
  grid.innerHTML = `<div class="spinner"></div>`;
  try {
    const { promos } = await apiGet('/marketing/email/whatsapp-promo');
    if (!promos.length) {
      grid.innerHTML = `<div class="dash-empty"><i class="fa-brands fa-whatsapp"></i><p>No promos generated yet.</p></div>`;
      return;
    }

    grid.innerHTML = promos
      .map(
        (p) => `
      <div class="emk-wa-card">
        ${p.imageUrl ? `<img class="emk-wa-card__img" src="${p.imageUrl}" alt="">` : ''}
        <div class="emk-wa-card__body">
          <div style="font-weight:700; font-size:.85rem; margin-bottom:8px;">${escapeHtml(p.title)}</div>
          ${(p.captions || [])
            .map(
              (cap) => `
            <div class="emk-caption-box">${escapeHtml(cap)}</div>
            <div class="emk-caption-actions">
              <button type="button" class="act-edit" data-emk-copy-caption="${encodeURIComponent(cap)}">Copy</button>
              <a class="act-edit" style="text-decoration:none; display:inline-block;" href="https://wa.me/?text=${encodeURIComponent(cap)}" target="_blank" rel="noopener">Share</a>
            </div>`
            )
            .join('')}
          ${p.imageUrl ? `<a class="act-edit" style="text-decoration:none; display:inline-block; margin-bottom:8px;" href="${p.imageUrl}" download target="_blank" rel="noopener">Download Image</a>` : ''}
          <button type="button" class="act-reject" data-emk-delete-promo="${p._id}" style="width:100%;">Delete</button>
        </div>
      </div>`
      )
      .join('');

    grid.querySelectorAll('[data-emk-copy-caption]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(decodeURIComponent(btn.dataset.emkCopyCaption));
          showToast('Caption copied');
        } catch (err) {
          showToast('Could not copy — select and copy manually', 'error');
        }
      })
    );
    grid.querySelectorAll('[data-emk-delete-promo]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this promo?')) return;
        try {
          await apiDelete(`/marketing/email/whatsapp-promo/${btn.dataset.emkDeletePromo}`);
          showToast('Promo deleted');
          loadEmkWaPromos();
        } catch (err) {
          showToast(err.message, 'error');
        }
      })
    );
  } catch (err) {
    grid.innerHTML = `<div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div>`;
  }
}