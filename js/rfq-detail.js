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

  let rfq = null;
  let offers = [];
  let currentCounterpart = null; // { id, label, initials, isVerified, ... } of whichever seller's chat is open
  let chatPollTimer = null;
  let pendingBidId = null;
  let pendingImageFile = null;
  let modalOpen = false;

  /* ---------------- static modal elements (bound once) ---------------- */
  const rcModalOverlay = document.getElementById('rcModalOverlay');
  const rcModalClose = document.getElementById('rcModalClose');
  const rcAvatar = document.getElementById('rcAvatar');
  const rcLabel = document.getElementById('rcLabel');
  const rcSub = document.getElementById('rcSub');
  const chatMessagesEl = document.getElementById('chatMessages');
  const chatModerationNoticeEl = document.getElementById('chatModerationNotice');
  const chatRestrictedBannerEl = document.getElementById('chatRestrictedBanner');
  const chatImagePreviewBarEl = document.getElementById('chatImagePreviewBar');
  const chatInputBarEl = document.getElementById('chatInputBar');
  const chatTextInput = document.getElementById('chatTextInput');
  const chatSendBtn = document.getElementById('chatSendBtn');
  const chatImageInput = document.getElementById('chatImageInput');

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

  function messageRowHTML(msg, isMine) {
    let bubbleInner;
    if (msg.messageType === 'image') {
      bubbleInner = `<img src="${esc(msg.imageUrl)}" alt="Photo" onclick="window.open('${esc(msg.imageUrl)}','_blank')">`;
    } else if (msg.moderationAction === 'masked') {
      bubbleInner = `<i class="fa-solid fa-shield-halved"></i>${esc(msg.message)}`;
    } else {
      bubbleInner = esc(msg.message);
    }
    const bubbleClass = msg.moderationAction === 'masked' ? 'chat-bubble masked' : 'chat-bubble';
    return `
      <div class="chat-row ${isMine ? 'mine' : ''}">
        ${!isMine ? avatarHTML(currentCounterpart, 'rfq-avatar--sm') : ''}
        <div>
          <div class="${bubbleClass}">${bubbleInner}</div>
        </div>
      </div>
      <div class="chat-meta-row ${isMine ? 'mine' : ''}">${fmtTime(msg.createdAt)}</div>
    `;
  }

  function renderMessages(messages) {
    if (!messages.length) {
      chatMessagesEl.innerHTML = `<div class="chat-panel__placeholder" style="height:100%;"><i class="fa-regular fa-comment-dots"></i><p>Say hello — ask about specs, availability, or delivery.</p></div>`;
      return;
    }
    let html = '';
    let lastDay = null;
    messages.forEach((m) => {
      const day = dayLabel(m.createdAt);
      if (day !== lastDay) {
        html += `<div class="chat-day-divider">${day}</div>`;
        lastDay = day;
      }
      html += messageRowHTML(m, String(m.sender) === String(user.id || user._id));
    });
    chatMessagesEl.innerHTML = html;
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  function openChatModal(sellerIdentity) {
    currentCounterpart = sellerIdentity;
    pendingImageFile = null;

    // reset composer / notice state for this conversation
    chatImagePreviewBarEl.innerHTML = '';
    chatImageInput.value = '';
    chatModerationNoticeEl.innerHTML = '';
    chatRestrictedBannerEl.innerHTML = '';
    chatInputBarEl.style.display = 'flex';
    chatTextInput.value = '';
    chatTextInput.style.height = 'auto';
    chatMessagesEl.innerHTML = `<div class="chat-panel__placeholder" style="height:100%;"><i class="fa-solid fa-spinner fa-spin"></i></div>`;

    rcAvatar.textContent = sellerIdentity.initials || '?';
    rcAvatar.dataset.hue = hashHue(sellerIdentity.label || sellerIdentity.initials);
    rcLabel.innerHTML = `${esc(sellerIdentity.label)} ${sellerIdentity.isVerified ? '<i class="fa-solid fa-circle-check verified"></i>' : ''}`;
    rcSub.textContent = rfq ? rfq.productName : '';

    modalOpen = true;
    rcModalOverlay.classList.add('open');
    document.body.classList.add('rc-modal-lock');

    loadConversation();
    startChatPolling();
    setTimeout(() => chatTextInput.focus({ preventScroll: true }), 260);
  }

  function closeChatModal() {
    modalOpen = false;
    rcModalOverlay.classList.remove('open');
    document.body.classList.remove('rc-modal-lock');
    stopChatPolling();
    currentCounterpart = null;
    pendingImageFile = null;
  }

  rcModalClose.addEventListener('click', closeChatModal);
  rcModalOverlay.addEventListener('click', (e) => { if (e.target === rcModalOverlay) closeChatModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modalOpen) closeChatModal(); });

  // composer listeners — bound once, since the modal markup is static
  chatTextInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTextMessage(); }
  });
  chatTextInput.addEventListener('input', () => {
    chatTextInput.style.height = 'auto';
    chatTextInput.style.height = Math.min(chatTextInput.scrollHeight, 90) + 'px';
  });
  chatSendBtn.addEventListener('click', () => {
    if (pendingImageFile) sendImageMessage(); else sendTextMessage();
  });
  chatImageInput.addEventListener('change', () => {
    const file = chatImageInput.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { toast('Image must be under 3MB', 'fa-circle-exclamation'); chatImageInput.value = ''; return; }
    pendingImageFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
      chatImagePreviewBarEl.innerHTML = `
        <div class="chat-image-preview-bar">
          <img src="${e.target.result}">
          <span>Photo ready to send</span>
          <button id="cancelImageBtn"><i class="fa-solid fa-xmark"></i></button>
        </div>`;
      document.getElementById('cancelImageBtn').addEventListener('click', () => {
        pendingImageFile = null;
        chatImageInput.value = '';
        chatImagePreviewBarEl.innerHTML = '';
      });
    };
    reader.readAsDataURL(file);
  });

  async function loadConversation() {
    if (!currentCounterpart) return;
    try {
      const res = await SS_API.getRFQConversation(rfqId, currentCounterpart.id);
      renderMessages(res.messages || []);
      chatRestrictedBannerEl.innerHTML = '';
    } catch (err) {
      chatRestrictedBannerEl.innerHTML = `<div class="chat-restricted-banner"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(err.message || 'Could not load this conversation.')}</div>`;
    }
  }

  function showModerationNotice(text) {
    chatModerationNoticeEl.innerHTML = `<div class="chat-moderation-notice"><i class="fa-solid fa-shield-halved"></i> ${esc(text)}</div>`;
    setTimeout(() => { chatModerationNoticeEl.innerHTML = ''; }, 6000);
  }

  function disableChatInput(message) {
    chatInputBarEl.style.display = 'none';
    chatRestrictedBannerEl.innerHTML = `<div class="chat-restricted-banner"><i class="fa-solid fa-ban"></i> ${esc(message)}</div>`;
  }

  async function sendTextMessage() {
    const text = chatTextInput.value.trim();
    if (!text || !currentCounterpart) return;
    chatSendBtn.disabled = true;
    try {
      const res = await SS_API.sendRFQMessage(rfqId, { receiverId: currentCounterpart.id, message: text });
      chatTextInput.value = '';
      chatTextInput.style.height = 'auto';
      appendMessage(res.message);
      if (res.notice) showModerationNotice(res.notice);
    } catch (err) {
      if (err.status === 403) {
        disableChatInput(err.message || 'Your messaging privileges are currently restricted.');
      } else {
        toast(err.message || 'Could not send message', 'fa-circle-exclamation');
      }
    } finally {
      chatSendBtn.disabled = false;
    }
  }

  async function sendImageMessage() {
    if (!pendingImageFile || !currentCounterpart) return;
    chatSendBtn.disabled = true;
    const fd = new FormData();
    fd.append('receiverId', currentCounterpart.id);
    fd.append('image', pendingImageFile);
    try {
      const res = await SS_API.sendRFQMessage(rfqId, fd, true);
      pendingImageFile = null;
      chatImagePreviewBarEl.innerHTML = '';
      chatImageInput.value = '';
      appendMessage(res.message);
    } catch (err) {
      if (err.status === 403) {
        disableChatInput(err.message || 'Your messaging privileges are currently restricted.');
      } else {
        toast(err.message || 'Could not send photo', 'fa-circle-exclamation');
      }
    } finally {
      chatSendBtn.disabled = false;
    }
  }

  function appendMessage(msg) {
    const placeholder = chatMessagesEl.querySelector('.chat-panel__placeholder');
    if (placeholder) chatMessagesEl.innerHTML = '';
    const dividers = chatMessagesEl.querySelectorAll('.chat-day-divider');
    const lastDivider = dividers.length ? dividers[dividers.length - 1] : null;
    const today = dayLabel(msg.createdAt);
    if (!lastDivider || lastDivider.textContent !== today) {
      chatMessagesEl.insertAdjacentHTML('beforeend', `<div class="chat-day-divider">${today}</div>`);
    }
    chatMessagesEl.insertAdjacentHTML('beforeend', messageRowHTML(msg, true));
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  function startChatPolling() {
    stopChatPolling();
    chatPollTimer = setInterval(() => { if (modalOpen && currentCounterpart) loadConversation(); }, 7000);
  }
  function stopChatPolling() {
    if (chatPollTimer) clearInterval(chatPollTimer);
    chatPollTimer = null;
  }
  window.addEventListener('beforeunload', stopChatPolling);
  document.addEventListener('visibilitychange', () => {
    if (!modalOpen) return;
    if (document.hidden) stopChatPolling();
    else { loadConversation(); startChatPolling(); }
  });

  /* ================================================================ */
  /* INIT                                                                */
  /* ================================================================ */
  loadRFQ().then(loadOffers);
})();