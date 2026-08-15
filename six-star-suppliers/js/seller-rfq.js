/* ============================================================
   SELLER-RFQ.JS — "Buyer Requests" live chat-style board
   Rewritten to feel like the buyer's chat.html: a continuous,
   auto-refreshing feed of buyer requests, filterable by status
   and by "my offers". Submitting/updating a bid opens a bottom
   sheet; an accepted or pending bid unlocks a private fullscreen
   chat with that buyer — same rc-modal pattern used elsewhere.
   ============================================================ */
(async () => {
  const user = await SS_AUTH.requireRole(["wholesaler", "retailer"]);
  if (!user) return;

  function hideLoader() {
    const loader = document.getElementById("pageLoader");
    if (loader) { loader.classList.add("hide"); loader.style.display = "none"; }
  }
  hideLoader();

  function esc(str = "") {
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
  function timeOf(d) { return fmtTime(d); }
  function dayLabel(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (same(d, now)) return "Today";
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (same(d, y)) return "Yesterday";
    return d.toLocaleDateString("en-KE", { day: "numeric", month: "long", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
  }
  function dayKey(dateStr) { const d = new Date(dateStr); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
  function debounce(fn, wait) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); }; }
  function fmtCount(n) { return n > 99 ? "99+" : String(n); }

  const STATUS_LABEL = {
    OPEN: "Open", BIDDING: "Receiving Offers", SELLER_SELECTED: "Seller Selected",
    CLOSED: "Closed", EXPIRED: "Expired", CANCELLED: "Cancelled",
  };
  const STATUS_ICON = {
    open: "fa-file-invoice", bidding: "fa-comments-dollar", seller_selected: "fa-circle-check",
    closed: "fa-box-archive", expired: "fa-hourglass-end", cancelled: "fa-ban",
  };
  const ARCHIVED_STATUSES = ["CLOSED", "EXPIRED", "CANCELLED"];
  const POLL_INTERVAL_MS = 30000;
  const MOD_FLAG_LABEL = {
    phone_number: "Phone number hidden", email_address: "Email hidden", whatsapp: "WhatsApp mention hidden",
    telegram: "Telegram mention hidden", social_handle: "Social handle hidden",
    external_payment: "Payment detail hidden", external_link: "Link hidden",
  };

  /* ---------------- elements ---------------- */
  const messagesEl = document.getElementById("scMessages");
  const loadingEl = document.getElementById("scLoading");
  const jumpBtn = document.getElementById("scJump");

  const filtersEl = document.getElementById("scFilters");
  const countAllEl = document.getElementById("scCountAll");
  const countOpenEl = document.getElementById("scCountOpen");
  const countBiddingEl = document.getElementById("scCountBidding");
  const countMineEl = document.getElementById("scCountMine");
  const countAcceptedEl = document.getElementById("scCountAccepted");
  const countArchivedEl = document.getElementById("scCountArchived");

  const searchBtn = document.getElementById("scSearchBtn");
  const searchBar = document.getElementById("scSearchBar");
  const searchInput = document.getElementById("scSearchInput");
  const searchClear = document.getElementById("scSearchClear");

  const themeToggleBtn = document.getElementById("scThemeToggle");
  const themeSwitch = document.getElementById("scThemeSwitch");

  const menuBtn = document.getElementById("scMenuBtn");
  const menu = document.getElementById("scMenu");
  const menuBackdrop = document.getElementById("scMenuBackdrop");
  const menuClose = document.getElementById("scMenuClose");
  const menuMineLink = document.getElementById("scMenuMineLink");

  // bid sheet
  const bidSheet = document.getElementById("bidSheet");
  const bidSheetBackdrop = document.getElementById("bidSheetBackdrop");
  const bidSheetClose = document.getElementById("bidSheetClose");
  const bidSheetHandleWrap = document.getElementById("bidSheetHandle");
  const bidSheetHeading = document.getElementById("bidSheetHeading");
  const bidSheetProductLine = document.getElementById("bidSheetProductLine");
  const bidExistingNote = document.getElementById("bidExistingNote");
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

  const withdrawOverlay = document.getElementById("withdrawOverlay");

  // chat modal
  const rcModalOverlay = document.getElementById("rcModalOverlay");
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
  let allRFQs = [];                  // oldest -> newest
  let myBidsByRfq = new Map();       // rfqId -> bid
  let knownIds = new Set();
  let openRowId = null;
  let activeFilter = "all";
  let searchQuery = "";
  let searchOpen = false;
  let firstLoad = true;
  let pollTimer = null;

  let bidSheetOpen = false;
  let currentBidRfq = null;          // rfq currently in the bid sheet
  let currentBid = null;             // existing bid for that rfq, if any
  let pendingWithdrawBidId = null;

  let modalOpen = false;
  let chatRfqId = null;
  let buyerIdentity = null;
  let messages = [];
  let knownMsgIds = new Set();
  let sellerRestricted = false;
  let chatPollTimer = null;

  /* ---------------- theme ---------------- */
  function currentTheme() { return document.documentElement.getAttribute("data-seller-theme") === "dark" ? "dark" : "light"; }
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-seller-theme", theme);
    try { localStorage.setItem("ss-seller-chat-theme", theme); } catch (e) {}
    if (themeSwitch) themeSwitch.checked = theme === "dark";
  }
  if (themeSwitch) themeSwitch.checked = currentTheme() === "dark";
  if (themeToggleBtn) themeToggleBtn.addEventListener("click", () => applyTheme(currentTheme() === "dark" ? "light" : "dark"));
  if (themeSwitch) themeSwitch.addEventListener("change", () => applyTheme(themeSwitch.checked ? "dark" : "light"));

  /* ================================================================ */
  /* FILTERING + SEARCH                                                 */
  /* ================================================================ */
  function bidStatusFor(rfqId) {
    const bid = myBidsByRfq.get(rfqId);
    return bid ? bid.status : null; // pending | accepted | rejected | withdrawn | null
  }

  function matchesFilter(rfq) {
    const bidStatus = bidStatusFor(rfq._id);
    switch (activeFilter) {
      case "all": return true;
      case "open": return rfq.status === "OPEN";
      case "bidding": return rfq.status === "BIDDING";
      case "mine": return !!bidStatus && bidStatus !== "withdrawn";
      case "accepted": return bidStatus === "accepted";
      case "archived": return ARCHIVED_STATUSES.includes(rfq.status);
      default: return true;
    }
  }
  function matchesSearch(rfq) {
    if (!searchQuery) return true;
    const hay = `${rfq.productName || ""} ${rfq.location || ""}`.toLowerCase();
    return hay.includes(searchQuery);
  }
  function visibleRFQs() { return allRFQs.filter((r) => matchesFilter(r) && matchesSearch(r)); }

  /* ================================================================ */
  /* RENDER PIECES                                                      */
  /* ================================================================ */
  function statusKeyOf(rfq) { return (rfq.status || "OPEN").toLowerCase(); }
  function budgetText(rfq) {
    const unit = rfq.budgetType === "total" ? " total" : "/unit";
    return `${money(rfq.minBudget)}–${money(rfq.maxBudget)}${unit}`;
  }

  function systemNoteHTML() {
    return `<div class="sc-systemnote"><span><i class="fa-solid fa-lock"></i>Buyer identity stays masked until you submit an offer.</span></div>`;
  }
  function dayDividerHTML(dateStr) { return `<div class="sc-daydivider"><span>${esc(dayLabel(dateStr))}</span></div>`; }
  function emptyHTML(icon, title, msg) {
    return `<div class="sc-empty"><i class="fa-solid ${icon}"></i><strong>${esc(title)}</strong><span>${esc(msg)}</span></div>`;
  }
  function errorHTML(msg) { return `<div class="sc-error"><i class="fa-solid fa-triangle-exclamation"></i> <span>${esc(msg)}</span></div>`; }

  function bubbleMediaHTML(rfq) {
    if (!rfq.productImage) return "";
    return `<div class="sc-bubble__media" data-lightbox="${esc(rfq.productImage)}" title="Tap to view full photo">
      <img src="${esc(rfq.productImage)}" alt="${esc(rfq.productName)}" loading="lazy">
      <span class="sc-bubble__media-zoom"><i class="fa-solid fa-magnifying-glass-plus"></i></span>
    </div>`;
  }
  function rowAvatarHTML(rfq, statusKey) {
    if (rfq.productImage) return `<div class="sc-row__avatar sc-row__avatar--photo"><img src="${esc(rfq.productImage)}" alt="" loading="lazy"></div>`;
    const icon = STATUS_ICON[statusKey] || "fa-file-invoice";
    return `<div class="sc-row__avatar"><i class="fa-solid ${icon}"></i></div>`;
  }

  function bidBadgeHTML(rfq) {
    const bid = myBidsByRfq.get(rfq._id);
    if (!bid || bid.status === "withdrawn") return "";
    const cls = bid.status; // pending | accepted | rejected
    const label = { pending: "Offer pending", accepted: "You were selected", rejected: "Offer declined" }[bid.status] || bid.status;
    return `<span class="sc-mybid sc-mybid--${cls}"><i class="fa-solid fa-hand-holding-dollar"></i>${esc(label)} · ${money(bid.unitPrice)}</span>`;
  }

  function actionButtonsHTML(rfq) {
    const bid = myBidsByRfq.get(rfq._id);
    const rfqOpen = ["OPEN", "BIDDING"].includes(rfq.status);
    const buttons = [];

    if (!bid || bid.status === "withdrawn") {
      if (rfqOpen) {
        buttons.push(`<button class="sc-btn-reply" type="button" data-bid><i class="fa-solid fa-paper-plane"></i> Submit an offer</button>`);
      } else {
        buttons.push(`<span class="sc-closed-note"><i class="fa-solid fa-box-archive"></i>This request is no longer accepting offers.</span>`);
      }
    } else {
      if (bid.status === "pending") {
        if (rfqOpen) buttons.push(`<button class="sc-btn-reply" type="button" data-bid><i class="fa-solid fa-pen"></i> Update offer</button>`);
        buttons.push(`<button class="sc-btn-outline-sm" type="button" data-withdraw="${bid._id}"><i class="fa-solid fa-ban"></i> Withdraw</button>`);
        buttons.push(`<button class="sc-btn-outline-sm" type="button" data-message><i class="fa-regular fa-comment"></i> Message buyer</button>`);
      } else if (bid.status === "accepted") {
        buttons.push(`<button class="sc-btn-reply" type="button" data-message><i class="fa-regular fa-comment"></i> Message buyer</button>`);
      } else if (bid.status === "rejected") {
        buttons.push(`<span class="sc-closed-note"><i class="fa-solid fa-circle-xmark"></i>The buyer selected another seller.</span>`);
      }
    }
    return buttons.join("");
  }

  function bubbleHTML(rfq, isNew) {
    const statusKey = statusKeyOf(rfq);
    const bidCount = rfq.bidCount || 0;
    return `
      <div class="sc-bubble${isNew ? " is-new" : ""}" data-toggle>
        ${bubbleMediaHTML(rfq)}
        <div class="sc-bubble__head">
          <div class="sc-bubble__title">${esc(rfq.productName)}</div>
          <div class="sc-bubble__meta">
            <span><i class="fa-solid fa-box"></i>${esc(rfq.quantity)} ${esc(rfq.unit)}</span>
            <span><i class="fa-solid fa-location-dot"></i>${esc(rfq.location)}</span>
            <span class="sc-bubble__budget"><i class="fa-solid fa-sack-dollar"></i>${budgetText(rfq)}</span>
          </div>
        </div>
        <div class="sc-bubble__foot">
          <span class="sc-status sc-status--${statusKey}"><i class="fa-solid fa-circle"></i>${esc(STATUS_LABEL[rfq.status] || rfq.status)}</span>
          <span class="sc-sellers${bidCount === 0 ? " is-zero" : ""}"><i class="fa-solid fa-users"></i>${bidCount} offer${bidCount === 1 ? "" : "s"}</span>
          ${bidBadgeHTML(rfq)}
          <span class="sc-expand-hint"><i class="fa-solid fa-chevron-down"></i>details</span>
        </div>
        <div class="sc-bubble__detail">
          <div class="sc-bubble__detail-inner">
            <div class="sc-bubble__detail-body">
              <p class="sc-detail-desc">${esc(rfq.description)}</p>
              <div class="sc-spec-grid">
                <div class="sc-spec"><span class="sc-spec__label">Quantity</span><span class="sc-spec__value mono">${esc(rfq.quantity)} ${esc(rfq.unit)}</span></div>
                <div class="sc-spec"><span class="sc-spec__label">Budget</span><span class="sc-spec__value mono">${budgetText(rfq)}</span></div>
                <div class="sc-spec"><span class="sc-spec__label">Location</span><span class="sc-spec__value">${esc(rfq.location)}</span></div>
                <div class="sc-spec"><span class="sc-spec__label">Required by</span><span class="sc-spec__value">${esc(fmtDate(rfq.requiredDate))}</span></div>
                <div class="sc-spec"><span class="sc-spec__label">Delivery</span><span class="sc-spec__value">${rfq.deliveryRequired ? "Required" : "Buyer will pick up"}</span></div>
                <div class="sc-spec"><span class="sc-spec__label">Delivery budget</span><span class="sc-spec__value mono">${rfq.deliveryBudget ? money(rfq.deliveryBudget) : "—"}</span></div>
              </div>
              <div class="sc-detail-actions">${actionButtonsHTML(rfq)}</div>
            </div>
          </div>
        </div>
      </div>`;
  }

  function rowHTML(rfq, isNew) {
    const statusKey = statusKeyOf(rfq);
    return `
      <div class="sc-row sc-sig--${statusKey}${isNew ? " sc-row--enter" : ""}" data-row-id="${esc(rfq._id)}">
        ${rowAvatarHTML(rfq, statusKey)}
        <div class="sc-row__col">
          <div class="sc-row__sender"><i class="fa-solid fa-circle"></i>Verified buyer · identity masked</div>
          ${bubbleHTML(rfq, isNew)}
          <div class="sc-row__footrow">
            <span class="sc-row__time"><i class="fa-solid fa-clock"></i>${esc(timeOf(rfq.createdAt))}</span>
            <button class="sc-quickreply" type="button" data-quickaction title="Quick action" aria-label="Quick action">
              <i class="fa-solid fa-reply"></i>
            </button>
          </div>
        </div>
      </div>`;
  }

  /* ================================================================ */
  /* RENDER FEED                                                        */
  /* ================================================================ */
  function isNearBottom() { return messagesEl.scrollTop + messagesEl.clientHeight >= messagesEl.scrollHeight - 160; }

  function render() {
    if (!allRFQs.length) {
      messagesEl.innerHTML = emptyHTML("fa-inbox", "No requests yet", "Buyer requests will appear here the moment they're posted.");
      return;
    }
    const list = visibleRFQs();
    if (!list.length) {
      messagesEl.innerHTML = emptyHTML("fa-filter-circle-xmark", "No matches", "Try a different search term or filter.");
      return;
    }
    let html = systemNoteHTML();
    let lastKey = null;
    list.forEach((rfq) => {
      const key = dayKey(rfq.createdAt || rfq.requiredDate);
      if (key !== lastKey) { html += dayDividerHTML(rfq.createdAt || rfq.requiredDate); lastKey = key; }
      const isNew = !firstLoad && !knownIds.has(rfq._id);
      html += rowHTML(rfq, isNew);
    });
    messagesEl.innerHTML = html;

    if (openRowId) {
      const row = messagesEl.querySelector(`.sc-row[data-row-id="${CSS.escape(openRowId)}"]`);
      if (row) row.classList.add("open");
    }
  }

  function renderCounts() {
    const total = allRFQs.length;
    const open = allRFQs.filter((r) => r.status === "OPEN").length;
    const bidding = allRFQs.filter((r) => r.status === "BIDDING").length;
    const mine = allRFQs.filter((r) => { const s = bidStatusFor(r._id); return s && s !== "withdrawn"; }).length;
    const accepted = allRFQs.filter((r) => bidStatusFor(r._id) === "accepted").length;
    const archived = allRFQs.filter((r) => ARCHIVED_STATUSES.includes(r.status)).length;

    if (countAllEl) countAllEl.textContent = fmtCount(total);
    if (countOpenEl) countOpenEl.textContent = fmtCount(open);
    if (countBiddingEl) countBiddingEl.textContent = fmtCount(bidding);
    if (countMineEl) countMineEl.textContent = fmtCount(mine);
    if (countAcceptedEl) countAcceptedEl.textContent = fmtCount(accepted);
    if (countArchivedEl) countArchivedEl.textContent = fmtCount(archived);
  }

  /* ================================================================ */
  /* FEED INTERACTIONS                                                  */
  /* ================================================================ */
  messagesEl.addEventListener("click", (e) => {
    const mediaEl = e.target.closest("[data-lightbox]");
    if (mediaEl) { e.stopPropagation(); window.open(mediaEl.dataset.lightbox, "_blank", "noopener"); return; }

    const row = e.target.closest(".sc-row");
    const rfq = row ? allRFQs.find((r) => r._id === row.dataset.rowId) : null;

    const bidBtn = e.target.closest("[data-bid]");
    if (bidBtn && rfq) { e.stopPropagation(); openBidSheet(rfq); return; }

    const withdrawBtn = e.target.closest("[data-withdraw]");
    if (withdrawBtn) { e.stopPropagation(); pendingWithdrawBidId = withdrawBtn.dataset.withdraw; withdrawOverlay.classList.add("open"); return; }

    const messageBtn = e.target.closest("[data-message]");
    if (messageBtn && rfq) { e.stopPropagation(); openChatModal(rfq); return; }

    const quickBtn = e.target.closest("[data-quickaction]");
    if (quickBtn && rfq) {
      e.stopPropagation();
      const bid = myBidsByRfq.get(rfq._id);
      if (bid && bid.status !== "withdrawn") openChatModal(rfq);
      else openBidSheet(rfq);
      return;
    }

    const toggle = e.target.closest("[data-toggle]");
    if (toggle) {
      const id = row.dataset.rowId;
      const isOpening = !row.classList.contains("open");
      messagesEl.querySelectorAll(".sc-row.open").forEach((r) => r.classList.remove("open"));
      if (isOpening) { row.classList.add("open"); openRowId = id; } else { openRowId = null; }
    }
  });

  messagesEl.addEventListener("scroll", () => {
    if (isNearBottom() && jumpBtn.style.display !== "none") jumpBtn.style.display = "none";
  });
  jumpBtn.addEventListener("click", () => {
    messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: "smooth" });
    jumpBtn.style.display = "none";
  });

  if (filtersEl) {
    filtersEl.addEventListener("click", (e) => {
      const chip = e.target.closest(".sc-chip");
      if (!chip) return;
      filtersEl.querySelectorAll(".sc-chip").forEach((c) => c.classList.remove("is-active"));
      chip.classList.add("is-active");
      activeFilter = chip.dataset.filter || "all";
      render();
    });
  }

  function toggleSearch(forceOpen) {
    searchOpen = typeof forceOpen === "boolean" ? forceOpen : !searchOpen;
    searchBar.classList.toggle("open", searchOpen);
    searchBtn.setAttribute("aria-pressed", String(searchOpen));
    if (searchOpen) setTimeout(() => searchInput.focus(), 220);
    else if (searchInput.value) { searchInput.value = ""; searchQuery = ""; searchBar.classList.remove("has-value"); render(); }
  }
  if (searchBtn && searchBar && searchInput) {
    searchBtn.addEventListener("click", () => toggleSearch());
    searchInput.addEventListener("input", debounce(() => {
      searchQuery = searchInput.value.trim().toLowerCase();
      searchBar.classList.toggle("has-value", !!searchInput.value);
      render();
    }, 180));
    if (searchClear) searchClear.addEventListener("click", () => {
      searchInput.value = ""; searchQuery = ""; searchBar.classList.remove("has-value"); searchInput.focus(); render();
    });
  }

  function openMenu() { menu.classList.add("active"); menuBackdrop.classList.add("active"); menuBtn.classList.add("active"); menuBtn.setAttribute("aria-expanded", "true"); menu.setAttribute("aria-hidden", "false"); }
  function closeMenu() { menu.classList.remove("active"); menuBackdrop.classList.remove("active"); menuBtn.classList.remove("active"); menuBtn.setAttribute("aria-expanded", "false"); menu.setAttribute("aria-hidden", "true"); }
  if (menuBtn && menu && menuBackdrop) {
    menuBtn.addEventListener("click", () => (menu.classList.contains("active") ? closeMenu() : openMenu()));
    if (menuClose) menuClose.addEventListener("click", closeMenu);
    menuBackdrop.addEventListener("click", closeMenu);
  }
  if (menuMineLink) {
    menuMineLink.addEventListener("click", (e) => {
      e.preventDefault();
      closeMenu();
      filtersEl.querySelectorAll(".sc-chip").forEach((c) => c.classList.remove("is-active"));
      filtersEl.querySelector('[data-filter="mine"]').classList.add("is-active");
      activeFilter = "mine";
      render();
    });
  }

  /* ================================================================ */
  /* BID SHEET                                                          */
  /* ================================================================ */
  function clearBidError() { bidFormError.classList.remove("show"); bidFormError.textContent = ""; }
  function showBidError(msg) { bidFormError.textContent = msg; bidFormError.classList.add("show"); }

  function openBidSheet(rfq) {
    currentBidRfq = rfq;
    currentBid = myBidsByRfq.get(rfq._id) || null;
    clearBidError();
    bidExistingNote.innerHTML = "";
    bidWithdrawBtn.style.display = "none";
    bidForm.reset();

    bidSheetProductLine.textContent = rfq.productName;

    if (currentBid && currentBid.status !== "withdrawn") {
      bidSheetHeading.textContent = "Update Your Offer";
      bidSubmitBtn.innerHTML = '<i class="fa-solid fa-pen"></i> Update Offer';
      bidExistingNote.innerHTML = `<div class="existing-bid-note"><i class="fa-solid fa-circle-info"></i>You already have an offer on this request — submitting below updates it.</div>`;
      bidUnitPrice.value = currentBid.unitPrice ?? "";
      bidQuantity.value = currentBid.quantityAvailable ?? "";
      bidDeliveryFee.value = currentBid.deliveryFee ?? "";
      bidDeliveryTime.value = currentBid.deliveryTime ?? "";
      bidValidUntil.value = currentBid.offerValidUntil ? new Date(currentBid.offerValidUntil).toISOString().slice(0, 10) : "";
      bidMessage.value = currentBid.message ?? "";
      if (currentBid.status === "pending") bidWithdrawBtn.style.display = "inline-flex";
    } else {
      bidSheetHeading.textContent = "Submit an Offer";
      bidSubmitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Offer';
    }

    bidSheetOpen = true;
    closeMenu();
    bidSheet.classList.add("active");
    bidSheetBackdrop.classList.add("active");
    bidSheet.setAttribute("aria-hidden", "false");
    setTimeout(() => bidUnitPrice.focus({ preventScroll: true }), 260);
  }

  function closeBidSheet() {
    bidSheetOpen = false;
    bidSheet.classList.remove("active");
    bidSheetBackdrop.classList.remove("active");
    bidSheet.setAttribute("aria-hidden", "true");
    bidSheet.classList.remove("dragging");
    bidSheet.style.transform = "";
    currentBidRfq = null;
    currentBid = null;
  }

  if (bidSheetClose) bidSheetClose.addEventListener("click", closeBidSheet);
  if (bidSheetBackdrop) bidSheetBackdrop.addEventListener("click", closeBidSheet);

  if (bidSheetHandleWrap) {
    let dragStartY = 0, dragCurrentY = 0, dragging = false;
    const sheetHeight = () => bidSheet.getBoundingClientRect().height || 1;
    bidSheetHandleWrap.addEventListener("pointerdown", (e) => {
      dragging = true; dragStartY = e.clientY; dragCurrentY = 0;
      bidSheet.classList.add("dragging");
      try { bidSheetHandleWrap.setPointerCapture(e.pointerId); } catch (err) {}
    });
    bidSheetHandleWrap.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      dragCurrentY = Math.max(0, e.clientY - dragStartY);
      bidSheet.style.transform = `translateY(${dragCurrentY}px)`;
    });
    function endDrag() {
      if (!dragging) return;
      dragging = false;
      bidSheet.classList.remove("dragging");
      if (dragCurrentY > sheetHeight() * 0.28) closeBidSheet();
      else bidSheet.style.transform = "";
    }
    bidSheetHandleWrap.addEventListener("pointerup", endDrag);
    bidSheetHandleWrap.addEventListener("pointercancel", endDrag);
  }

  bidForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearBidError();
    if (!currentBidRfq) return;

    const payload = {
      unitPrice: Number(bidUnitPrice.value),
      quantityAvailable: Number(bidQuantity.value),
      deliveryFee: Number(bidDeliveryFee.value || 0),
      deliveryTime: bidDeliveryTime.value.trim(),
      offerValidUntil: bidValidUntil.value || undefined,
      message: bidMessage.value.trim(),
    };
    if (!payload.unitPrice || !payload.quantityAvailable) {
      showBidError("Unit price and quantity available are required.");
      return;
    }

    bidSubmitBtn.disabled = true;
    const origHtml = bidSubmitBtn.innerHTML;
    bidSubmitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting...';
    try {
      const { bid, notice } = await SS_API.submitOrUpdateBid(currentBidRfq._id, payload);
      myBidsByRfq.set(currentBidRfq._id, bid);
      ssToast(notice || "Offer submitted", notice ? "fa-shield-halved" : "fa-circle-check");
      closeBidSheet();
      render();
      renderCounts();
    } catch (err) {
      showBidError(err.message || "Could not submit your offer. Please try again.");
    } finally {
      bidSubmitBtn.disabled = false;
      bidSubmitBtn.innerHTML = origHtml;
    }
  });

  bidWithdrawBtn.addEventListener("click", () => {
    if (!currentBid) return;
    pendingWithdrawBidId = currentBid._id;
    withdrawOverlay.classList.add("open");
  });

  document.getElementById("withdrawDismiss").addEventListener("click", () => {
    pendingWithdrawBidId = null;
    withdrawOverlay.classList.remove("open");
  });
  document.getElementById("withdrawConfirm").addEventListener("click", async () => {
    if (!pendingWithdrawBidId) return;
    const btn = document.getElementById("withdrawConfirm");
    btn.disabled = true;
    try {
      const { bid } = await SS_API.withdrawBid(pendingWithdrawBidId);
      // find rfqId this bid belonged to
      for (const [rfqId, b] of myBidsByRfq.entries()) {
        if (b._id === pendingWithdrawBidId) { myBidsByRfq.set(rfqId, bid); break; }
      }
      withdrawOverlay.classList.remove("open");
      pendingWithdrawBidId = null;
      ssToast("Offer withdrawn", "fa-circle-check");
      closeBidSheet();
      render();
      renderCounts();
    } catch (err) {
      ssToast(err.message || "Could not withdraw this offer", "fa-triangle-exclamation");
    } finally {
      btn.disabled = false;
    }
  });

  /* ================================================================ */
  /* CHAT MODAL (message buyer)                                        */
  /* ================================================================ */
  function isThreadNearBottom() { return rcThread.scrollTop + rcThread.clientHeight >= rcThread.scrollHeight - 140; }
  function scrollThreadToBottom(smooth = true) { rcThread.scrollTo({ top: rcThread.scrollHeight, behavior: smooth ? "smooth" : "auto" }); hideJump(); }
  function showJump() { document.getElementById("rcJump")?.classList.add("show"); }
  function hideJump() { document.getElementById("rcJump")?.classList.remove("show"); }

  function bubbleChatHTML(msg) {
    const mine = String(msg.sender) === String(user._id) || String(msg.sender?._id) === String(user._id);
    const isImage = msg.messageType === "image";
    const flagLabel = (msg.moderationFlags || []).map((f) => MOD_FLAG_LABEL[f] || "Hidden for security")[0];
    return `
      <div class="rc-row ${mine ? "sent" : "received"}">
        <div class="rc-bubble">
          ${isImage
            ? `<img class="rc-bubble__img" src="${esc(msg.imageUrl)}" alt="Shared photo" data-lightbox="${esc(msg.imageUrl)}" loading="lazy">`
            : `<span>${esc(msg.message)}</span>`}
          ${msg.moderationAction === "masked" ? `<div class="rc-mod-flag"><i class="fa-solid fa-shield-halved"></i>${esc(flagLabel)}</div>` : ""}
          <div class="rc-bubble__foot"><span>${fmtTime(msg.createdAt)}</span></div>
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
      html += bubbleChatHTML(m);
    });
    html += `<button class="rc-jump" id="rcJump" type="button"><i class="fa-solid fa-arrow-down"></i> New messages</button>`;
    rcThread.innerHTML = html;
  }

  async function openChatModal(rfq) {
    chatRfqId = rfq._id;
    messages = [];
    knownMsgIds = new Set();
    buyerIdentity = null;

    rcNoticeSlot.innerHTML = "";
    rcComposer.classList.toggle("is-disabled", sellerRestricted);
    if (sellerRestricted) {
      rcNoticeSlot.innerHTML = `<div class="rc-restricted-banner"><i class="fa-solid fa-ban"></i><span>Your messaging privileges are currently restricted pending review. Please contact support.</span></div>`;
    }

    rcThread.innerHTML = `
      <div class="rc-skel-row"><div class="rc-skel-bubble"></div></div>
      <div class="rc-skel-row sent"><div class="rc-skel-bubble" style="width:45%;"></div></div>
      <div class="rc-skel-row"><div class="rc-skel-bubble" style="width:70%;"></div></div>`;

    modalOpen = true;
    rcModalOverlay.classList.add("open");
    document.body.classList.add("rc-modal-lock");

    try {
      const res = await SS_API.getBuyerIdentity(rfq._id);
      buyerIdentity = res.buyer;
      rcAvatar.textContent = buyerIdentity.initials || "B";
      rcLabel.textContent = buyerIdentity.label;
      rcSub.innerHTML = `<i class="fa-solid fa-lock"></i>Private conversation${buyerIdentity.isVerified ? " · Verified" : ""}`;
      await loadConversation({ initial: true });
      startChatPolling();
      setTimeout(() => rcField.focus({ preventScroll: true }), 260);
    } catch (err) {
      rcThread.innerHTML = `<div class="rc-empty"><i class="fa-solid fa-triangle-exclamation"></i><span>${esc(err.message || "Could not open this conversation yet — submit an offer first.")}</span></div>`;
    }
  }

  function closeChatModal() {
    modalOpen = false;
    rcModalOverlay.classList.remove("open");
    document.body.classList.remove("rc-modal-lock");
    stopChatPolling();
    chatRfqId = null;
    buyerIdentity = null;
  }

  rcModalClose.addEventListener("click", closeChatModal);
  rcModalOverlay.addEventListener("click", (e) => { if (e.target === rcModalOverlay) closeChatModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (modalOpen) { closeChatModal(); return; }
    if (bidSheetOpen) { closeBidSheet(); return; }
    if (menu && menu.classList.contains("active")) { closeMenu(); return; }
    if (searchOpen) toggleSearch(false);
  });

  rcField.addEventListener("input", () => {
    rcField.style.height = "auto";
    rcField.style.height = Math.min(rcField.scrollHeight, 96) + "px";
  });
  rcField.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendTextMessage(); } });
  rcSend.addEventListener("click", sendTextMessage);
  rcImageInput.addEventListener("change", () => {
    const file = rcImageInput.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { ssToast("Image must be under 5MB", "fa-circle-exclamation"); rcImageInput.value = ""; return; }
    sendImageMessage(file);
    rcImageInput.value = "";
  });
  rcThread.addEventListener("scroll", () => { if (isThreadNearBottom()) hideJump(); });
  rcThread.addEventListener("click", (e) => {
    const img = e.target.closest("[data-lightbox]");
    if (img) window.open(img.dataset.lightbox, "_blank", "noopener");
    if (e.target.closest("#rcJump")) scrollThreadToBottom();
  });

  async function loadConversation({ isPoll = false, initial = false } = {}) {
    if (!buyerIdentity || !chatRfqId) return;
    try {
      const res = await SS_API.getRFQConversation(chatRfqId, buyerIdentity.id);
      const newMessages = res.messages || [];
      const hasNew = newMessages.some((m) => !knownMsgIds.has(m._id));
      const wasNear = isThreadNearBottom();
      messages = newMessages;
      messages.forEach((m) => knownMsgIds.add(m._id));
      renderThread();
      if (initial) scrollThreadToBottom(false);
      else if (isPoll && hasNew) { if (wasNear) scrollThreadToBottom(); else showJump(); }
    } catch (err) {
      rcThread.innerHTML = `<div class="rc-empty"><i class="fa-solid fa-triangle-exclamation"></i><span>${esc(err.message || "Could not load messages.")}</span></div>`;
    }
  }

  function flashNotice(text, kind) {
    rcNoticeSlot.innerHTML = `<div class="rc-notice ${kind}"><i class="fa-solid fa-shield-halved"></i>${esc(text)}</div>`;
    if (kind === "warn") setTimeout(() => { rcNoticeSlot.innerHTML = ""; }, 6000);
  }
  function onRestricted(message) {
    sellerRestricted = true;
    rcComposer.classList.add("is-disabled");
    rcNoticeSlot.innerHTML = `<div class="rc-restricted-banner"><i class="fa-solid fa-ban"></i><span>${esc(message || "Your messaging privileges are currently restricted pending review. Please contact support.")}</span></div>`;
  }

  async function sendTextMessage() {
    if (sellerRestricted) return;
    const text = rcField.value.trim();
    if (!text || !buyerIdentity || !chatRfqId) return;
    rcSend.disabled = true;
    try {
      const { message, notice } = await SS_API.sendRFQMessage(chatRfqId, { receiverId: buyerIdentity.id, message: text });
      rcField.value = ""; rcField.style.height = "auto";
      messages.push(message); knownMsgIds.add(message._id);
      renderThread(); scrollThreadToBottom();
      if (notice) flashNotice(notice, "warn");
    } catch (err) {
      if (err.status === 403) onRestricted(err.message);
      else ssToast(err.message || "Could not send message", "fa-triangle-exclamation");
    } finally {
      rcSend.disabled = false;
    }
  }

  async function sendImageMessage(file) {
    if (sellerRestricted || !buyerIdentity || !chatRfqId) return;
    const fd = new FormData();
    fd.append("receiverId", buyerIdentity.id);
    fd.append("image", file);
    try {
      const { message } = await SS_API.sendRFQMessage(chatRfqId, fd, true);
      messages.push(message); knownMsgIds.add(message._id);
      renderThread(); scrollThreadToBottom();
    } catch (err) {
      if (err.status === 403) onRestricted(err.message);
      else ssToast(err.message || "Could not send photo", "fa-triangle-exclamation");
    }
  }

  function startChatPolling() {
    stopChatPolling();
    chatPollTimer = setInterval(() => { if (modalOpen && buyerIdentity) loadConversation({ isPoll: true }); }, 8000);
  }
  function stopChatPolling() { if (chatPollTimer) clearInterval(chatPollTimer); chatPollTimer = null; }
  document.addEventListener("visibilitychange", () => {
    if (!modalOpen) return;
    if (document.hidden) stopChatPolling();
    else { loadConversation({ isPoll: true }); startChatPolling(); }
  });

  /* ================================================================ */
  /* LOAD + POLL FEED                                                   */
  /* ================================================================ */
  async function loadMyBids() {
    try {
      const res = await SS_API.getMyBids();
      myBidsByRfq = new Map((res.bids || []).map((b) => [String(b.rfq && (b.rfq._id || b.rfq)), b]));
    } catch (err) {
      myBidsByRfq = new Map();
    }
  }

  async function loadFeed({ isPoll = false } = {}) {
    try {
      const [{ rfqs }] = await Promise.all([SS_API.getRFQs({ status: "" }), loadMyBids()]);
      allRFQs = (rfqs || []).slice().sort(
        (a, b) => new Date(a.createdAt || a.requiredDate) - new Date(b.createdAt || b.requiredDate)
      );

      if (isPoll) {
        const wasNear = isNearBottom();
        render(); renderCounts();
        if (wasNear) requestAnimationFrame(() => messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: "smooth" }));
        else if (allRFQs.some((r) => !knownIds.has(r._id))) jumpBtn.style.display = "flex";
      } else {
        if (loadingEl && loadingEl.parentNode) loadingEl.remove();
        render(); renderCounts();
        requestAnimationFrame(() => {
          setTimeout(() => { messagesEl.scrollTop = messagesEl.scrollHeight; firstLoad = false; }, 60);
        });
      }
      allRFQs.forEach((r) => knownIds.add(r._id));
    } catch (err) {
      if (loadingEl && loadingEl.parentNode) loadingEl.remove();
      messagesEl.innerHTML = errorHTML(err.message || "Could not load buyer requests.");
    }
  }

  function startPolling() { stopPolling(); pollTimer = setInterval(() => loadFeed({ isPoll: true }), POLL_INTERVAL_MS); }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopPolling();
    else { loadFeed({ isPoll: true }); startPolling(); }
  });

  /* ---------------- boot ---------------- */
  loadFeed();
  startPolling();
})();