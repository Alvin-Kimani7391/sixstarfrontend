/* ============================================================
   CHAT.JS — "Live Quotes" broadcast board
   Rewritten to match the redesigned chat.html / chat.css.

   Public page: anyone can browse. Replying is gated to verified
   sellers only, checked against the session via SS_API.getMe().

   Posting a new request is done through the "Quick Quote" bottom
   sheet, opened from the composer bar at the bottom (#qcComposerBtn
   -> #qcSheet). The sheet shares its form markup/ids with rfq.html
   and is driven by the same window.SS_RFQ_FORM controller defined
   in rfq.js — see the "Quick Quote sheet" section below.

   NOTE FOR GHIK: adjust the field-name checks inside
   getReplyState() below to match your real User model field
   names for role / seller verification if they differ.
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- tiny utils ---------------- */
  function esc(str) { return ssEscapeHtml(String(str ?? '')); }
  function money(n) { return ssFmtPrice(n); }
  function toast(msg, icon) { ssToast(msg, icon); }
  function fmtCount(n) { return n > 99 ? '99+' : String(n); }

  function debounce(fn, wait) {
    let t;
    return function debounced(...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  const STATUS_LABEL = {
    OPEN: 'Open',
    BIDDING: 'Receiving Offers',
    SELLER_SELECTED: 'Seller Selected',
    CLOSED: 'Closed',
    EXPIRED: 'Expired',
    CANCELLED: 'Cancelled',
  };

  const STATUS_ICON = {
    open: 'fa-file-invoice',
    bidding: 'fa-comments-dollar',
    seller_selected: 'fa-circle-check',
    closed: 'fa-box-archive',
    expired: 'fa-hourglass-end',
    cancelled: 'fa-ban',
  };

  const ARCHIVED_STATUSES = ['CLOSED', 'EXPIRED', 'CANCELLED'];
  const POLL_INTERVAL_MS = 45000;

  /* ---------------- elements ---------------- */
  const messagesEl   = document.getElementById('qcMessages');
  const loadingEl    = document.getElementById('qcLoading');
  const jumpBtn      = document.getElementById('qcJump');

  const filtersEl        = document.getElementById('qcFilters');
  const countAllEl       = document.getElementById('qcCountAll');
  const countOpenEl      = document.getElementById('qcCountOpen');
  const countBiddingEl   = document.getElementById('qcCountBidding');
  const countSelectedEl  = document.getElementById('qcCountSelected');
  const countArchivedEl  = document.getElementById('qcCountArchived');

  const searchBtn    = document.getElementById('qcSearchBtn');
  const searchBar    = document.getElementById('qcSearchBar');
  const searchInput  = document.getElementById('qcSearchInput');
  const searchClear  = document.getElementById('qcSearchClear');

  const themeToggleBtn = document.getElementById('qcThemeToggle');
  const themeSwitch    = document.getElementById('qcThemeSwitch');

  const menuBtn       = document.getElementById('qcMenuBtn');
  const menu          = document.getElementById('qcMenu');
  const menuBackdrop  = document.getElementById('qcMenuBackdrop');
  const menuClose     = document.getElementById('qcMenuClose');

  const aboutLink     = document.getElementById('qcAboutLink');
  const aboutBackdrop = document.getElementById('qcAboutBackdrop');
  const aboutClose    = document.getElementById('qcAboutClose');

  const composerBtn     = document.getElementById('qcComposerBtn');
  const sheet            = document.getElementById('qcSheet');
  const sheetBackdrop    = document.getElementById('qcSheetBackdrop');
  const sheetClose       = document.getElementById('qcSheetClose');
  const sheetHandleWrap  = document.getElementById('qcSheetHandle');

  /* ---------------- state ---------------- */
  let allRFQs = [];              // oldest -> newest
  let knownIds = new Set();
  let currentUser = null;
  let currentUserChecked = false;
  let openRowId = null;
  let activeFilter = 'all';
  let searchQuery = '';
  let searchOpen = false;
  let firstLoad = true;
  let pollTimer = null;
  let sheetOpen = false;

  /* ---------------- time helpers ---------------- */
  function timeOf(dateStr) {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function dayLabel(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const isSameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (isSameDay(d, now)) return 'Today';
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    if (isSameDay(d, yesterday)) return 'Yesterday';
    return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
  }

  function dayKey(dateStr) {
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  function fmtDate(d) {
    return d ? new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  }

  /* ---------------- theme (topbar icon + menu switch, kept in sync) ---------------- */
  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function applyTheme(theme, { persist = true } = {}) {
    document.documentElement.setAttribute('data-theme', theme);
    if (persist) {
      try { localStorage.setItem('ss-chat-theme', theme); } catch (e) { /* storage unavailable, ignore */ }
    }
    if (themeSwitch) themeSwitch.checked = theme === 'dark';
  }

  if (themeSwitch) themeSwitch.checked = currentTheme() === 'dark';
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
  }
  if (themeSwitch) {
    themeSwitch.addEventListener('change', () => applyTheme(themeSwitch.checked ? 'dark' : 'light'));
  }

  /* ---------------- current user / reply gating ---------------- */
  async function ensureCurrentUser() {
    if (currentUserChecked) return currentUser;
    currentUserChecked = true;
    try {
      const res = await SS_API.getMe();
      currentUser = (res && (res.user || res)) || null;
    } catch (err) {
      currentUser = null; // guest, or session expired
    }
    return currentUser;
  }

  function getReplyState() {
    if (!currentUser) {
      return { allowed: false, reason: 'login', message: 'Log in as a verified seller to submit an offer.' };
    }
    const role = (currentUser.role || '').toLowerCase();
    if (role !== 'seller') {
      return { allowed: false, reason: 'not-seller', message: 'Only verified sellers can reply to quote requests.' };
    }
    const isVerified = currentUser.sellerVerified === true
      || currentUser.isVerified === true
      || currentUser.verificationStatus === 'approved'
      || currentUser?.verification?.status === 'approved';
    if (!isVerified) {
      return { allowed: false, reason: 'unverified', message: 'Your seller account is still pending verification.' };
    }
    return { allowed: true };
  }

  async function handleReplyClick(rfq) {
    await ensureCurrentUser();
    const state = getReplyState();
    if (!state.allowed) {
      toast(state.message, 'fa-lock');
      if (state.reason === 'login') {
        setTimeout(() => { window.location.href = `login.html?redirect=${encodeURIComponent('chat.html')}`; }, 900);
      }
      return;
    }
    window.location.href = `seller-dashboard.html?rfq=${encodeURIComponent(rfq._id)}&action=bid`;
  }

  /* ---------------- filtering ---------------- */
  function matchesFilter(rfq) {
    switch (activeFilter) {
      case 'all': return true;
      case 'open': return rfq.status === 'OPEN';
      case 'bidding': return rfq.status === 'BIDDING';
      case 'selected': return rfq.status === 'SELLER_SELECTED';
      case 'archived': return ARCHIVED_STATUSES.includes(rfq.status);
      default: return true;
    }
  }

  function matchesSearch(rfq) {
    if (!searchQuery) return true;
    const hay = `${rfq.productName || ''} ${rfq.location || ''} ${rfq.category || ''}`.toLowerCase();
    return hay.includes(searchQuery);
  }

  function visibleRFQs() {
    return allRFQs.filter((r) => matchesFilter(r) && matchesSearch(r));
  }

  /* ---------------- rendering: pieces ---------------- */
  function statusKeyOf(rfq) { return (rfq.status || 'OPEN').toLowerCase(); }

  function budgetText(rfq) {
    const unit = rfq.budgetType === 'per_unit' ? '/unit' : ' total';
    return `${money(rfq.minBudget)}–${money(rfq.maxBudget)}${unit}`;
  }

  function systemNoteHTML() {
    return `
      <div class="qc-systemnote">
        <span><i class="fa-solid fa-lock"></i>Buyer identities stay masked. Only verified sellers can submit offers.</span>
      </div>`;
  }

  function dayDividerHTML(dateStr) {
    return `<div class="qc-daydivider"><span>${esc(dayLabel(dateStr))}</span></div>`;
  }

  function emptyHTML(icon, title, msg) {
    return `
      <div class="qc-empty">
        <i class="fa-solid ${icon}"></i>
        <strong>${esc(title)}</strong>
        <span>${esc(msg)}</span>
      </div>`;
  }

  function errorHTML(msg) {
    return `<div class="qc-error"><i class="fa-solid fa-triangle-exclamation"></i> <span>${esc(msg)}</span></div>`;
  }

  function bubbleHTML(rfq, isNew) {
    const statusKey = statusKeyOf(rfq);
    const bidCount = rfq.bidCount || 0;
    return `
      <div class="qc-bubble${isNew ? ' is-new' : ''}" data-toggle>
        <div class="qc-bubble__head">
          <div class="qc-bubble__title">${esc(rfq.productName)}</div>
          <div class="qc-bubble__meta">
            <span><i class="fa-solid fa-box"></i>${esc(rfq.quantity)} ${esc(rfq.unit)}</span>
            <span><i class="fa-solid fa-location-dot"></i>${esc(rfq.location)}</span>
            <span class="qc-bubble__budget"><i class="fa-solid fa-sack-dollar"></i>${budgetText(rfq)}</span>
          </div>
        </div>
        <div class="qc-bubble__foot">
          <span class="qc-status qc-status--${statusKey}"><i class="fa-solid fa-circle"></i>${esc(STATUS_LABEL[rfq.status] || rfq.status)}</span>
          <span class="qc-sellers${bidCount === 0 ? ' is-zero' : ''}"><i class="fa-solid fa-users"></i>${bidCount} seller${bidCount === 1 ? '' : 's'}</span>
          <span class="qc-expand-hint"><i class="fa-solid fa-chevron-down"></i>details</span>
        </div>
        <div class="qc-bubble__detail">
          <div class="qc-bubble__detail-inner">
            <div class="qc-bubble__detail-body">
              <p class="qc-detail-desc">${esc(rfq.description)}</p>
              <div class="qc-spec-grid">
                <div class="qc-spec"><span class="qc-spec__label">Quantity</span><span class="qc-spec__value mono">${esc(rfq.quantity)} ${esc(rfq.unit)}</span></div>
                <div class="qc-spec"><span class="qc-spec__label">Budget</span><span class="qc-spec__value mono">${budgetText(rfq)}</span></div>
                <div class="qc-spec"><span class="qc-spec__label">Location</span><span class="qc-spec__value">${esc(rfq.location)}</span></div>
                <div class="qc-spec"><span class="qc-spec__label">Required by</span><span class="qc-spec__value">${esc(fmtDate(rfq.requiredDate))}</span></div>
                <div class="qc-spec"><span class="qc-spec__label">Delivery</span><span class="qc-spec__value">${rfq.deliveryRequired ? 'Required' : 'Buyer will pick up'}</span></div>
                <div class="qc-spec"><span class="qc-spec__label">Delivery budget</span><span class="qc-spec__value mono">${rfq.deliveryBudget ? money(rfq.deliveryBudget) : '—'}</span></div>
              </div>
              <div class="qc-verified-note">
                <i class="fa-solid fa-shield-halved"></i>
                <span><strong>Only verified sellers can reply here.</strong> Replying opens this request in your seller dashboard so you can submit a an offer.</span>
              </div>
              <div class="qc-detail-actions">
                <button class="qc-btn-reply" type="button" data-reply><i class="fa-solid fa-paper-plane"></i> Submit an offer</button>
                
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }

  function rowHTML(rfq, isNew) {
    const statusKey = statusKeyOf(rfq);
    const icon = STATUS_ICON[statusKey] || 'fa-file-invoice';
    return `
      <div class="qc-row qc-sig--${statusKey}${isNew ? ' qc-row--enter' : ''}" data-row-id="${esc(rfq._id)}">
        <div class="qc-row__avatar"><i class="fa-solid ${icon}"></i></div>
        <div class="qc-row__col">
          <div class="qc-row__sender"><i class="fa-solid fa-circle"></i>Verified buyer · identity masked</div>
          ${bubbleHTML(rfq, isNew)}
          <div class="qc-row__footrow">
            <span class="qc-row__time"><i class="fa-solid fa-clock"></i>${esc(timeOf(rfq.createdAt))}</span>
            <button class="qc-quickreply" type="button" data-reply title="Submit an offer" aria-label="Submit an offer">
              <i class="fa-solid fa-reply"></i>
            </button>
          </div>
        </div>
      </div>`;
  }

  /* ---------------- rendering: full feed ---------------- */
  function isNearBottom() {
    return messagesEl.scrollTop + messagesEl.clientHeight >= messagesEl.scrollHeight - 160;
  }

  function render() {
    if (!allRFQs.length) {
      messagesEl.innerHTML = emptyHTML('fa-comment-slash', 'No quote requests yet', 'Be the first to post one — tap the box below.');
      return;
    }

    const list = visibleRFQs();
    if (!list.length) {
      messagesEl.innerHTML = emptyHTML('fa-filter-circle-xmark', 'No matches', 'Try a different search term or filter.');
      return;
    }

    let html = systemNoteHTML();
    let lastKey = null;
    list.forEach((rfq) => {
      const key = dayKey(rfq.createdAt || rfq.requiredDate);
      if (key !== lastKey) {
        html += dayDividerHTML(rfq.createdAt || rfq.requiredDate);
        lastKey = key;
      }
      const isNew = !firstLoad && !knownIds.has(rfq._id);
      html += rowHTML(rfq, isNew);
    });

    messagesEl.innerHTML = html;

    if (openRowId) {
      const row = messagesEl.querySelector(`.qc-row[data-row-id="${CSS.escape(openRowId)}"]`);
      if (row) row.classList.add('open');
    }
  }

  function renderCounts() {
    const total = allRFQs.length;
    const open = allRFQs.filter((r) => r.status === 'OPEN').length;
    const bidding = allRFQs.filter((r) => r.status === 'BIDDING').length;
    const selected = allRFQs.filter((r) => r.status === 'SELLER_SELECTED').length;
    const archived = allRFQs.filter((r) => ARCHIVED_STATUSES.includes(r.status)).length;

    if (countAllEl) countAllEl.textContent = fmtCount(total);
    if (countOpenEl) countOpenEl.textContent = fmtCount(open);
    if (countBiddingEl) countBiddingEl.textContent = fmtCount(bidding);
    if (countSelectedEl) countSelectedEl.textContent = fmtCount(selected);
    if (countArchivedEl) countArchivedEl.textContent = fmtCount(archived);
  }

  /* ---------------- interactions: feed ---------------- */
  messagesEl.addEventListener('click', (e) => {
    const replyBtn = e.target.closest('[data-reply]');
    if (replyBtn) {
      e.stopPropagation();
      const row = replyBtn.closest('.qc-row');
      const rfq = allRFQs.find((r) => r._id === row?.dataset.rowId);
      if (rfq) handleReplyClick(rfq);
      return;
    }
    const toggle = e.target.closest('[data-toggle]');
    if (toggle) {
      const row = toggle.closest('.qc-row');
      const id = row.dataset.rowId;
      const isOpening = !row.classList.contains('open');
      messagesEl.querySelectorAll('.qc-row.open').forEach((r) => r.classList.remove('open'));
      if (isOpening) {
        row.classList.add('open');
        openRowId = id;
      } else {
        openRowId = null;
      }
    }
  });

  messagesEl.addEventListener('scroll', () => {
    if (isNearBottom() && jumpBtn.style.display !== 'none') jumpBtn.style.display = 'none';
  });

  jumpBtn.addEventListener('click', () => {
    messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
    jumpBtn.style.display = 'none';
  });

  /* ---------------- interactions: filter chips ---------------- */
  if (filtersEl) {
    filtersEl.addEventListener('click', (e) => {
      const chip = e.target.closest('.qc-chip');
      if (!chip) return;
      filtersEl.querySelectorAll('.qc-chip').forEach((c) => c.classList.remove('is-active'));
      chip.classList.add('is-active');
      activeFilter = chip.dataset.filter || 'all';
      render();
    });
  }

  /* ---------------- interactions: search ---------------- */
  function toggleSearch(forceOpen) {
    searchOpen = typeof forceOpen === 'boolean' ? forceOpen : !searchOpen;
    searchBar.classList.toggle('open', searchOpen);
    searchBtn.setAttribute('aria-pressed', String(searchOpen));
    if (searchOpen) {
      setTimeout(() => searchInput.focus(), 220);
    } else if (searchInput.value) {
      searchInput.value = '';
      searchQuery = '';
      searchBar.classList.remove('has-value');
      render();
    }
  }

  if (searchBtn && searchBar && searchInput) {
    searchBtn.addEventListener('click', () => toggleSearch());
    searchInput.addEventListener('input', debounce(() => {
      searchQuery = searchInput.value.trim().toLowerCase();
      searchBar.classList.toggle('has-value', !!searchInput.value);
      render();
    }, 180));
    if (searchClear) {
      searchClear.addEventListener('click', () => {
        searchInput.value = '';
        searchQuery = '';
        searchBar.classList.remove('has-value');
        searchInput.focus();
        render();
      });
    }
  }

  /* ---------------- slide-in menu ---------------- */
  function openMenu() {
    menu.classList.add('active');
    menuBackdrop.classList.add('active');
    menuBtn.classList.add('active');
    menuBtn.setAttribute('aria-expanded', 'true');
    menu.setAttribute('aria-hidden', 'false');
  }
  function closeMenu() {
    menu.classList.remove('active');
    menuBackdrop.classList.remove('active');
    menuBtn.classList.remove('active');
    menuBtn.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-hidden', 'true');
  }
  if (menuBtn && menu && menuBackdrop) {
    menuBtn.addEventListener('click', () => (menu.classList.contains('active') ? closeMenu() : openMenu()));
    if (menuClose) menuClose.addEventListener('click', closeMenu);
    menuBackdrop.addEventListener('click', closeMenu);
  }

  /* ---------------- about modal ---------------- */
  if (aboutLink && aboutBackdrop) {
    aboutLink.addEventListener('click', (e) => {
      e.preventDefault();
      closeMenu();
      aboutBackdrop.classList.add('active');
    });
    if (aboutClose) aboutClose.addEventListener('click', () => aboutBackdrop.classList.remove('active'));
    aboutBackdrop.addEventListener('click', (e) => {
      if (e.target === aboutBackdrop) aboutBackdrop.classList.remove('active');
    });
  }

  /* ---------------- Quick Quote sheet (mini rfq.html) ----------------
     Opened from the composer bar at the bottom of the chat. Anyone can
     open it and fill it in — the underlying SS_RFQ_FORM controller
     (js/rfq.js) only checks the buyer session at submit time, so
     browsing + drafting a request never requires logging in first.
  ------------------------------------------------------------------- */
  function openSheet() {
    if (!sheet || !sheetBackdrop || sheetOpen) return;
    sheetOpen = true;
    closeMenu();
    if (aboutBackdrop) aboutBackdrop.classList.remove('active');
    if (searchOpen) toggleSearch(false);
    sheet.classList.add('active');
    sheetBackdrop.classList.add('active');
    sheet.setAttribute('aria-hidden', 'false');
    const firstField = sheet.querySelector('#productName');
    if (firstField) setTimeout(() => firstField.focus({ preventScroll: true }), 320);
  }

  function closeSheet() {
    if (!sheet || !sheetBackdrop || !sheetOpen) return;
    sheetOpen = false;
    sheet.classList.remove('active');
    sheetBackdrop.classList.remove('active');
    sheet.setAttribute('aria-hidden', 'true');
    sheet.classList.remove('dragging');
    sheet.style.transform = '';
  }

  if (composerBtn && sheet && sheetBackdrop) {
    composerBtn.addEventListener('click', openSheet);
    if (sheetClose) sheetClose.addEventListener('click', closeSheet);
    sheetBackdrop.addEventListener('click', closeSheet);

    // Drag-to-dismiss on the handle. Pointer events cover touch + mouse
    // in one listener set, which is what makes the phone experience
    // ("drag the sheet down to close it") work without extra libraries.
    if (sheetHandleWrap) {
      let dragStartY = 0;
      let dragCurrentY = 0;
      let dragging = false;
      const sheetHeight = () => sheet.getBoundingClientRect().height || 1;

      sheetHandleWrap.addEventListener('pointerdown', (e) => {
        dragging = true;
        dragStartY = e.clientY;
        dragCurrentY = 0;
        sheet.classList.add('dragging');
        try { sheetHandleWrap.setPointerCapture(e.pointerId); } catch (err) { /* older browsers, ignore */ }
      });
      sheetHandleWrap.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        dragCurrentY = Math.max(0, e.clientY - dragStartY);
        sheet.style.transform = `translateY(${dragCurrentY}px)`;
      });
      function endDrag() {
        if (!dragging) return;
        dragging = false;
        sheet.classList.remove('dragging');
        if (dragCurrentY > sheetHeight() * 0.28) {
          closeSheet();
        } else {
          sheet.style.transform = '';
        }
      }
      sheetHandleWrap.addEventListener('pointerup', endDrag);
      sheetHandleWrap.addEventListener('pointercancel', endDrag);
    }

    // Wire the shared RFQ form controller (js/rfq.js) to this sheet's
    // form. On success, close the sheet and pull the new request into
    // the live feed immediately instead of waiting for the next poll.
    if (window.SS_RFQ_FORM) {
      SS_RFQ_FORM.init({
        root: sheet,
        onSuccess: () => {
          closeSheet();
          loadRFQs({ isPoll: true });
        },
      });
    }
  }

  /* ---------------- escape closes whatever's open (sheet first) ---------------- */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (sheetOpen) { closeSheet(); return; }
    if (aboutBackdrop && aboutBackdrop.classList.contains('active')) { aboutBackdrop.classList.remove('active'); return; }
    if (menu && menu.classList.contains('active')) { closeMenu(); return; }
    if (searchOpen) toggleSearch(false);
  });

  /* ---------------- load + poll ---------------- */
  async function loadRFQs({ isPoll = false } = {}) {
    try {
      const { rfqs } = await SS_API.getRFQs();
      allRFQs = (rfqs || []).slice().sort(
        (a, b) => new Date(a.createdAt || a.requiredDate) - new Date(b.createdAt || b.requiredDate)
      );

      if (isPoll) {
        const wasNear = isNearBottom();
        render();
        renderCounts();
        if (wasNear) {
          requestAnimationFrame(() => messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' }));
        } else if (allRFQs.some((r) => !knownIds.has(r._id))) {
          jumpBtn.style.display = 'flex';
        }
      } else {
        if (loadingEl && loadingEl.parentNode) loadingEl.remove();
        render();
        renderCounts();
        requestAnimationFrame(() => {
          setTimeout(() => { messagesEl.scrollTop = messagesEl.scrollHeight; firstLoad = false; }, 60);
        });
      }

      allRFQs.forEach((r) => knownIds.add(r._id));
    } catch (err) {
      if (loadingEl && loadingEl.parentNode) loadingEl.remove();
      messagesEl.innerHTML = errorHTML(err.message || 'Could not load quote requests.');
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => loadRFQs({ isPoll: true }), POLL_INTERVAL_MS);
  }
  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  // Pause polling while the tab is hidden (saves requests/battery), and
  // refresh immediately when the person comes back to it.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopPolling();
    } else {
      loadRFQs({ isPoll: true });
      startPolling();
    }
  });

  /* ---------------- boot ---------------- */
  loadRFQs();
  ensureCurrentUser();
  startPolling();

})();