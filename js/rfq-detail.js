/* ============================================================
   RFQ-DETAIL.JS
   Powers rfq-detail.html: request summary + countdown, the
   offers/bids comparison list, and a private chat with whichever
   seller you tap "Message" on — opened as a fullscreen modal
   (closed via the X, backdrop click, or Escape), plus a
   similar-products recommendation rail.
   ============================================================ */
(function () {
  const user = SS_AUTH.requireRole(['buyer']);
  if (!user) return;

  const rfqId = new URLSearchParams(location.search).get('id');
  if (!rfqId) { location.href = 'rfq.html'; return; }

  function esc(str) { return ssEscapeHtml(String(str ?? '')); }
  function money(n) { return ssFmtPrice(n); }
  function toast(msg, icon) { ssToast(msg, icon); }

  const STATUS_LABEL = {
    OPEN: 'Open', BIDDING: 'Receiving Offers', SELLER_SELECTED: 'Seller Selected',
    CLOSED: 'Closed', EXPIRED: 'Expired', CANCELLED: 'Cancelled',
  };
  function statusPill(status) {
    return `<span class="rfq-status rfq-status--${status.toLowerCase()}">${STATUS_LABEL[status] || status}</span>`;
  }
  function fmtDate(d) {
    return d ? new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  }
  function fmtTime(d) {
    return d ? new Date(d).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '';
  }
  function dayLabel(d) {
    const date = new Date(d);
    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const sameDay = (a, b) => a.toDateString() === b.toDateString();
    if (sameDay(date, today)) return 'Today';
    if (sameDay(date, yesterday)) return 'Yesterday';
    return date.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
  }
  function timeAgo(d) {
    const diff = (Date.now() - new Date(d).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }
  function hashHue(str = '') {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h % 6;
  }
  function avatarHTML(identity, size = '') {
    const initials = (identity && identity.initials) || '?';
    const hue = hashHue((identity && identity.label) || initials);
    return `<div class="rfq-avatar ${size}" data-hue="${hue}">${esc(initials)}</div>`;
  }

  /* ---------------- page state ---------------- */
  let rfq = null;
  let offers = [];
  let currentCounterpart = null; // { id, label, initials, isVerified } of whichever seller's chat is open
  let chatPollTimer = null;
  let pendingBidId = null;
  let modalOpen = false;

  /* ---------------- chat state ---------------- */
  let messages = [];
  let knownIds = new Set();
  let buyerRestricted = false; // account-level; persists across conversations once tripped

  const MOD_FLAG_LABEL = {
    phone_number: 'Phone number hidden', email_address: 'Email hidden', whatsapp: 'WhatsApp mention hidden',
    telegram: 'Telegram mention hidden', social_handle: 'Social handle hidden',
    external_payment: 'Payment detail hidden', external_link: 'Link hidden',
  };

  /* ---------------- static modal elements (bound once) ---------------- */
  const rcModalOverlay = document.getElementById('rcModalOverlay');
  const rcModalClose = document.getElementById('rcModalClose');
  const rcAvatar = document.getElementById('rcAvatar');
  const rcLabel = document.getElementById('rcLabel');
  const rcSub = document.getElementById('rcSub');
  const rcThread = document.getElementById('rcThread');
  const rcNoticeSlot = document.getElementById('rcNoticeSlot');
  const rcComposer = document.getElementById('rcComposer');
  const rcField = document.getElementById('rcField');
  const rcSend = document.getElementById('rcSend');
  const rcImageInput = document.getElementById('rcImageInput');

  /* ================================================================ */
  /* REQUEST HERO + COUNTDOWN                                          */
  /* ================================================================ */

  function renderHero() {
    const img = rfq.productImage || 'https://placehold.co/300x300/F3F4F8/15161A?text=No+Photo';
    const budgetLabel = rfq.budgetType === 'total'
      ? `${money(rfq.minBudget)} - ${money(rfq.maxBudget)} total`
      : `${money(rfq.minBudget)} - ${money(rfq.maxBudget)} / ${esc(rfq.unit)}`;

    document.getElementById('rfqHero').innerHTML = `
      <div class="rfq-detail-hero__img"><img src="${esc(img)}" alt="${esc(rfq.productName)}"></div>
      <div class="rfq-detail-hero__body">
        ${statusPill(rfq.status)}
        <h1>${esc(rfq.productName)}</h1>
        <div class="rfq-detail-hero__meta">
          <span><i class="fa-solid fa-box"></i> ${rfq.quantity} ${esc(rfq.unit)}</span>
          <span><i class="fa-solid fa-money-bill-wave"></i> ${budgetLabel}</span>
          <span><i class="fa-solid fa-location-dot"></i> ${esc(rfq.location)}</span>
          <span><i class="fa-solid fa-calendar"></i> Needed by ${fmtDate(rfq.requiredDate)}</span>
          ${rfq.deliveryRequired ? `<span><i class="fa-solid fa-truck-fast"></i> Delivery required</span>` : ''}
        </div>
        <p class="rfq-detail-hero__desc">${esc(rfq.description)}</p>
      </div>
      <div class="rfq-detail-hero__actions">
        <span class="rfq-countdown" id="rfqCountdown"><i class="fa-regular fa-clock"></i> —</span>
        ${['OPEN', 'BIDDING'].includes(rfq.status) ? `<button class="btn btn-outline btn-sm" id="cancelRfqBtn">Cancel Request</button>` : ''}
        ${rfq.status === 'SELLER_SELECTED' ? `<button class="btn btn-primary btn-sm" id="closeRfqBtn">Mark as Closed</button>` : ''}
      </div>
    `;

    const cancelBtn = document.getElementById('cancelRfqBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', handleCancelRFQ);
    const closeBtn = document.getElementById('closeRfqBtn');
    if (closeBtn) closeBtn.addEventListener('click', handleCloseRFQ);

    startCountdown();
  }

  function startCountdown() {
    const el = document.getElementById('rfqCountdown');
    if (!el) return;
    function tick() {
      const diff = new Date(rfq.expiresAt) - new Date();
      if (diff <= 0) {
        el.innerHTML = `<i class="fa-regular fa-clock"></i> Bidding closed`;
        return;
      }
      const days = Math.floor(diff / 86400000);
      const hrs = Math.floor((diff % 86400000) / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const label = days > 0 ? `${days}d ${hrs}h left` : `${hrs}h ${mins}m left`;
      el.innerHTML = `<i class="fa-regular fa-clock"></i> ${label}`;
      setTimeout(tick, 60000);
    }
    tick();
  }

  async function handleCancelRFQ() {
    if (!confirm('Cancel this request? This cannot be undone.')) return;
    try {
      await SS_API.cancelRFQ(rfqId);
      toast('Request cancelled');
      loadRFQ();
    } catch (err) { toast(err.message || 'Could not cancel request', 'fa-circle-exclamation'); }
  }
  async function handleCloseRFQ() {
    if (!confirm('Mark this request as closed?')) return;
    try {
      await SS_API.closeRFQ(rfqId);
      toast('Request closed');
      loadRFQ();
    } catch (err) { toast(err.message || 'Could not close request', 'fa-circle-exclamation'); }
  }

  async function loadRFQ() {
    try {
      const res = await SS_API.getRFQ(rfqId);
      rfq = res.rfq;
      document.title = `${rfq.productName} | My Request | Six Star Suppliers`;
      renderHero();
      loadSimilarProducts();
    } catch (err) {
      document.getElementById('rfqHero').innerHTML = `<div class="offer-empty" style="width:100%;"><i class="fa-solid fa-triangle-exclamation"></i>${esc(err.message || 'Could not load this request.')}</div>`;
    }
  }

  /* ================================================================ */
  /* OFFERS / BIDS COMPARISON                                          */
  /* ================================================================ */

  function offerCardHTML(offer) {
    const seller = offer.seller || {};
    const canAct = offer.status === 'pending' && rfq && ['OPEN', 'BIDDING'].includes(rfq.status);
    return `
      <div class="offer-card ${offer.status}" data-bid-id="${offer._id}" data-seller-id="${seller.id}">
        ${avatarHTML(seller)}
        <div class="offer-card__main">
          <div class="offer-card__head">
            <span class="offer-card__name">${esc(seller.label || 'Seller')} ${seller.isVerified ? '<i class="fa-solid fa-circle-check verified" title="Verified seller"></i>' : ''}</span>
            <span class="offer-badge-status ${offer.status}">${offer.status}</span>
            <span class="offer-card__time">${timeAgo(offer.createdAt)}</span>
          </div>
          <div class="offer-card__stats">
            <div class="offer-stat"><span class="label">Price</span><span class="value price">${money(offer.unitPrice)}</span></div>
            <div class="offer-stat"><span class="label">Qty avail.</span><span class="value">${offer.quantityAvailable}</span></div>
            <div class="offer-stat"><span class="label">Delivery fee</span><span class="value">${money(offer.deliveryFee)}</span></div>
            ${offer.deliveryTime ? `<div class="offer-stat"><span class="label">Delivery time</span><span class="value">${esc(offer.deliveryTime)}</span></div>` : ''}
            ${offer.offerValidUntil ? `<div class="offer-stat"><span class="label">Valid until</span><span class="value">${fmtDate(offer.offerValidUntil)}</span></div>` : ''}
          </div>
          ${offer.message ? `<div class="offer-card__msg">${esc(offer.message)}</div>` : ''}
        </div>
        <div class="offer-card__actions">
          <button class="btn btn-outline btn-sm offer-msg-btn"><i class="fa-regular fa-comment"></i> Message</button>
          ${canAct ? `<button class="btn btn-primary btn-sm offer-accept-btn"><i class="fa-solid fa-check"></i> Accept</button>` : ''}
        </div>
      </div>`;
  }

  async function loadOffers() {
    const list = document.getElementById('offerList');
    try {
      const res = await SS_API.getRFQOffers(rfqId);
      offers = res.offers || [];
      document.getElementById('offerCountBadge').textContent = offers.length;

      if (!offers.length) {
        list.innerHTML = `<div class="offer-empty"><i class="fa-solid fa-hourglass-half"></i>No offers yet — sellers are being notified. Check back soon.</div>`;
        return;
      }

      list.innerHTML = offers.map(offerCardHTML).join('');

      list.querySelectorAll('.offer-msg-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const card = btn.closest('.offer-card');
          const offer = offers.find((o) => o._id === card.dataset.bidId);
          if (offer) openChatModal(offer.seller);
        });
      });
      list.querySelectorAll('.offer-accept-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const card = btn.closest('.offer-card');
          pendingBidId = card.dataset.bidId;
          document.getElementById('acceptOverlay').classList.add('open');
        });
      });
    } catch (err) {
      list.innerHTML = `<div class="offer-empty"><i class="fa-solid fa-triangle-exclamation"></i>${esc(err.message || 'Could not load offers.')}</div>`;
    }
  }

  document.getElementById('acceptDismiss').addEventListener('click', () => {
    pendingBidId = null;
    document.getElementById('acceptOverlay').classList.remove('open');
  });
  document.getElementById('acceptConfirm').addEventListener('click', async () => {
    if (!pendingBidId) return;
    const btn = document.getElementById('acceptConfirm');
    btn.disabled = true;
    try {
      await SS_API.acceptRFQBid(pendingBidId);
      toast('Seller selected! You can finalize details in chat.', 'fa-circle-check');
      document.getElementById('acceptOverlay').classList.remove('open');
      pendingBidId = null;
      loadRFQ();
      loadOffers();
    } catch (err) {
      toast(err.message || 'Could not select this seller', 'fa-circle-exclamation');
    } finally {
      btn.disabled = false;
    }
  });

  /* ================================================================ */
  /* SIMILAR PRODUCTS                                                   */
  /* ================================================================ */

  async function loadSimilarProducts() {
    const grid = document.getElementById('similarProductsGrid');
    grid.innerHTML = ssSkeletonCards(4);
    try {
      const res = await SS_API.getSimilarRFQProducts({
        productName: rfq.productName,
        category: rfq.category && (rfq.category._id || rfq.category),
        minBudget: rfq.minBudget,
        maxBudget: rfq.maxBudget,
      });
      const products = res.products || [];
      if (!products.length) {
        grid.innerHTML = `<div class="offer-empty" style="grid-column:1/-1;"><i class="fa-solid fa-box-open"></i>No similar products in the marketplace right now — offers on this request are your best bet.</div>`;
        return;
      }
      grid.innerHTML = products.map(ssProductCard).join('');
    } catch (_) {
      grid.innerHTML = '';
    }
  }

  /* ================================================================ */
  /* FULLSCREEN CHAT MODAL                                              */
  /* ================================================================ */

  function dayKey(d) { const x = new Date(d); return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`; }

  function isThreadNearBottom() {
    return rcThread.scrollTop + rcThread.clientHeight >= rcThread.scrollHeight - 140;
  }
  function scrollThreadToBottom(smooth = true) {
    rcThread.scrollTo({ top: rcThread.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    hideJump();
  }
  function showJump() { document.getElementById('rcJump')?.classList.add('show'); }
  function hideJump() { document.getElementById('rcJump')?.classList.remove('show'); }

  function bubbleHTML(msg) {
    const mine = String(msg.sender) === String(user.id || user._id) || String(msg.sender?._id) === String(user.id || user._id);
    const isImage = msg.messageType === 'image';
    const flagLabel = (msg.moderationFlags || []).map((f) => MOD_FLAG_LABEL[f] || 'Hidden for security')[0];
    return `
      <div class="rc-row ${mine ? 'sent' : 'received'}">
        <div class="rc-bubble">
          ${isImage
            ? `<img class="rc-bubble__img" src="${esc(msg.imageUrl)}" alt="Shared photo" data-lightbox="${esc(msg.imageUrl)}" loading="lazy">`
            : `<span>${esc(msg.message)}</span>`}
          ${msg.moderationAction === 'masked' ? `<div class="rc-mod-flag"><i class="fa-solid fa-shield-halved"></i>${esc(flagLabel)}</div>` : ''}
          <div class="rc-bubble__foot"><span>${fmtTime(msg.createdAt)}</span></div>
        </div>
      </div>`;
  }

  function renderThread() {
    if (!messages.length) {
      rcThread.innerHTML = `
        <div class="rc-empty"><i class="fa-regular fa-comments"></i><span>Say hello — ask about specs, availability, or delivery.</span></div>
        <button class="rc-jump" id="rcJump" type="button"><i class="fa-solid fa-arrow-down"></i> New messages</button>`;
      return;
    }
    let html = `<div class="rc-system"><i class="fa-solid fa-lock"></i>Keep all communication on Six Star Suppliers — contact details are automatically hidden.</div>`;
    let lastKey = null;
    messages.forEach((m) => {
      const key = dayKey(m.createdAt);
      if (key !== lastKey) { html += `<div class="rc-daydivider"><span>${dayLabel(m.createdAt)}</span></div>`; lastKey = key; }
      html += bubbleHTML(m);
    });
    html += `<button class="rc-jump" id="rcJump" type="button"><i class="fa-solid fa-arrow-down"></i> New messages</button>`;
    rcThread.innerHTML = html;
  }

  function openChatModal(sellerIdentity) {
    currentCounterpart = sellerIdentity;
    messages = [];
    knownIds = new Set();

    rcNoticeSlot.innerHTML = '';
    rcComposer.classList.toggle('is-disabled', buyerRestricted);
    if (buyerRestricted) {
      rcNoticeSlot.innerHTML = `<div class="rc-restricted-banner"><i class="fa-solid fa-ban"></i><span>Your messaging privileges are currently restricted pending review. Please contact support.</span></div>`;
    }

    rcAvatar.textContent = sellerIdentity.initials || '?';
    rcLabel.innerHTML = `${esc(sellerIdentity.label)} ${sellerIdentity.isVerified ? '<i class="fa-solid fa-badge-check"></i>' : ''}`;
    rcSub.innerHTML = `<i class="fa-solid fa-lock"></i>Private conversation${sellerIdentity.isVerified ? ' · Verified' : ''}`;

    rcThread.innerHTML = `
      <div class="rc-skel-row"><div class="rc-skel-bubble"></div></div>
      <div class="rc-skel-row sent"><div class="rc-skel-bubble" style="width:45%;"></div></div>
      <div class="rc-skel-row"><div class="rc-skel-bubble" style="width:70%;"></div></div>`;

    modalOpen = true;
    rcModalOverlay.classList.add('open');
    document.body.classList.add('rc-modal-lock');

    loadConversation({ initial: true });
    startChatPolling();
    setTimeout(() => rcField.focus({ preventScroll: true }), 260);
  }

  function closeChatModal() {
    modalOpen = false;
    rcModalOverlay.classList.remove('open');
    document.body.classList.remove('rc-modal-lock');
    stopChatPolling();
    currentCounterpart = null;
  }

  rcModalClose.addEventListener('click', closeChatModal);
  rcModalOverlay.addEventListener('click', (e) => { if (e.target === rcModalOverlay) closeChatModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modalOpen) closeChatModal(); });

  rcField.addEventListener('input', () => {
    rcField.style.height = 'auto';
    rcField.style.height = Math.min(rcField.scrollHeight, 96) + 'px';
  });
  rcField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTextMessage(); }
  });
  rcSend.addEventListener('click', sendTextMessage);
  rcImageInput.addEventListener('change', () => {
    const file = rcImageInput.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('Image must be under 5MB', 'fa-circle-exclamation'); rcImageInput.value = ''; return; }
    sendImageMessage(file);
    rcImageInput.value = '';
  });
  rcThread.addEventListener('scroll', () => { if (isThreadNearBottom()) hideJump(); });
  rcThread.addEventListener('click', (e) => {
    const img = e.target.closest('[data-lightbox]');
    if (img) window.open(img.dataset.lightbox, '_blank', 'noopener');
    if (e.target.closest('#rcJump')) scrollThreadToBottom();
  });

  async function loadConversation({ isPoll = false, initial = false } = {}) {
    if (!currentCounterpart) return;
    try {
      const res = await SS_API.getRFQConversation(rfqId, currentCounterpart.id);
      const newMessages = res.messages || [];
      const hasNew = newMessages.some((m) => !knownIds.has(m._id));
      const wasNear = isThreadNearBottom();
      messages = newMessages;
      messages.forEach((m) => knownIds.add(m._id));
      renderThread();
      if (initial) scrollThreadToBottom(false);
      else if (isPoll && hasNew) { if (wasNear) scrollThreadToBottom(); else showJump(); }
    } catch (err) {
      rcThread.innerHTML = `<div class="rc-empty"><i class="fa-solid fa-triangle-exclamation"></i><span>${esc(err.message || 'Could not load this conversation.')}</span></div>`;
    }
  }

  function flashNotice(text, kind) {
    rcNoticeSlot.innerHTML = `<div class="rc-notice ${kind}"><i class="fa-solid fa-shield-halved"></i>${esc(text)}</div>`;
    if (kind === 'warn') setTimeout(() => { rcNoticeSlot.innerHTML = ''; }, 6000);
  }

  function onRestricted(message) {
    buyerRestricted = true;
    rcComposer.classList.add('is-disabled');
    rcNoticeSlot.innerHTML = `<div class="rc-restricted-banner"><i class="fa-solid fa-ban"></i><span>${esc(message || 'Your messaging privileges are currently restricted pending review. Please contact support.')}</span></div>`;
  }

  async function sendTextMessage() {
    if (buyerRestricted) return;
    const text = rcField.value.trim();
    if (!text || !currentCounterpart) return;
    rcSend.disabled = true;
    try {
      const res = await SS_API.sendRFQMessage(rfqId, { receiverId: currentCounterpart.id, message: text });
      rcField.value = '';
      rcField.style.height = 'auto';
      messages.push(res.message);
      knownIds.add(res.message._id);
      renderThread();
      scrollThreadToBottom();
      if (res.notice) flashNotice(res.notice, 'warn');
    } catch (err) {
      if (err.status === 403) onRestricted(err.message);
      else toast(err.message || 'Could not send message', 'fa-circle-exclamation');
    } finally {
      rcSend.disabled = false;
    }
  }

  async function sendImageMessage(file) {
    if (buyerRestricted || !currentCounterpart) return;
    const fd = new FormData();
    fd.append('receiverId', currentCounterpart.id);
    fd.append('image', file);
    try {
      const res = await SS_API.sendRFQMessage(rfqId, fd, true);
      messages.push(res.message);
      knownIds.add(res.message._id);
      renderThread();
      scrollThreadToBottom();
    } catch (err) {
      if (err.status === 403) onRestricted(err.message);
      else toast(err.message || 'Could not send photo', 'fa-circle-exclamation');
    }
  }

  function startChatPolling() {
    stopChatPolling();
    chatPollTimer = setInterval(() => { if (modalOpen && currentCounterpart) loadConversation({ isPoll: true }); }, 7000);
  }
  function stopChatPolling() {
    if (chatPollTimer) clearInterval(chatPollTimer);
    chatPollTimer = null;
  }
  window.addEventListener('beforeunload', stopChatPolling);
  document.addEventListener('visibilitychange', () => {
    if (!modalOpen) return;
    if (document.hidden) stopChatPolling();
    else { loadConversation({ isPoll: true }); startChatPolling(); }
  });

  /* ================================================================ */
  /* INIT                                                                */
  /* ================================================================ */
  loadRFQ().then(loadOffers);
})();