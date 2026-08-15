/* ============================================================
   SELLER-RFQ.JS
   Powers seller-rfq.html: the "Open Requests" browsing board and
   the "My Offers" list. Matches the IIFE / SS_AUTH.requireRole /
   local escapeHtml() pattern already used by seller-dashboard.js.
   ============================================================ */
(async () => {
  const user = await SS_AUTH.requireRole(["wholesaler", "retailer"]);
  if (!user) return;

  function hideLoader() {
    const loader = document.getElementById("pageLoader");
    if (loader) { loader.classList.add("hide"); loader.style.display = "none"; }
  }
  hideLoader();

  function escapeHtml(str = "") {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
  function money(n) { return "KES " + Number(n || 0).toLocaleString(); }
  function fmtDate(d) {
    return d ? new Date(d).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }) : "—";
  }

  const STATUS_LABEL = {
    OPEN: "Open", BIDDING: "Receiving Offers", SELLER_SELECTED: "Seller Selected",
    CLOSED: "Closed", EXPIRED: "Expired", CANCELLED: "Cancelled",
  };
  function statusPill(status) {
    return `<span class="rfq-status rfq-status--${status.toLowerCase()}">${STATUS_LABEL[status] || status}</span>`;
  }

  let openRequests = [];
  let myBids = [];
  let activeTab = "open";
  let searchTerm = "";
  let pendingWithdrawId = null;

  /* ---------- tabs ---------- */
  document.getElementById("rfqTabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".rfq-tab");
    if (!btn) return;
    document.querySelectorAll(".rfq-tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    activeTab = btn.dataset.tab;
    document.getElementById("panelOpen").style.display = activeTab === "open" ? "block" : "none";
    document.getElementById("panelMine").style.display = activeTab === "mine" ? "block" : "none";
    if (activeTab === "mine") loadMyBids();
  });

  /* ---------- open requests ---------- */
  function requestCardHTML(r) {
    const img = r.productImage || "https://placehold.co/400x260/E4D6BD/5B564C?text=No+Photo";
    const budget = r.budgetType === "total"
      ? `${money(r.minBudget)} - ${money(r.maxBudget)} total`
      : `${money(r.minBudget)} - ${money(r.maxBudget)} /${escapeHtml(r.unit)}`;
    return `
      <div class="request-card">
        <div class="request-card__img"><img src="${escapeHtml(img)}" alt="${escapeHtml(r.productName)}" loading="lazy"></div>
        <div class="request-card__body">
          <div class="request-card__title">${escapeHtml(r.productName)}</div>
          <div class="request-card__meta">
            <span><i class="fa-solid fa-box"></i> ${r.quantity} ${escapeHtml(r.unit)}</span>
            <span><i class="fa-solid fa-location-dot"></i> ${escapeHtml(r.location)}</span>
            <span><i class="fa-solid fa-calendar"></i> ${fmtDate(r.requiredDate)}</span>
          </div>
          <div class="request-card__budget">${budget}</div>
          <div class="request-card__foot">
            ${statusPill(r.status)}
            <span class="request-card__bids">${r.bidCount || 0} offer${r.bidCount === 1 ? "" : "s"}</span>
            <a class="btn btn-primary btn-sm" href="seller-rfq-detail.html?id=${r._id}">View &amp; Bid</a>
          </div>
        </div>
      </div>`;
  }

  function renderOpenRequests() {
    const grid = document.getElementById("openRequestsGrid");
    let list = openRequests;
    if (searchTerm) {
      list = list.filter((r) =>
        (r.productName || "").toLowerCase().includes(searchTerm) ||
        (r.location || "").toLowerCase().includes(searchTerm)
      );
    }
    if (!list.length) {
      grid.innerHTML = `<div class="rfq-empty"><i class="fa-solid fa-inbox"></i>No open requests right now — check back soon.</div>`;
      return;
    }
    grid.innerHTML = list.map(requestCardHTML).join("");
  }

  async function loadOpenRequests() {
    try {
      const res = await SS_API.getRFQs({ status: "" });
      openRequests = res.rfqs || [];
      document.getElementById("tabCountOpen").textContent = openRequests.length;
      renderOpenRequests();
    } catch (err) {
      document.getElementById("openRequestsGrid").innerHTML =
        `<div class="rfq-empty"><i class="fa-solid fa-triangle-exclamation"></i>${escapeHtml(err.message || "Could not load requests.")}</div>`;
    }
  }

  let searchDebounce;
  document.getElementById("requestSearchInput").addEventListener("input", (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      searchTerm = e.target.value.trim().toLowerCase();
      renderOpenRequests();
    }, 200);
  });

  /* ---------- my offers ---------- */
  function myOfferCardHTML(bid) {
    const rfq = bid.rfq || {};
    const img = rfq.productImage || "https://placehold.co/120x120/E4D6BD/5B564C?text=%20";
    const canWithdraw = bid.status === "pending";
    return `
      <div class="my-offer-card" data-bid-id="${bid._id}">
        <div class="my-offer-card__img"><img src="${escapeHtml(img)}" alt=""></div>
        <div class="my-offer-card__body">
          <div class="my-offer-card__head">
            <span class="my-offer-card__title">${escapeHtml(rfq.productName || "Request")}</span>
            <span class="bid-status-pill ${bid.status}">${bid.status}</span>
            ${rfq.status ? statusPill(rfq.status) : ""}
          </div>
          <div class="my-offer-card__stats">
            <span>Your price: <b>${money(bid.unitPrice)}</b></span>
            <span>Qty: <b>${bid.quantityAvailable}</b></span>
            <span>Location: <b>${escapeHtml(rfq.location || "—")}</b></span>
          </div>
          <div class="my-offer-card__actions">
            <a class="btn btn-outline btn-sm" href="seller-rfq-detail.html?id=${rfq._id}"><i class="fa-solid fa-pen"></i> View / Update</a>
            ${bid.status === "accepted" ? `<a class="btn btn-primary btn-sm" href="seller-rfq-detail.html?id=${rfq._id}"><i class="fa-regular fa-comment"></i> Message Buyer</a>` : ""}
            ${canWithdraw ? `<button class="btn btn-outline btn-sm" data-withdraw="${bid._id}" style="color:var(--brick); border-color:var(--brick);"><i class="fa-solid fa-ban"></i> Withdraw</button>` : ""}
          </div>
        </div>
      </div>`;
  }

  function renderMyBids() {
    const list = document.getElementById("myOffersList");
    if (!myBids.length) {
      list.innerHTML = `<div class="rfq-empty"><i class="fa-solid fa-hand-holding-dollar"></i>You haven't submitted any offers yet. Browse Open Requests to get started.</div>`;
      return;
    }
    list.innerHTML = myBids.map(myOfferCardHTML).join("");
    list.querySelectorAll("[data-withdraw]").forEach((btn) => {
      btn.addEventListener("click", () => {
        pendingWithdrawId = btn.dataset.withdraw;
        document.getElementById("withdrawOverlay").classList.add("open");
      });
    });
  }

  async function loadMyBids() {
    try {
      const res = await SS_API.getMyBids();
      myBids = res.bids || [];
      document.getElementById("tabCountMine").textContent = myBids.length;
      renderMyBids();
    } catch (err) {
      document.getElementById("myOffersList").innerHTML =
        `<div class="rfq-empty"><i class="fa-solid fa-triangle-exclamation"></i>${escapeHtml(err.message || "Could not load your offers.")}</div>`;
    }
  }

  document.getElementById("withdrawDismiss").addEventListener("click", () => {
    pendingWithdrawId = null;
    document.getElementById("withdrawOverlay").classList.remove("open");
  });
  document.getElementById("withdrawConfirm").addEventListener("click", async () => {
    if (!pendingWithdrawId) return;
    const btn = document.getElementById("withdrawConfirm");
    btn.disabled = true;
    try {
      await SS_API.withdrawBid(pendingWithdrawId);
      ssToast("Offer withdrawn", "fa-circle-check");
      document.getElementById("withdrawOverlay").classList.remove("open");
      pendingWithdrawId = null;
      loadMyBids();
    } catch (err) {
      ssToast(err.message || "Could not withdraw this offer", "fa-triangle-exclamation");
    } finally {
      btn.disabled = false;
    }
  });

  loadOpenRequests();
  loadMyBids();
})();