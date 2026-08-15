/* ============================================================
   SELLER-RFQ-DETAIL.JS
   Bid form (create / update / withdraw) plus a private chat with
   the buyer, unlocked once this seller has a bid on the RFQ. Chat
   opens as a fullscreen modal (like a real messaging app) from a
   compact "launcher card" in the sidebar — closed with the X in
   the top-right, backdrop click, or Escape.

   Moderation is handled at every boundary: bid submission and
   chat sends can come back masked (saved, with a `notice`) or
   blocked (403 — nothing saved, seller is now restricted). Once
   restricted, the composer disables itself with a persistent
   banner instead of silently failing on every keystroke.
   ============================================================ */
(async () => {
  const user = await SS_AUTH.requireRole(["wholesaler", "retailer"]);
  if (!user) return;

  function hideLoader() {
    const loader = document.getElementById("pageLoader");
    if (loader) { loader.classList.add("hide"); loader.style.display = "none"; }
  }

  function escapeHtml(str = "") {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }
  function money(n) { return "KES " + Number(n || 0).toLocaleString(); }
  function fmtDate(d) {
    return d ? new Date(d).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }) : "—";
  }
  function fmtTime(d) {
    return d ? new Date(d).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", hour12: false }) : "";
  }
  function dayKey(d) { const x = new Date(d); return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`; }
  function dayLabel(d) {
    const x = new Date(d), now = new Date();
    const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (same(x, now)) return "Today";
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (same(x, y)) return "Yesterday";
    return x.toLocaleDateString("en-KE", { day: "numeric", month: "long", year: x.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
  }

  const STATUS_LABEL = {
    OPEN: "Open", BIDDING: "Receiving Offers", SELLER_SELECTED: "Seller Selected",
    CLOSED: "Closed", EXPIRED: "Expired", CANCELLED: "Cancelled",
  };
  function statusPill(status) {
    return `<span class="rfq-status rfq-status--${status.toLowerCase()}">${STATUS_LABEL[status] || status}</span>`;
  }

  const MOD_FLAG_LABEL = {
    phone_number: "Phone number hidden", email_address: "Email hidden", whatsapp: "WhatsApp mention hidden",
    telegram: "Telegram mention hidden", social_handle: "Social handle hidden",
    external_payment: "Payment detail hidden", external_link: "Link hidden",
  };

  /* ---------------- url + elements ---------------- */
  const params = new URLSearchParams(window.location.search);
  const rfqId = params.get("id");
  if (!rfqId) { window.location.href = "seller-rfq.html"; return; }

  const heroEl = document.getElementById("rfqHero");
  const existingBidNoteEl = document.getElementById("existingBidNote");
  const offerRecapWrapEl = document.getElementById("offerRecapWrap");
  const bidForm = document.getElementById("bidForm");
  const bidUnitPrice = document.getElementById("bidUnitPrice");
  const bidQuantity = document.getElementById("bidQuantity");
  const bidDeliveryFee = document.getElementById("bidDeliveryFee");
  const bidDeliveryTime = document.getElementById("bidDeliveryTime");
  const bidValidUntil = document.getElementById("bidValidUntil");
  const bidMessage = document.getElementById("bidMessage");
  const bidFormError = document.getElementById("bidFormError");
  const bidSubmitBtn = document.getElementById("bidSubmitBtn");
  const bidWithdrawBtn = document.getElementById("bidWithdrawBtn");
  const bidMessageBtn = document.getElementById("bidMessageBtn");
  const chatPanel = document.getElementById("chatPanel");
  const withdrawOverlay = document.getElementById("withdrawOverlay");

  // Modal elements — static in the HTML
  const rcModalOverlay = document.getElementById("rcModalOverlay");
  const rcModal = document.getElementById("rcModal");
  const rcModalClose = document.getElementById("rcModalClose");
  const rcAvatar = document.getElementById("rcAvatar");
  const rcLabel = document.getElementById("rcLabel");
  const rcSub = document.getElementById("rcSub");
  const rcThread = document.getElementById("rcThread");
  const rcNoticeSlot = document.getElementById("rcNoticeSlot");
  const rcComposer = document.getElementById("rcComposer");
  const rcField = document.getElementById("rcField");
  const rcSend = document.getElementById("rcSend");
  const rcImageInput = document.getElementById("rcImageInput");

  /* ---------------- state ---------------- */
  let rfq = null;
  let myBid = null;
  let buyerIdentity = null;
  let messages = [];
  let knownIds = new Set();
  let pollTimer = null;
  let chatReady = false;     // buyer identity resolved, launcher rendered, listeners bound
  let modalOpen = false;
  let conversationLoaded = false;
  let sellerRestricted = false;
  let firstOpenThisSession = true;

  function showFormError(msg) {
    bidFormError.textContent = msg;
    bidFormError.classList.add("show");
    bidFormError.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function clearFormError() {
    bidFormError.classList.remove("show");
    bidFormError.textContent = "";
  }

  /* ============================================================
     RFQ HERO
     ============================================================ */
  function renderHero() {
    heroEl.parentElement.querySelectorAll(".rfq-select-banner").forEach((b) => b.remove());
    const img = rfq.productImage || "https://placehold.co/200x200/E4D6BD/5B564C?text=%20";
    heroEl.innerHTML = `
      <div class="rfq-detail-hero__img"><img src="${escapeHtml(img)}" alt="${escapeHtml(rfq.productName)}"></div>
      <div class="rfq-detail-hero__body">
        <div class="rfq-detail-hero__title-row">
          <div class="rfq-detail-hero__title">${escapeHtml(rfq.productName)}</div>
          ${statusPill(rfq.status)}
        </div>
        <div class="rfq-detail-hero__meta">
          <span><i class="fa-solid fa-box"></i>${rfq.quantity} ${escapeHtml(rfq.unit)}</span>
          <span><i class="fa-solid fa-location-dot"></i>${escapeHtml(rfq.location)}</span>
          <span><i class="fa-solid fa-calendar"></i>Required by ${fmtDate(rfq.requiredDate)}</span>
          <span><i class="fa-solid fa-users"></i>${rfq.bidCount || 0} offer${rfq.bidCount === 1 ? "" : "s"}</span>
        </div>
        <div class="rfq-detail-hero__budget">${money(rfq.minBudget)} – ${money(rfq.maxBudget)}${rfq.budgetType === "total" ? " total" : "/unit"}</div>
        <div class="rfq-detail-hero__desc">${escapeHtml(rfq.description)}</div>
      </div>`;

    let banner = "";
    if (myBid?.status === "accepted") {
      banner = `<div class="rfq-select-banner accepted"><i class="fa-solid fa-circle-check"></i>You've been selected for this request. Coordinate delivery details in the chat.</div>`;
    } else if (myBid?.status === "rejected") {
      banner = `<div class="rfq-select-banner rejected"><i class="fa-solid fa-circle-xmark"></i>The buyer selected another seller for this request.</div>`;
    } else if (["CLOSED", "EXPIRED", "CANCELLED"].includes(rfq.status) && myBid?.status === "pending") {
      banner = `<div class="rfq-select-banner closed"><i class="fa-solid fa-box-archive"></i>This request is no longer active.</div>`;
    }
    if (banner) heroEl.insertAdjacentHTML("afterend", banner);
  }

  /* ============================================================
     BID FORM — create / update / withdraw
     ============================================================ */
  function canBid() {
    return ["OPEN", "BIDDING"].includes(rfq.status);
  }

  function fillFormFromBid() {
    bidUnitPrice.value = myBid.unitPrice ?? "";
    bidQuantity.value = myBid.quantityAvailable ?? "";
    bidDeliveryFee.value = myBid.deliveryFee ?? "";
    bidDeliveryTime.value = myBid.deliveryTime ?? "";
    bidValidUntil.value = myBid.offerValidUntil ? new Date(myBid.offerValidUntil).toISOString().slice(0, 10) : "";
    bidMessage.value = myBid.message ?? "";
  }

  function renderBidFormState() {
    existingBidNoteEl.innerHTML = "";
    offerRecapWrapEl.innerHTML = "";
    bidWithdrawBtn.style.display = "none";
    bidMessageBtn.style.display = "none";

    if (myBid && myBid.status !== "withdrawn") {
      existingBidNoteEl.innerHTML = `
        <div class="existing-bid-note"><i class="fa-solid fa-circle-info"></i>
          You already have an offer on this request — editing below updates it.
        </div>`;
      offerRecapWrapEl.innerHTML = `
        <div class="offer-recap">
          <div>Your price <b>${money(myBid.unitPrice)}</b></div>
          <div>Qty available <b>${myBid.quantityAvailable}</b></div>
          <div>Delivery fee <b>${money(myBid.deliveryFee || 0)}</b></div>
          <div>Status <b>${escapeHtml(myBid.status)}</b></div>
          ${myBid.messageFlagged ? `<div class="mod-flag"><i class="fa-solid fa-shield-halved"></i>Your message was auto-masked for contact info before saving.</div>` : ""}
        </div>`;
      fillFormFromBid();
      bidSubmitBtn.innerHTML = '<i class="fa-solid fa-pen"></i> Update Offer';
      if (myBid.status === "pending") bidWithdrawBtn.style.display = "inline-flex";
      if (myBid.status !== "withdrawn") bidMessageBtn.style.display = "inline-flex";
    } else {
      bidSubmitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Offer';
    }

    const biddingClosed = !canBid();
    bidForm.querySelectorAll("input, textarea").forEach((el) => { el.disabled = biddingClosed; });
    bidSubmitBtn.disabled = biddingClosed;
    if (biddingClosed && !myBid) showFormError("This request is no longer accepting offers.");
  }

  bidForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFormError();

    const payload = {
      unitPrice: Number(bidUnitPrice.value),
      quantityAvailable: Number(bidQuantity.value),
      deliveryFee: Number(bidDeliveryFee.value || 0),
      deliveryTime: bidDeliveryTime.value.trim(),
      offerValidUntil: bidValidUntil.value || undefined,
      message: bidMessage.value.trim(),
    };
    if (!payload.unitPrice || !payload.quantityAvailable) {
      showFormError("Unit price and quantity available are required.");
      return;
    }

    bidSubmitBtn.disabled = true;
    const origHtml = bidSubmitBtn.innerHTML;
    bidSubmitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting...';

    try {
      const { bid, notice } = await SS_API.submitOrUpdateBid(rfqId, payload);
      myBid = bid;
      ssToast(notice || "Offer submitted", notice ? "fa-shield-halved" : "fa-circle-check");
      renderBidFormState();
      await loadRFQ();
      await bootChatIfReady();
    } catch (err) {
      if (err.status === 403) onRestricted(err.message);
      showFormError(err.message || "Could not submit your offer. Please try again.");
    } finally {
      bidSubmitBtn.disabled = !canBid();
      bidSubmitBtn.innerHTML = origHtml;
    }
  });

  bidWithdrawBtn.addEventListener("click", () => withdrawOverlay.classList.add("open"));
  document.getElementById("withdrawDismiss").addEventListener("click", () => withdrawOverlay.classList.remove("open"));
  document.getElementById("withdrawConfirm").addEventListener("click", async () => {
    const btn = document.getElementById("withdrawConfirm");
    btn.disabled = true;
    try {
      const { bid } = await SS_API.withdrawBid(myBid._id);
      myBid = bid;
      withdrawOverlay.classList.remove("open");
      ssToast("Offer withdrawn", "fa-circle-check");
      bidForm.reset();
      renderBidFormState();
    } catch (err) {
      ssToast(err.message || "Could not withdraw this offer", "fa-triangle-exclamation");
    } finally {
      btn.disabled = false;
    }
  });

  bidMessageBtn.addEventListener("click", openChatModal);

  /* ============================================================
     CHAT LAUNCHER CARD (sidebar)
     ============================================================ */
  function renderLauncher() {
    if (!chatPanel || !buyerIdentity) return;
    chatPanel.innerHTML = `
      <div class="chat-launcher__card">
        <div class="chat-launcher__avatar">${escapeHtml(buyerIdentity.initials || "B")}</div>
        <div class="chat-launcher__body">
          <div class="chat-launcher__label">${escapeHtml(buyerIdentity.label)}</div>
          <div class="chat-launcher__sub"><i class="fa-solid fa-lock"></i>Private conversation${buyerIdentity.isVerified ? ' · <i class="fa-solid fa-badge-check"></i> Verified' : ""}</div>
        </div>
        <button class="btn btn-primary btn-sm chat-launcher__open" id="chatLauncherOpen" type="button">
          <i class="fa-regular fa-comments"></i> Open Chat
        </button>
      </div>`;
    document.getElementById("chatLauncherOpen").addEventListener("click", openChatModal);
  }

  /* ============================================================
     FULLSCREEN CHAT MODAL
     ============================================================ */
  function openChatModal() {
    if (!chatReady) return;
    modalOpen = true;
    rcModalOverlay.classList.add("open");
    document.body.classList.add("rc-modal-lock");
    if (firstOpenThisSession || !conversationLoaded) {
      firstOpenThisSession = false;
      loadConversation({ initial: true });
    }
    startChatPolling();
    setTimeout(() => rcField.focus({ preventScroll: true }), 260);
  }

  function closeChatModal() {
    modalOpen = false;
    rcModalOverlay.classList.remove("open");
    document.body.classList.remove("rc-modal-lock");
    stopChatPolling();
  }

  rcModalClose.addEventListener("click", closeChatModal);
  rcModalOverlay.addEventListener("click", (e) => { if (e.target === rcModalOverlay) closeChatModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modalOpen) closeChatModal(); });

  async function bootChatIfReady() {
    if (chatReady) return;
    if (!myBid) return; // needs a bid on record before the buyer-identity endpoint will resolve

    try {
      const res = await SS_API.getBuyerIdentity(rfqId);
      buyerIdentity = res.buyer;
    } catch (err) {
      return; // will retry next time a bid is submitted/updated
    }

    chatReady = true;
    renderLauncher();

    rcAvatar.textContent = buyerIdentity.initials || "B";
    rcLabel.textContent = buyerIdentity.label;
    rcSub.innerHTML = `<i class="fa-solid fa-lock"></i>Private conversation${buyerIdentity.isVerified ? ' <span class="rc-head__verified">· <i class="fa-solid fa-badge-check"></i> Verified</span>' : ""}`;

    // Bind composer listeners once
    rcField.addEventListener("input", () => {
      rcField.style.height = "auto";
      rcField.style.height = Math.min(rcField.scrollHeight, 96) + "px";
    });
    rcField.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
    });
    rcSend.addEventListener("click", handleSend);
    rcImageInput.addEventListener("change", () => {
      const file = rcImageInput.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        ssToast("Image must be under 5MB", "fa-circle-exclamation");
        rcImageInput.value = "";
        return;
      }
      sendImageFile(file);
      rcImageInput.value = "";
    });
    rcThread.addEventListener("scroll", () => {
      if (isThreadNearBottom()) hideJump();
    });
    rcThread.addEventListener("click", (e) => {
      const img = e.target.closest("[data-lightbox]");
      if (img) window.open(img.dataset.lightbox, "_blank", "noopener");
      const jump = e.target.closest("#rcJump");
      if (jump) scrollThreadToBottom();
    });
  }

  function isThreadNearBottom() {
    return rcThread.scrollTop + rcThread.clientHeight >= rcThread.scrollHeight - 140;
  }
  function scrollThreadToBottom(smooth = true) {
    rcThread.scrollTo({ top: rcThread.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    hideJump();
  }
  function showJump() { document.getElementById("rcJump")?.classList.add("show"); }
  function hideJump() { document.getElementById("rcJump")?.classList.remove("show"); }

  function bubbleHTML(msg) {
    const mine = String(msg.sender) === String(user._id) || String(msg.sender?._id) === String(user._id);
    const isImage = msg.messageType === "image";
    const flagLabel = (msg.moderationFlags || []).map((f) => MOD_FLAG_LABEL[f] || "Hidden for security")[0];
    return `
      <div class="rc-row ${mine ? "sent" : "received"}">
        <div class="rc-bubble">
          ${isImage
            ? `<img class="rc-bubble__img" src="${escapeHtml(msg.imageUrl)}" alt="Shared photo" data-lightbox="${escapeHtml(msg.imageUrl)}" loading="lazy">`
            : `<span>${escapeHtml(msg.message)}</span>`}
          ${msg.moderationAction === "masked" ? `<div class="rc-mod-flag"><i class="fa-solid fa-shield-halved"></i>${escapeHtml(flagLabel)}</div>` : ""}
          <div class="rc-bubble__foot">
            <span>${fmtTime(msg.createdAt)}</span>
            ${mine ? `<i class="fa-solid fa-check${msg.read ? "-double read" : ""}"></i>` : ""}
          </div>
        </div>
      </div>`;
  }

  function renderThread() {
    if (!messages.length) {
      rcThread.innerHTML = `
        <div class="rc-empty"><i class="fa-regular fa-comments"></i><span>No messages yet — say hello and introduce your offer.</span></div>
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

  async function loadConversation({ isPoll = false, initial = false } = {}) {
    if (!buyerIdentity) return;
    if (initial) {
      rcThread.innerHTML = `
        <div class="rc-skel-row"><div class="rc-skel-bubble"></div></div>
        <div class="rc-skel-row sent"><div class="rc-skel-bubble" style="width:45%;"></div></div>
        <div class="rc-skel-row"><div class="rc-skel-bubble" style="width:70%;"></div></div>`;
    }
    try {
      const res = await SS_API.getRFQConversation(rfqId, buyerIdentity.id);
      const newMessages = res.messages || [];
      const hasNew = newMessages.some((m) => !knownIds.has(m._id));
      const wasNear = isThreadNearBottom();
      messages = newMessages;
      messages.forEach((m) => knownIds.add(m._id));
      conversationLoaded = true;
      renderThread();

      if (initial) scrollThreadToBottom(false);
      else if (isPoll && hasNew) { if (wasNear) scrollThreadToBottom(); else showJump(); }
    } catch (err) {
      rcThread.innerHTML = `<div class="rc-empty"><i class="fa-solid fa-triangle-exclamation"></i><span>${escapeHtml(err.message || "Could not load messages.")}</span></div>`;
    }
  }

  function startChatPolling() {
    stopChatPolling();
    pollTimer = setInterval(() => loadConversation({ isPoll: true }), 8000);
  }
  function stopChatPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
  document.addEventListener("visibilitychange", () => {
    if (!modalOpen) return;
    if (document.hidden) stopChatPolling();
    else { loadConversation({ isPoll: true }); startChatPolling(); }
  });

  /* ---- moderation notices ---- */
  function flashNotice(text, kind) {
    rcNoticeSlot.innerHTML = `<div class="rc-notice ${kind}"><i class="fa-solid fa-shield-halved"></i>${escapeHtml(text)}</div>`;
    if (kind === "warn") setTimeout(() => { rcNoticeSlot.innerHTML = ""; }, 6000);
  }

  function onRestricted(message) {
    sellerRestricted = true;
    rcComposer.classList.add("is-disabled");
    rcNoticeSlot.innerHTML = `<div class="rc-restricted-banner"><i class="fa-solid fa-ban"></i><span>${escapeHtml(message || "Your messaging privileges are currently restricted pending review. Please contact support.")}</span></div>`;
  }

  async function handleSend() {
    if (sellerRestricted) return;
    const text = rcField.value.trim();
    if (!text) return;
    rcSend.disabled = true;
    try {
      const { message, notice } = await SS_API.sendRFQMessage(rfqId, { receiverId: buyerIdentity.id, message: text });
      rcField.value = "";
      rcField.style.height = "auto";
      messages.push(message);
      knownIds.add(message._id);
      renderThread();
      scrollThreadToBottom();
      if (notice) flashNotice(notice, "warn");
    } catch (err) {
      if (err.status === 403) onRestricted(err.message);
      else ssToast(err.message || "Could not send message", "fa-triangle-exclamation");
    } finally {
      rcSend.disabled = false;
    }
  }

  async function sendImageFile(file) {
    if (sellerRestricted) return;
    const fd = new FormData();
    fd.append("receiverId", buyerIdentity.id);
    fd.append("image", file); // NOTE: confirm this matches the field name uploadRFQChatImage expects
    try {
      const { message } = await SS_API.sendRFQMessage(rfqId, fd, true);
      messages.push(message);
      knownIds.add(message._id);
      renderThread();
      scrollThreadToBottom();
    } catch (err) {
      if (err.status === 403) onRestricted(err.message);
      else ssToast(err.message || "Could not send photo", "fa-triangle-exclamation");
    }
  }

  /* ============================================================
     LOAD + BOOT
     ============================================================ */
  async function loadRFQ() {
    try {
      const { rfq: r } = await SS_API.getRFQ(rfqId);
      rfq = r;
      renderHero();
    } catch (err) {
      heroEl.innerHTML = `<div class="rfq-empty"><i class="fa-solid fa-triangle-exclamation"></i>${escapeHtml(err.message || "Could not load this request.")}</div>`;
    }
  }

  async function loadMyBid() {
    try {
      const { bids } = await SS_API.getMyBids();
      myBid = (bids || []).find((b) => b.rfq && String(b.rfq._id) === String(rfqId)) || null;
    } catch (err) {
      myBid = null;
    }
  }

  (async function boot() {
    await loadRFQ();
    await loadMyBid();
    renderBidFormState();
    hideLoader();
    await bootChatIfReady();
  })();
})();