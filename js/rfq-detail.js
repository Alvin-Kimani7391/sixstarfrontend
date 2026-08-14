/* ============================================================
   RFQ-DETAIL.JS
   Powers rfq-detail.html: request summary + countdown, the
   offers/bids comparison list, a real chat-app-style private
   conversation panel (text + image, moderation-aware), and a
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
  let currentCounterpart = null; // { id, label, initials, isVerified, ... } of the seller currently open in chat
  let chatPollTimer = null;
  let pendingBidId = null;
  let pendingImageFile = null;

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
          if (offer) openChat(offer.seller);
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
  /* CHAT PANEL                                                         */
  /* ================================================================ */

  function chatShellHTML(counterpart) {
    return `
      <div class="chat-header">
        <button class="chat-header__close" id="chatBackBtn" title="Back" style="order:-1;"><i class="fa-solid fa-arrow-left"></i></button>
        ${avatarHTML(counterpart)}
        <div class="chat-header__info">
          <div class="chat-header__name">${esc(counterpart.label)} ${counterpart.isVerified ? '<i class="fa-solid fa-circle-check verified"></i>' : ''}</div>
          <div class="chat-header__sub">${esc(rfq.productName)}</div>
        </div>
        <button class="chat-header__close" id="chatCloseBtn" title="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div id="chatModerationNotice"></div>
      <div id="chatRestrictedBanner"></div>
      <div class="chat-messages" id="chatMessages"></div>
      <div id="chatImagePreviewBar"></div>
      <div class="chat-input-bar" id="chatInputBar">
        <label class="chat-attach-btn" title="Attach a photo">
          <i class="fa-solid fa-paperclip"></i>
          <input type="file" id="chatImageInput" accept="image/*">
        </label>
        <textarea id="chatTextInput" placeholder="Type a message..." rows="1"></textarea>
        <button class="chat-send-btn" id="chatSendBtn" title="Send"><i class="fa-solid fa-paper-plane"></i></button>
      </div>
    `;
  }

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
    const container = document.getElementById('chatMessages');
    if (!container) return;
    if (!messages.length) {
      container.innerHTML = `<div class="chat-panel__placeholder" style="height:100%;"><i class="fa-regular fa-comment-dots"></i><p>Say hello — ask about specs, availability, or delivery.</p></div>`;
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
    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
  }

  async function openChat(sellerIdentity) {
    currentCounterpart = sellerIdentity;
    const panel = document.getElementById('chatPanel');
    panel.innerHTML = chatShellHTML(sellerIdentity);
    panel.classList.add('mobile-open');
    document.body.style.overflow = window.innerWidth < 960 ? 'hidden' : '';

    document.getElementById('chatCloseBtn').addEventListener('click', closeChat);
    document.getElementById('chatBackBtn').addEventListener('click', closeChat);

    const textInput = document.getElementById('chatTextInput');
    const sendBtn = document.getElementById('chatSendBtn');
    const imageInput = document.getElementById('chatImageInput');

    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTextMessage(); }
    });
    textInput.addEventListener('input', () => {
      textInput.style.height = 'auto';
      textInput.style.height = Math.min(textInput.scrollHeight, 90) + 'px';
    });
    sendBtn.addEventListener('click', () => {
      if (pendingImageFile) sendImageMessage(); else sendTextMessage();
    });
    imageInput.addEventListener('change', () => {
      const file = imageInput.files[0];
      if (!file) return;
      if (file.size > 3 * 1024 * 1024) { toast('Image must be under 3MB', 'fa-circle-exclamation'); imageInput.value = ''; return; }
      pendingImageFile = file;
      const reader = new FileReader();
      reader.onload = (e) => {
        document.getElementById('chatImagePreviewBar').innerHTML = `
          <div class="chat-image-preview-bar">
            <img src="${e.target.result}">
            <span>Photo ready to send</span>
            <button id="cancelImageBtn"><i class="fa-solid fa-xmark"></i></button>
          </div>`;
        document.getElementById('cancelImageBtn').addEventListener('click', () => {
          pendingImageFile = null;
          imageInput.value = '';
          document.getElementById('chatImagePreviewBar').innerHTML = '';
        });
      };
      reader.readAsDataURL(file);
    });

    await loadConversation();
    startChatPolling();
  }

  function closeChat() {
    stopChatPolling();
    currentCounterpart = null;
    pendingImageFile = null;
    document.body.style.overflow = '';
    const panel = document.getElementById('chatPanel');
    panel.classList.remove('mobile-open');
    panel.innerHTML = `
      <div class="chat-panel__placeholder">
        <i class="fa-regular fa-comments"></i>
        <p>Select "Message" on an offer to start a private conversation with that seller.</p>
      </div>`;
  }

  async function loadConversation() {
    try {
      const res = await SS_API.getRFQConversation(rfqId, currentCounterpart.id);
      renderMessages(res.messages || []);
      const banner = document.getElementById('chatRestrictedBanner');
      if (banner) banner.innerHTML = '';
    } catch (err) {
      const banner = document.getElementById('chatRestrictedBanner');
      if (banner) banner.innerHTML = `<div class="chat-restricted-banner"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(err.message || 'Could not load this conversation.')}</div>`;
    }
  }

  function showModerationNotice(text) {
    const el = document.getElementById('chatModerationNotice');
    if (!el) return;
    el.innerHTML = `<div class="chat-moderation-notice"><i class="fa-solid fa-shield-halved"></i> ${esc(text)}</div>`;
    setTimeout(() => { if (el) el.innerHTML = ''; }, 6000);
  }

  function disableChatInput(message) {
    const bar = document.getElementById('chatInputBar');
    const banner = document.getElementById('chatRestrictedBanner');
    if (bar) bar.style.display = 'none';
    if (banner) banner.innerHTML = `<div class="chat-restricted-banner"><i class="fa-solid fa-ban"></i> ${esc(message)}</div>`;
  }

  async function sendTextMessage() {
    const textInput = document.getElementById('chatTextInput');
    const text = textInput.value.trim();
    if (!text) return;
    const sendBtn = document.getElementById('chatSendBtn');
    sendBtn.disabled = true;
    try {
      const res = await SS_API.sendRFQMessage(rfqId, { receiverId: currentCounterpart.id, message: text });
      textInput.value = '';
      textInput.style.height = 'auto';
      appendMessage(res.message);
      if (res.notice) showModerationNotice(res.notice);
    } catch (err) {
      if (err.status === 403) {
        disableChatInput(err.message || 'Your messaging privileges are currently restricted.');
      } else {
        toast(err.message || 'Could not send message', 'fa-circle-exclamation');
      }
    } finally {
      sendBtn.disabled = false;
    }
  }

  async function sendImageMessage() {
    if (!pendingImageFile) return;
    const sendBtn = document.getElementById('chatSendBtn');
    sendBtn.disabled = true;
    const fd = new FormData();
    fd.append('receiverId', currentCounterpart.id);
    fd.append('image', pendingImageFile);
    try {
      const res = await SS_API.sendRFQMessage(rfqId, fd, true);
      pendingImageFile = null;
      document.getElementById('chatImagePreviewBar').innerHTML = '';
      document.getElementById('chatImageInput').value = '';
      appendMessage(res.message);
    } catch (err) {
      if (err.status === 403) {
        disableChatInput(err.message || 'Your messaging privileges are currently restricted.');
      } else {
        toast(err.message || 'Could not send photo', 'fa-circle-exclamation');
      }
    } finally {
      sendBtn.disabled = false;
    }
  }

  function appendMessage(msg) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const placeholder = container.querySelector('.chat-panel__placeholder');
    if (placeholder) container.innerHTML = '';
    const dividers = container.querySelectorAll('.chat-day-divider');
    const lastDivider = dividers.length ? dividers[dividers.length - 1] : null;
    const today = dayLabel(msg.createdAt);
    if (!lastDivider || lastDivider.textContent !== today) {
      container.insertAdjacentHTML('beforeend', `<div class="chat-day-divider">${today}</div>`);
    }
    container.insertAdjacentHTML('beforeend', messageRowHTML(msg, true));
    container.scrollTop = container.scrollHeight;
  }

  function startChatPolling() {
    stopChatPolling();
    chatPollTimer = setInterval(() => { if (currentCounterpart) loadConversation(); }, 7000);
  }
  function stopChatPolling() {
    if (chatPollTimer) clearInterval(chatPollTimer);
    chatPollTimer = null;
  }
  window.addEventListener('beforeunload', stopChatPolling);

  /* ================================================================ */
  /* INIT                                                                */
  /* ================================================================ */
  loadRFQ().then(loadOffers);
})();