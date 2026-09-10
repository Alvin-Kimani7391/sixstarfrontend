/* ============================================================
   SIX STAR SUPPLIERS — Agent Dashboard
   ============================================================ */

// Frontend (storefront) base URL — used to build referral links.
// IMPORTANT: this is NOT SS_CONFIG.API_BASE (that points at your backend,
// e.g. https://api.sixstarsuppliers.com/api). Referral links must point at
// the storefront the buyer/seller will actually land on. If you add a
// SITE_URL key to js/config.js this will pick it up automatically;
// otherwise it falls back to the production storefront domain.
const SS_SITE_URL = (window.SS_CONFIG && window.SS_CONFIG.SITE_URL) || "https://www.sixstarsuppliers.com";

// Fallback avatar shown whenever an agent has no photo uploaded yet.
const DEFAULT_AVATAR_FALLBACK = true; // toggles the CSS "fallback" icon vs an <img>

let currentAgent = null;
let assetsCache = [];
let leadsCache = [];
let commissionsCache = [];
let activeLeadId = null;
let activeAssetId = null;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  wireSidebar();
  wireModalCloseButtons();
  wireOverview();
  wireMarketing();
  wireSharing();
  wireRecruit();
  wireLeads();
  wireProfile();
  wirePayout();
  await checkAuth();
}

async function checkAuth() {
  try {
    const { agent } = await SS_AGENT_API.getMe();
    currentAgent = agent;
    SS_AGENT_AUTH.set(agent);
    showDashboard();
  } catch (err) {
    location.href = "agent-login.html";
  }
}

function showDashboard() {
  document.getElementById("agentLoading").style.display = "none";
  document.getElementById("agentShell").style.display = "grid";
  document.getElementById("agentNameLabel").textContent = currentAgent.name;
  renderAvatar("sidebarAvatarImg", "sidebarAvatarFallback", currentAgent.avatar);

  if (!["approved", "active"].includes(currentAgent.status)) {
    document.querySelector(".agent-body-inner").innerHTML = `
      <div class="dash-card"><div class="dash-empty">
        <i class="fa-solid fa-hourglass-half"></i>
        <p><strong>Your agent application is ${escapeHtml(currentAgent.status)}.</strong><br>
        You'll get full dashboard access once you're approved.${currentAgent.status === 'rejected' && currentAgent.rejectionReason ? `<br><br>Reason: ${escapeHtml(currentAgent.rejectionReason)}` : ''}</p>
      </div></div>`;
    return;
  }

  switchTab("overview");
  refreshNotifBadge();
}

// ===================================================================
// AVATAR HELPERS (NEW)
// ===================================================================
// Toggles between the <img> and the CSS fallback icon depending on
// whether the agent has actually uploaded a photo. Reused for the
// sidebar avatar and the profile-tab avatar preview.
function renderAvatar(imgId, fallbackId, url) {
  const img = document.getElementById(imgId);
  const fallback = document.getElementById(fallbackId);
  if (!img || !fallback) return;
  if (url) {
    img.src = url;
    img.style.display = "block";
    fallback.style.display = "none";
  } else {
    img.removeAttribute("src");
    img.style.display = "none";
    fallback.style.display = "flex";
  }
}

// ===================================================================
// SIDEBAR / TABS
// ===================================================================
function wireSidebar() {
  document.querySelectorAll(".agent-nav button[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => { switchTab(btn.dataset.tab); closeMobileSidebar(); });
  });
  document.getElementById("sidebarToggle").addEventListener("click", () => {
    document.getElementById("agentSidebar").classList.add("active");
    document.getElementById("agentOverlay").classList.add("active");
  });
  document.getElementById("agentOverlay").addEventListener("click", closeMobileSidebar);
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    try { await SS_AGENT_API.logout(); } catch (_) {}
    SS_AGENT_AUTH.clear();
    location.href = "agent-login.html";
  });
}
function closeMobileSidebar() {
  document.getElementById("agentSidebar").classList.remove("active");
  document.getElementById("agentOverlay").classList.remove("active");
}

function switchTab(tab) {
  document.querySelectorAll(".agent-nav button[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${tab}`));
  const label = document.querySelector(`.agent-nav button[data-tab="${tab}"]`)?.textContent.trim().split("\n")[0] || tab;
  document.getElementById("topbarTitle").textContent = label;

  if (tab === "overview") loadOverview();
  if (tab === "marketing") { loadAssets(); loadMyMarketing(); }
  if (tab === "campaigns") loadCampaigns();
  if (tab === "leads") { loadFollowups(); loadLeads(); }
  if (tab === "commissions") loadCommissions();
  if (tab === "analytics") loadAnalytics();
  if (tab === "leaderboard") loadLeaderboard();
  if (tab === "achievements") loadAchievements();
  if (tab === "academy") loadAcademy();
  if (tab === "notifications") loadFullNotifications();
  if (tab === "profile") loadProfileForm();
}

// ===================================================================
// OVERVIEW
// ===================================================================
function wireOverview() {
  document.getElementById("overviewSeeAllNotif").addEventListener("click", () => switchTab("notifications"));
  document.getElementById("shareProductQuickBtn")?.addEventListener("click", () => {
    switchTab("sharing");
    setTimeout(() => document.getElementById("productShareInput")?.focus(), 150);
  });
}

function refreshQuickActionLinks() {
  const visitBtn = document.getElementById("visitStoreBtn");
  if (visitBtn && currentAgent) {
    const base = SS_SITE_URL.replace(/\/$/, "");
    visitBtn.href = `${base}/index.html?ref=${currentAgent.code}`;
  }
}

async function loadOverview() {
  const grid = document.getElementById("overviewStats");
  grid.innerHTML = `<div class="stat-card"><div class="spinner"></div></div>`.repeat(6);

  try {
    const [analytics, commSummary] = await Promise.all([
      SS_AGENT_API.getMyAnalytics(),
      SS_AGENT_API.getMyCommissionSummary(),
    ]);

    const t = analytics.agentTotals;
    grid.innerHTML = `
      <div class="stat-card tone-brand"><div class="stat-label">Confirmed Commission</div><div class="stat-value">KES ${(commSummary.summary.confirmed || 0).toLocaleString()}</div><div class="stat-sub">Lifetime earned</div></div>
      <div class="stat-card"><div class="stat-label">Pending Commission</div><div class="stat-value">KES ${(commSummary.summary.pending || 0).toLocaleString()}</div><div class="stat-sub">Awaiting delivery</div></div>
      <div class="stat-card tone-price"><div class="stat-label">Buyers Referred</div><div class="stat-value">${t.buyersReferred || 0}</div><div class="stat-sub">${t.totalOrders || 0} orders generated</div></div>
      <div class="stat-card tone-pop"><div class="stat-label">Sellers Referred</div><div class="stat-value">${t.sellersReferred || 0}</div><div class="stat-sub">${t.approvedSellersReferred || 0} approved</div></div>
      <div class="stat-card"><div class="stat-label">Referral Clicks</div><div class="stat-value">${analytics.marketing.referralClicks || 0}</div><div class="stat-sub">${analytics.marketing.assetsShared || 0} assets shared</div></div>
      <div class="stat-card"><div class="stat-label">Assets Downloaded</div><div class="stat-value">${analytics.marketing.assetsDownloaded || 0}</div><div class="stat-sub">From the Marketing Center</div></div>
    `;
  } catch (err) {
    grid.innerHTML = `<div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div>`;
  }

  renderReferralLinks();
  loadOverviewNotifications();
}

// ---------------------------------------------------------------
// Referral links — FIXED to point at the storefront (SS_SITE_URL),
// never the API host. Each row now has Copy + a native-share button
// that opens the phone's share sheet via the Web Share API.
// ---------------------------------------------------------------
function renderReferralLinks() {
  const grid = document.getElementById("referralLinksGrid");
  const base = SS_SITE_URL.replace(/\/$/, "");
  const code = currentAgent.code;
  const links = [
    { label: "General marketplace", url: `${base}/index.html?ref=${code}`, text: "Check out Six Star Suppliers — great deals from verified wholesalers and retailers." },
    { label: "Buyer referral (shop)", url: `${base}/register.html?ref=${code}&intent=buyer`, text: "Join me on Six Star Suppliers and start shopping!" },
    { label: "Seller recruitment", url: `${base}/register.html?ref=${code}&intent=seller`, text: "Sell your products on Six Star Suppliers and reach more customers." },
    { label: "Agent recruitment", url: `${base}/agent-apply.html?ref=${code}`, text: "Become a Six Star Suppliers agent and start earning commission." },
  ];
  grid.innerHTML = links.map((l, i) => `
    <div class="link-grid-item">
      <label>${l.label}</label>
      <div class="link-box">
        <input type="text" id="refLink${i}" value="${l.url}" readonly>
        <button class="act-btn act-outline" data-copy="refLink${i}">Copy</button>
        <button class="act-btn act-primary" data-native-share="refLink${i}" data-native-share-caption="${escapeHtml(l.text)}" title="Share"><i class="fa-solid fa-share-nodes"></i></button>
      </div>
    </div>`).join("");
  wireCopyButtons(grid);
  wireNativeShareButtons(grid);
  refreshQuickActionLinks();   // <-- add this line
}

async function loadOverviewNotifications() {
  const wrap = document.getElementById("overviewNotifList");
  try {
    const { notifications } = await SS_AGENT_API.getNotifications({ unreadOnly: false });
    const recent = notifications.slice(0, 5);
    wrap.innerHTML = recent.length
      ? recent.map(notifRowHtml).join("")
      : `<div class="dash-empty"><p>No notifications yet.</p></div>`;
  } catch (err) {
    wrap.innerHTML = `<div class="dash-empty"><p>${err.message}</p></div>`;
  }
}

// ===================================================================
// MARKETING CENTER
// ===================================================================
function wireMarketing() {
  document.getElementById("assetSearch").addEventListener("input", debounce(loadAssets, 400));
  document.getElementById("assetTypeFilter").addEventListener("change", loadAssets);
  document.getElementById("assetAudienceFilter").addEventListener("change", loadAssets);
  document.getElementById("assetSort").addEventListener("change", loadAssets);

  document.getElementById("confirmShareBtn").addEventListener("click", async () => {
    const channel = document.getElementById("assetShareChannel").value;
    try {
      const res = await SS_AGENT_API.shareAsset(activeAssetId, { channel });
      const box = document.getElementById("assetShareResult");
      box.style.display = "block";
      box.innerHTML = `
        <div class="link-box" style="margin-bottom:10px;">
          <input type="text" id="shareResLink" readonly value="${res.link}">
          <button class="act-btn act-outline" data-copy="shareResLink">Copy</button>
          <button class="act-btn act-primary" data-native-share="shareResLink" data-native-share-caption="${escapeHtml(res.caption || '')}" title="Share"><i class="fa-solid fa-share-nodes"></i></button>
        </div>
        <textarea readonly style="width:100%; padding:10px; border:1.5px solid var(--line); border-radius:8px; font-size:13px;" rows="4">${res.caption}</textarea>`;
      wireCopyButtons(box);
      wireNativeShareButtons(box);
      ssToast("Share content ready — copy and send it", "fa-share-nodes");
    } catch (err) { ssToast(err.message, "fa-triangle-exclamation"); }
  });
}

async function loadAssets() {
  const grid = document.getElementById("assetGrid");
  grid.innerHTML = `<div class="spinner"></div>`;
  try {
    const params = {
      q: document.getElementById("assetSearch").value.trim(),
      type: document.getElementById("assetTypeFilter").value,
      audience: document.getElementById("assetAudienceFilter").value,
      sort: document.getElementById("assetSort").value,
    };
    const { assets } = await SS_AGENT_API.browseAssets(params);
    assetsCache = assets;

    if (!assets.length) {
      grid.innerHTML = `<div class="dash-empty"><i class="fa-solid fa-photo-film"></i><p>No marketing assets match right now.</p></div>`;
      return;
    }

    grid.innerHTML = assets.map(assetCardHtml).join("");
    wireAssetCardEvents();
  } catch (err) {
    grid.innerHTML = `<div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div>`;
  }
}

function assetCardHtml(a) {
  const icon = { image: "fa-image", banner: "fa-panorama", video: "fa-video", flyer: "fa-file-lines", document: "fa-file-pdf" }[a.assetType] || "fa-file";
  const thumb = a.thumbnailUrl || (a.assetType === "image" || a.assetType === "banner" ? a.fileUrl : "");
  return `
    <div class="asset-card" data-asset-id="${a._id}">
      <div class="asset-card__thumb">
        ${a.isFeatured ? '<span class="asset-card__featured">Featured</span>' : ''}
        ${thumb ? `<img src="${thumb}" alt="">` : `<i class="fa-solid ${icon}"></i>`}
      </div>
      <div class="asset-card__body">
        <div class="asset-card__title">${escapeHtml(a.title)}</div>
        <div class="asset-card__meta"><span><i class="fa-solid fa-download"></i> ${a.downloadCount || 0}</span><span><i class="fa-solid fa-share-nodes"></i> ${a.shareCount || 0}</span></div>
        <div class="asset-card__actions">
          <button class="act-btn act-outline" data-download="${a._id}">Download</button>
          <button class="act-btn act-primary" data-share="${a._id}">Share</button>
          <button class="fav-btn" data-fav="${a._id}"><i class="fa-solid fa-heart"></i></button>
        </div>
      </div>
    </div>`;
}

function wireAssetCardEvents() {
  document.querySelectorAll("[data-download]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        const res = await SS_AGENT_API.downloadAsset(btn.dataset.download);
        window.open(res.fileUrl, "_blank");
        ssToast("Download started", "fa-download");
      } catch (err) { ssToast(err.message, "fa-triangle-exclamation"); }
    })
  );
  document.querySelectorAll("[data-share]").forEach((btn) =>
    btn.addEventListener("click", () => {
      activeAssetId = btn.dataset.share;
      const asset = assetsCache.find((a) => a._id === activeAssetId);
      document.getElementById("assetShareTitle").textContent = `Share — ${asset?.title || ''}`;
      document.getElementById("assetShareResult").style.display = "none";
      openModal("assetShareModal");
    })
  );
  document.querySelectorAll("[data-fav]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        const res = await SS_AGENT_API.toggleFavorite(btn.dataset.fav);
        btn.classList.toggle("is-fav", res.favorited);
        ssToast(res.favorited ? "Added to favorites" : "Removed from favorites", "fa-heart");
      } catch (err) { ssToast(err.message, "fa-triangle-exclamation"); }
    })
  );
}

async function loadMyMarketing() {
  const wrap = document.getElementById("myMarketingWrap");
  wrap.innerHTML = `<div class="spinner"></div>`;
  try {
    const { favorites, recentDownloads, recentShares } = await SS_AGENT_API.getMyMarketing();
    wrap.innerHTML = `
      <h4 style="font-size:13px; font-weight:800; margin-bottom:10px;">Favorites (${favorites.length})</h4>
      <div class="chip-row" style="margin-bottom:18px;">${favorites.length ? favorites.map((a) => `<span class="chip active">${escapeHtml(a?.title || 'Asset')}</span>`).join('') : '<span class="text-muted">No favorites yet.</span>'}</div>
      <h4 style="font-size:13px; font-weight:800; margin-bottom:10px;">Recently Downloaded</h4>
      <div class="chip-row" style="margin-bottom:18px;">${recentDownloads.length ? recentDownloads.map((d) => `<span class="chip">${escapeHtml(d.asset?.title || 'Asset')}</span>`).join('') : '<span class="text-muted">Nothing downloaded yet.</span>'}</div>
      <h4 style="font-size:13px; font-weight:800; margin-bottom:10px;">Recently Shared</h4>
      <div class="chip-row">${recentShares.length ? recentShares.map((d) => `<span class="chip">${escapeHtml(d.asset?.title || 'Asset')} · ${escapeHtml(d.channel)}</span>`).join('') : '<span class="text-muted">Nothing shared yet.</span>'}</div>`;
  } catch (err) {
    wrap.innerHTML = `<div class="dash-empty"><p>${err.message}</p></div>`;
  }
}

// ===================================================================
// CAMPAIGNS
// ===================================================================
async function loadCampaigns() {
  const grid = document.getElementById("campaignsGrid");
  grid.innerHTML = `<div class="spinner"></div>`;
  try {
    const { campaigns } = await SS_AGENT_API.listCampaigns();
    if (!campaigns.length) {
      grid.innerHTML = `<div class="dash-empty"><i class="fa-solid fa-bullhorn"></i><p>No active campaigns right now.</p></div>`;
      return;
    }
    grid.innerHTML = campaigns.map((c) => `
      <div class="campaign-card">
        <span class="pill pill-active">${escapeHtml(c.status)}</span>
        <h4>${escapeHtml(c.name)}</h4>
        <p class="text-muted">${escapeHtml(c.description || '')}</p>
        <p class="text-muted">${new Date(c.startDate).toLocaleDateString()} – ${new Date(c.endDate).toLocaleDateString()}</p>
        <div class="row-actions">
          <button class="act-btn act-outline" data-view-campaign="${c._id}">View Assets</button>
          <button class="act-btn act-primary" data-download-pack="${c._id}">Download Pack</button>
        </div>
      </div>`).join("");

    document.querySelectorAll("[data-view-campaign]").forEach((btn) =>
      btn.addEventListener("click", () => { switchTab("marketing"); document.getElementById("assetSearch").value = ""; loadAssets(); })
    );
    document.querySelectorAll("[data-download-pack]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        try {
          const res = await SS_AGENT_API.downloadCampaignPack(btn.dataset.downloadPack);
          res.files.forEach((f) => window.open(f.fileUrl, "_blank"));
          ssToast(`Opened ${res.files.length} file(s)`, "fa-download");
        } catch (err) { ssToast(err.message, "fa-triangle-exclamation"); }
      })
    );
  } catch (err) {
    grid.innerHTML = `<div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div>`;
  }
}

// ===================================================================
// SHARING & QR
// ===================================================================
function wireSharing() {
  document.getElementById("genQrBtn").addEventListener("click", async () => {
    const type = document.getElementById("qrType").value;
    try {
      const res = await SS_AGENT_API.getQr({ type });
      const box = document.getElementById("qrResultBox");
      box.style.display = "block";
      box.innerHTML = `
        <img src="${res.qrDataUrl}" alt="QR code">
        <div class="link-box">
          <input type="text" id="qrLinkOut" readonly value="${res.link}">
          <button class="act-btn act-outline" data-copy="qrLinkOut">Copy Link</button>
          <button class="act-btn act-primary" data-native-share="qrLinkOut" title="Share"><i class="fa-solid fa-share-nodes"></i></button>
        </div>
        <a href="${res.qrDataUrl}" download="referral-qr.png" class="btn btn-outline btn-sm" style="margin-top:10px; display:inline-block;">Download QR Image</a>`;
      wireCopyButtons(box);
      wireNativeShareButtons(box);
    } catch (err) { ssToast(err.message, "fa-triangle-exclamation"); }
  });

  document.getElementById("genMsgBtn").addEventListener("click", async () => {
    try {
      const res = await SS_AGENT_API.getShareMessage({
        type: document.getElementById("msgType").value,
        channel: document.getElementById("msgChannel").value,
        leadName: document.getElementById("msgLeadName").value.trim(),
      });
      document.getElementById("msgResultBox").style.display = "block";
      document.getElementById("msgResultLink").value = res.link;
      document.getElementById("msgResultText").value = res.message;
    } catch (err) { ssToast(err.message, "fa-triangle-exclamation"); }
  });

  document.getElementById("genProductShareBtn").addEventListener("click", () => {
  const raw = document.getElementById("productShareInput").value.trim();
  if (!raw) { ssToast("Paste a product link or ID first", "fa-triangle-exclamation"); return; }

  let productId = raw;
  try {
    const maybeUrl = new URL(raw, SS_SITE_URL);
    productId = maybeUrl.searchParams.get("id") || maybeUrl.searchParams.get("productId") || raw;
  } catch (_) { /* plain ID was pasted, not a URL */ }

  const base = SS_SITE_URL.replace(/\/$/, "");
  const link = `${base}/product-detail.html?id=${encodeURIComponent(productId)}&ref=${currentAgent.code}`;

  const box = document.getElementById("productShareResultBox");
  box.style.display = "block";
  document.getElementById("productShareResultLink").value = link;
  wireCopyButtons(box);
  wireNativeShareButtons(box);
  ssToast("Product link ready — copy and share it", "fa-link");
});

}

// ===================================================================
// RECRUIT
// ===================================================================
function wireRecruit() {
  document.getElementById("recruitBuyerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const channel = document.getElementById("rbChannel").value;
    const name = document.getElementById("rbName").value.trim();
    const phone = document.getElementById("rbPhone").value.trim();
    const email = document.getElementById("rbEmail").value.trim();

    if (channel === "email" && !email) {
      ssToast("Enter the recipient's email address to send an invite", "fa-triangle-exclamation");
      return;
    }

    try {
      if (channel === "email") {
        // Actually sends a branded invite email via Brevo. If the toast
        // below says "sent" but nothing ever arrives, the failure is on the
        // backend email provider side (see controllers2/sharingController.js
        // sendInvite's catch block / server logs — most likely a Brevo API
        // key or unverified-sender issue), not this button.
        const res = await SS_AGENT_API.sendInvite({ type: "buyer", email, name, phone });
        showRecruitResult("rbResult", res.link, null, true);
        ssToast(`Invitation email sent to ${email}`, "fa-paper-plane");
      } else {
        const res = await SS_AGENT_API.recruitBuyer({ name, phone, email, channel });
        if (channel === "whatsapp") {
          openWhatsApp(phone, res.message);
          showRecruitResult("rbResult", res.link, res.message, false);
          ssToast("Opening WhatsApp…", "fa-brands fa-whatsapp");
        } else {
          showRecruitResult("rbResult", res.link, res.message, false);
          ssToast("Recruitment content ready — copy and send it", "fa-user-plus");
        }
      }
      document.getElementById("recruitBuyerForm").reset();
    } catch (err) {
      ssToast(err.message, "fa-triangle-exclamation");
    }
  });

  document.getElementById("recruitSellerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const channel = document.getElementById("rsChannel").value;
    const name = document.getElementById("rsName").value.trim();
    const phone = document.getElementById("rsPhone").value.trim();
    const email = document.getElementById("rsEmail").value.trim();
    const businessName = document.getElementById("rsBusinessName").value.trim();
    const location = document.getElementById("rsLocation").value.trim();

    if (!name) {
      ssToast("Enter the lead's name", "fa-triangle-exclamation");
      return;
    }
    if (channel === "email" && !email) {
      ssToast("Enter the recipient's email address to send an invite", "fa-triangle-exclamation");
      return;
    }

    try {
      if (channel === "email") {
        // sendInvite now accepts phone/businessName/location directly and
        // logs the lead itself — no separate createLead() call needed, which
        // previously caused a duplicate lead row for every seller email invite.
        const res = await SS_AGENT_API.sendInvite({ type: "seller", email, name, phone, businessName, location });
        showRecruitResult("rsResult", res.link, null, true);
        ssToast(`Invitation email sent to ${email}`, "fa-paper-plane");
      } else {
        const res = await SS_AGENT_API.recruitSeller({ name, phone, email, businessName, location, channel });
        if (channel === "whatsapp") {
          openWhatsApp(phone, res.message);
          showRecruitResult("rsResult", res.link, res.message, false);
          ssToast("Opening WhatsApp…", "fa-brands fa-whatsapp");
        } else {
          showRecruitResult("rsResult", res.link, res.message, false);
          ssToast("Seller added to your leads", "fa-store");
        }
      }
      document.getElementById("recruitSellerForm").reset();
    } catch (err) {
      ssToast(err.message, "fa-triangle-exclamation");
    }
  });
}

// Opens WhatsApp (app on mobile, web on desktop) with the recruitment
// message pre-filled.
function openWhatsApp(phone, message) {
  const cleanPhone = (phone || "").replace(/[^\d]/g, "");
  const normalized = cleanPhone
    ? (cleanPhone.startsWith("0") ? "254" + cleanPhone.slice(1) : cleanPhone)
    : "";
  const url = normalized
    ? `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank");
}

function showRecruitResult(boxId, link, message, emailSent) {
  const box = document.getElementById(boxId);
  box.style.display = "block";
  const linkId = boxId + "_link_" + Math.random().toString(36).slice(2, 8);
  box.innerHTML = `
    ${emailSent ? `<div class="alert alert-success show" style="margin-bottom:10px;"><i class="fa-solid fa-circle-check"></i> Invitation email sent.</div>` : ''}
    <div class="link-box" style="margin-bottom:8px;">
      <input type="text" id="${linkId}" readonly value="${link}">
      <button class="act-btn act-outline" data-copy="${linkId}">Copy Link</button>
      <button class="act-btn act-primary" data-native-share="${linkId}" data-native-share-caption="${escapeHtml(message || '')}" title="Share"><i class="fa-solid fa-share-nodes"></i></button>
    </div>
    ${message ? `<textarea readonly rows="6" style="width:100%; padding:10px; border:1.5px solid var(--line); border-radius:8px; font-size:13px;">${message}</textarea>` : ''}
  `;
  wireCopyButtons(box);
  wireNativeShareButtons(box);
}

// ===================================================================
// MY LEADS (CRM)
// ===================================================================
function wireLeads() {
  document.getElementById("leadTypeFilter").addEventListener("change", loadLeads);
  document.getElementById("leadStatusFilter").addEventListener("change", loadLeads);
  document.getElementById("addLeadBtn").addEventListener("click", () => {
    document.getElementById("addLeadForm").reset();
    openModal("addLeadModal");
  });
  document.getElementById("leadType").addEventListener("change", (e) => {
    document.getElementById("leadBusinessNameField").style.display = e.target.value === "seller" ? "flex" : "none";
  });

  document.getElementById("addLeadForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await SS_AGENT_API.createLead({
        name: document.getElementById("leadName").value.trim(),
        phone: document.getElementById("leadPhone").value.trim(),
        email: document.getElementById("leadEmail").value.trim(),
        leadType: document.getElementById("leadType").value,
        businessName: document.getElementById("leadBusinessName").value.trim(),
        location: document.getElementById("leadLocation").value.trim(),
        source: "manual",
      });
      ssToast("Lead added");
      closeModal("addLeadModal");
      loadLeads();
    } catch (err) { ssToast(err.message, "fa-triangle-exclamation"); }
  });

  document.getElementById("saveLeadDetailBtn").addEventListener("click", async () => {
    try {
      await SS_AGENT_API.updateLead(activeLeadId, {
        status: document.getElementById("leadDetailStatus").value,
        followUpDate: document.getElementById("leadDetailFollowUp").value || null,
      });
      ssToast("Lead updated");
      loadLeads();
    } catch (err) { ssToast(err.message, "fa-triangle-exclamation"); }
  });

  document.getElementById("addLeadNoteBtn").addEventListener("click", async () => {
    const input = document.getElementById("leadNewNote");
    const text = input.value.trim();
    if (!text) return;
    try {
      const { lead } = await SS_AGENT_API.addLeadNote(activeLeadId, text);
      input.value = "";
      renderLeadNotes(lead.notes);
    } catch (err) { ssToast(err.message, "fa-triangle-exclamation"); }
  });

  document.getElementById("deleteLeadBtn").addEventListener("click", async () => {
    if (!confirm("Delete this lead permanently?")) return;
    try {
      await SS_AGENT_API.deleteLead(activeLeadId);
      ssToast("Lead deleted");
      closeModal("leadDetailModal");
      loadLeads();
    } catch (err) { ssToast(err.message, "fa-triangle-exclamation"); }
  });
}

async function loadFollowups() {
  const wrap = document.getElementById("followupsList");
  try {
    const { leads } = await SS_AGENT_API.getFollowups();
    wrap.innerHTML = leads.length
      ? leads.map((l) => `<div class="notif-row"><div class="notif-dot"></div><div><div class="notif-title">${escapeHtml(l.name)} <span class="pill pill-${l.leadType}">${l.leadType}</span></div><div class="notif-msg">Follow up due — currently "${l.status.replace(/_/g,' ')}"</div></div></div>`).join("")
      : `<div class="dash-empty"><p>No follow-ups due right now.</p></div>`;
  } catch (err) {
    wrap.innerHTML = `<div class="dash-empty"><p>${err.message}</p></div>`;
  }
}

async function loadLeads() {
  const tbody = document.getElementById("leadsBody");
  tbody.innerHTML = `<tr><td colspan="7"><div class="spinner"></div></td></tr>`;
  try {
    const params = { type: document.getElementById("leadTypeFilter").value, status: document.getElementById("leadStatusFilter").value };
    const { leads } = await SS_AGENT_API.getLeads(params);
    leadsCache = leads;

    if (!leads.length) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="dash-empty"><i class="fa-solid fa-address-book"></i><p>No leads yet.</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = leads.map((l) => `
      <tr>
        <td><strong>${escapeHtml(l.name)}</strong>${l.businessName ? `<div class="text-muted">${escapeHtml(l.businessName)}</div>` : ''}</td>
        <td><span class="pill pill-${l.leadType}">${l.leadType}</span></td>
        <td class="text-muted">${escapeHtml(l.phone || l.email || '—')}</td>
        <td class="text-muted">${escapeHtml(l.source)}</td>
        <td><span class="pill">${l.status.replace(/_/g, ' ')}</span></td>
        <td class="text-muted">${l.lastContactAt ? new Date(l.lastContactAt).toLocaleDateString() : '—'}</td>
        <td><button class="act-btn act-outline" data-view-lead="${l._id}">Open</button></td>
      </tr>`).join("");

    tbody.querySelectorAll("[data-view-lead]").forEach((btn) =>
      btn.addEventListener("click", () => openLeadDetail(leadsCache.find((l) => l._id === btn.dataset.viewLead)))
    );
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="dash-empty"><p>${err.message}</p></div></td></tr>`;
  }
}

function openLeadDetail(lead) {
  if (!lead) return;
  activeLeadId = lead._id;
  document.getElementById("leadDetailName").textContent = lead.name;
  document.getElementById("leadDetailStatus").value = lead.status;
  document.getElementById("leadDetailFollowUp").value = lead.followUpDate ? lead.followUpDate.slice(0, 10) : "";
  renderLeadNotes(lead.notes || []);
  openModal("leadDetailModal");
}

function renderLeadNotes(notes) {
  const wrap = document.getElementById("leadNotesList");
  wrap.innerHTML = notes.length
    ? notes.slice().reverse().map((n) => `<div class="lead-note-item">${escapeHtml(n.text)}<time>${new Date(n.createdAt).toLocaleString()}</time></div>`).join("")
    : `<div class="text-muted">No notes yet.</div>`;
}

// ===================================================================
// COMMISSIONS
// ===================================================================
document.addEventListener("change", (e) => {
  if (e.target.id === "commissionStatusFilter") loadCommissions();
});

async function loadCommissions() {
  const statsGrid = document.getElementById("commissionStats");
  statsGrid.innerHTML = `<div class="stat-card"><div class="spinner"></div></div>`.repeat(4);
  try {
    const summary = await SS_AGENT_API.getMyCommissionSummary();
    const s = summary.summary;
    statsGrid.innerHTML = `
      <div class="stat-card"><div class="stat-label">Pending</div><div class="stat-value">KES ${(s.pending||0).toLocaleString()}</div></div>
      <div class="stat-card"><div class="stat-label">Processing</div><div class="stat-value">KES ${(s.processing||0).toLocaleString()}</div></div>
      <div class="stat-card tone-price"><div class="stat-label">Confirmed</div><div class="stat-value">KES ${(s.confirmed||0).toLocaleString()}</div></div>
      <div class="stat-card"><div class="stat-label">Cancelled / Reversed</div><div class="stat-value">KES ${((s.cancelled||0)+(s.reversed||0)).toLocaleString()}</div></div>
    `;
  } catch (err) { statsGrid.innerHTML = `<div class="dash-empty"><p>${err.message}</p></div>`; }

  const tbody = document.getElementById("commissionsBody");
  tbody.innerHTML = `<tr><td colspan="7"><div class="spinner"></div></td></tr>`;
  try {
    const status = document.getElementById("commissionStatusFilter").value;
    const { commissions } = await SS_AGENT_API.getMyCommissions(status ? { status } : {});
    commissionsCache = commissions;

    if (!commissions.length) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="dash-empty"><i class="fa-solid fa-sack-dollar"></i><p>No commissions yet.</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = commissions.map((c) => `
      <tr>
        <td><span class="agent-code">${escapeHtml(c.order?.orderNumber || '—')}</span></td>
        <td><span class="pill pill-${c.referralType.includes('buyer') ? 'buyer' : 'seller'}">${c.referralType.replace('_referral','')}</span></td>
        <td>KES ${(c.marketplaceProfit||0).toLocaleString()}</td>
        <td>${c.commissionRate}%</td>
        <td><strong>KES ${(c.commissionAmount||0).toLocaleString()}</strong></td>
        <td><span class="pill pill-${c.status}">${c.status}</span></td>
        <td class="text-muted">${new Date(c.createdAt).toLocaleDateString()}</td>
      </tr>`).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="dash-empty"><p>${err.message}</p></div></td></tr>`;
  }
}

// ===================================================================
// ANALYTICS
// ===================================================================
async function loadAnalytics() {
  try {
    const data = await SS_AGENT_API.getMyAnalytics();
    document.getElementById("analyticsMarketingStats").innerHTML = `
      <div class="stat-card"><div class="stat-label">Referral Clicks</div><div class="stat-value">${data.marketing.referralClicks||0}</div></div>
      <div class="stat-card"><div class="stat-label">Assets Downloaded</div><div class="stat-value">${data.marketing.assetsDownloaded||0}</div></div>
      <div class="stat-card"><div class="stat-label">Assets Shared</div><div class="stat-value">${data.marketing.assetsShared||0}</div></div>`;

    document.getElementById("analyticsCommissionStats").innerHTML = `
      <div class="stat-card"><div class="stat-label">Pending</div><div class="stat-value">KES ${(data.commissions.pending||0).toLocaleString()}</div></div>
      <div class="stat-card tone-price"><div class="stat-label">Confirmed</div><div class="stat-value">KES ${(data.commissions.confirmed||0).toLocaleString()}</div></div>
      <div class="stat-card"><div class="stat-label">Cancelled</div><div class="stat-value">KES ${(data.commissions.cancelled||0).toLocaleString()}</div></div>
      <div class="stat-card"><div class="stat-label">Reversed</div><div class="stat-value">KES ${(data.commissions.reversed||0).toLocaleString()}</div></div>`;
  } catch (err) { ssToast(err.message, "fa-triangle-exclamation"); }

  const tbody = document.getElementById("channelAnalyticsBody");
  tbody.innerHTML = `<tr><td colspan="2"><div class="spinner"></div></td></tr>`;
  try {
    const { channels } = await SS_AGENT_API.getMyChannelAnalytics();
    tbody.innerHTML = channels.length
      ? channels.map((c) => `<tr><td style="text-transform:capitalize;">${escapeHtml(c._id)}</td><td>${c.clicks}</td></tr>`).join("")
      : `<tr><td colspan="2"><div class="dash-empty"><p>No channel data yet.</p></div></td></tr>`;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="2"><div class="dash-empty"><p>${err.message}</p></div></td></tr>`;
  }
}

// ===================================================================
// LEADERBOARD
// ===================================================================
function wireLeaderboardFilter() {
  document.getElementById("leaderboardMetric").addEventListener("change", loadLeaderboard);
}
document.addEventListener("DOMContentLoaded", wireLeaderboardFilter);

async function loadLeaderboard() {
  const list = document.getElementById("leaderboardList");
  list.innerHTML = `<div class="spinner"></div>`;
  try {
    const metric = document.getElementById("leaderboardMetric").value;
    const { agents } = await SS_AGENT_API.getLeaderboard({ metric, limit: 20 });
    if (!agents.length) { list.innerHTML = `<div class="dash-empty"><p>No agents to rank yet.</p></div>`; return; }

    list.innerHTML = agents.map((a, i) => {
      const rankClass = i === 0 ? "top1" : i === 1 ? "top2" : i === 2 ? "top3" : "";
      const isMe = a._id === currentAgent._id;
      const val = metric === "totalCommission" || metric === "lifetimeMarketplaceProfit"
        ? `KES ${(a[metric]||0).toLocaleString()}`
        : (a[metric] || 0);
      const avatarHtml = a.avatar
        ? `<img src="${a.avatar}" class="agent-avatar agent-avatar--xs" alt="">`
        : `<div class="agent-avatar agent-avatar--xs agent-avatar--fallback"><i class="fa-solid fa-user"></i></div>`;
      return `
        <div class="leaderboard-row" style="${isMe ? 'background:#FFF6EF;' : ''}">
          <div class="leaderboard-rank ${rankClass}">${i + 1}</div>
          ${avatarHtml}
          <div class="leaderboard-name">${escapeHtml(a.name)}${isMe ? ' <span class="pill pill-active">You</span>' : ''}${a.badge ? ` <span class="pill">${escapeHtml(a.badge.name)}</span>` : ''}</div>
          <div class="leaderboard-value">${val}</div>
        </div>`;
    }).join("");
  } catch (err) {
    list.innerHTML = `<div class="dash-empty"><p>${err.message}</p></div>`;
  }
}

// ===================================================================
// ACHIEVEMENTS
// ===================================================================
async function loadAchievements() {
  const grid = document.getElementById("achievementsGrid");
  grid.innerHTML = `<div class="spinner"></div>`;
  try {
    const [defs, mine] = await Promise.all([SS_AGENT_API.getAchievementDefs(), SS_AGENT_API.getMyAchievements()]);
    const earnedKeys = new Set(mine.achievements.map((a) => a.achievement?.key));
    grid.innerHTML = defs.achievements.map((d) => `
      <div class="achv-card ${earnedKeys.has(d.key) ? 'earned' : 'locked'}">
        <div class="achv-icon">${d.icon}</div>
        <div class="achv-name">${escapeHtml(d.name)}</div>
        <div class="achv-desc">${escapeHtml(d.description)}</div>
      </div>`).join("");
  } catch (err) {
    grid.innerHTML = `<div class="dash-empty"><p>${err.message}</p></div>`;
  }
}

// ===================================================================
// ACADEMY
// ===================================================================
async function loadAcademy() {
  const grid = document.getElementById("academyGrid");
  grid.innerHTML = `<div class="spinner"></div>`;
  try {
    const { resources } = await SS_AGENT_API.getAcademy();
    grid.innerHTML = resources.length
      ? resources.map((a) => `
        <div class="asset-card">
          <div class="asset-card__thumb">${a.thumbnailUrl ? `<img src="${a.thumbnailUrl}">` : `<i class="fa-solid fa-graduation-cap"></i>`}</div>
          <div class="asset-card__body">
            <div class="asset-card__title">${escapeHtml(a.title)}</div>
            <p class="text-muted" style="font-size:11.5px;">${escapeHtml(a.description || '')}</p>
            <a class="btn btn-outline btn-sm" href="${a.fileUrl}" target="_blank">Open</a>
          </div>
        </div>`).join("")
      : `<div class="dash-empty"><i class="fa-solid fa-graduation-cap"></i><p>No Academy content published yet.</p></div>`;
  } catch (err) {
    grid.innerHTML = `<div class="dash-empty"><p>${err.message}</p></div>`;
  }
}

// ===================================================================
// NOTIFICATIONS
// ===================================================================
function notifRowHtml(n) {
  return `
    <div class="notif-row ${n.isRead ? 'read' : 'unread'}" data-notif-id="${n._id}">
      <div class="notif-dot"></div>
      <div style="flex:1;">
        <div class="notif-title">${escapeHtml(n.title)}</div>
        <div class="notif-msg">${escapeHtml(n.message)}</div>
        <div class="notif-time">${new Date(n.createdAt).toLocaleString()}</div>
      </div>
      ${!n.isRead ? `<button class="act-btn act-outline" data-mark-read="${n._id}">Mark read</button>` : ''}
    </div>`;
}

async function refreshNotifBadge() {
  try {
    const { count } = await SS_AGENT_API.getNotifications({ unreadOnly: true });
    const badge = document.getElementById("notifBadge");
    if (count > 0) { badge.style.display = "inline-block"; badge.textContent = count; }
    else badge.style.display = "none";
  } catch (_) {}
}

async function loadFullNotifications() {
  const wrap = document.getElementById("notifFullList");
  wrap.innerHTML = `<div class="spinner"></div>`;
  try {
    const { notifications } = await SS_AGENT_API.getNotifications();
    wrap.innerHTML = notifications.length
      ? notifications.map(notifRowHtml).join("")
      : `<div class="dash-empty"><i class="fa-solid fa-bell"></i><p>No notifications yet.</p></div>`;

    wrap.querySelectorAll("[data-mark-read]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        await SS_AGENT_API.markNotificationRead(btn.dataset.markRead);
        loadFullNotifications();
        refreshNotifBadge();
      })
    );
  } catch (err) {
    wrap.innerHTML = `<div class="dash-empty"><p>${err.message}</p></div>`;
  }

  document.getElementById("markAllReadBtn").onclick = async () => {
    try {
      await SS_AGENT_API.markAllNotificationsRead();
      ssToast("All notifications marked as read");
      loadFullNotifications();
      refreshNotifBadge();
    } catch (err) { ssToast(err.message, "fa-triangle-exclamation"); }
  };
}

// ===================================================================
// PROFILE
// ===================================================================
function wireProfile() {
  // Live preview the instant a new photo is picked, before saving.
  document.getElementById("profAvatarInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    renderAvatar("profileAvatarPreview", "profileAvatarFallback", url);
  });

  document.getElementById("profileForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append("name", document.getElementById("profName").value.trim());
    fd.append("phone", document.getElementById("profPhone").value.trim());
    fd.append("location", document.getElementById("profLocation").value.trim());
    fd.append("bio", document.getElementById("profBio").value.trim());
    const avatarFile = document.getElementById("profAvatarInput").files[0];
    if (avatarFile) fd.append("avatar", avatarFile);

    try {
      const res = await SS_AGENT_API.updateMe(fd);
      currentAgent = res.agent;
      SS_AGENT_AUTH.set(res.agent);
      document.getElementById("agentNameLabel").textContent = res.agent.name;
      renderAvatar("sidebarAvatarImg", "sidebarAvatarFallback", res.agent.avatar);
      renderAvatar("profileAvatarPreview", "profileAvatarFallback", res.agent.avatar);
      ssToast("Profile updated");
    } catch (err) { ssToast(err.message, "fa-triangle-exclamation"); }
  });

  document.getElementById("passwordForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await SS_AGENT_API.changePassword({
        currentPassword: document.getElementById("curPassword").value,
        newPassword: document.getElementById("newPassword").value,
      });
      ssToast("Password updated");
      document.getElementById("passwordForm").reset();
    } catch (err) { ssToast(err.message, "fa-triangle-exclamation"); }
  });
}

function loadProfileForm() {
  document.getElementById("profName").value = currentAgent.name || "";
  document.getElementById("profPhone").value = currentAgent.phone || "";
  document.getElementById("profLocation").value = currentAgent.location || "";
  document.getElementById("profBio").value = currentAgent.bio || "";
  renderAvatar("profileAvatarPreview", "profileAvatarFallback", currentAgent.avatar);
  loadPayoutForm();
}

// ===================================================================
// PAYOUT DETAILS (NEW)
// ===================================================================
function wirePayout() {
  document.querySelectorAll('#payoutMethodChips input[name="payoutMethod"]').forEach((radio) => {
    radio.addEventListener("change", () => togglePayoutFields(radio.value));
    radio.closest(".channel-chip").addEventListener("click", () => {
      document.querySelectorAll('#payoutMethodChips .channel-chip').forEach((c) => c.classList.remove("active"));
      radio.closest(".channel-chip").classList.add("active");
    });
  });

  document.getElementById("payoutForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const method = document.querySelector('#payoutMethodChips input[name="payoutMethod"]:checked').value;

    const payout = {
      method,
      idNumber: document.getElementById("payoutIdNumber").value.trim(),
      mpesaNumber: document.getElementById("payoutMpesaNumber").value.trim(),
      mpesaName: document.getElementById("payoutMpesaName").value.trim(),
      bankName: document.getElementById("payoutBankName").value.trim(),
      accountName: document.getElementById("payoutAccountName").value.trim(),
      accountNumber: document.getElementById("payoutAccountNumber").value.trim(),
      branchName: document.getElementById("payoutBranchName").value.trim(),
    };

    if (!payout.idNumber) {
      ssToast("Enter the ID number registered on this account", "fa-triangle-exclamation");
      return;
    }
    if (method === "mpesa" && !payout.mpesaNumber) {
      ssToast("Enter your M-Pesa number", "fa-triangle-exclamation");
      return;
    }
    if (method === "bank" && (!payout.accountNumber || !payout.bankName)) {
      ssToast("Enter your bank name and account number", "fa-triangle-exclamation");
      return;
    }

    const fd = new FormData();
    fd.append("payout", JSON.stringify(payout));

    try {
      const res = await SS_AGENT_API.updateMe(fd);
      currentAgent = res.agent;
      SS_AGENT_AUTH.set(res.agent);
      ssToast("Payout details saved");
    } catch (err) { ssToast(err.message, "fa-triangle-exclamation"); }
  });
}

function togglePayoutFields(method) {
  document.getElementById("payoutMpesaFields").style.display = method === "mpesa" ? "grid" : "none";
  document.getElementById("payoutBankFields").style.display = method === "bank" ? "block" : "none";
}

function loadPayoutForm() {
  const payout = currentAgent.payout || {};
  const method = payout.method || "mpesa";

  document.querySelectorAll('#payoutMethodChips input[name="payoutMethod"]').forEach((radio) => {
    radio.checked = radio.value === method;
    radio.closest(".channel-chip").classList.toggle("active", radio.value === method);
  });
  togglePayoutFields(method);

  document.getElementById("payoutIdNumber").value = payout.idNumber || "";
  document.getElementById("payoutMpesaNumber").value = payout.mpesaNumber || "";
  document.getElementById("payoutMpesaName").value = payout.mpesaName || "";
  document.getElementById("payoutBankName").value = payout.bankName || "";
  document.getElementById("payoutAccountName").value = payout.accountName || "";
  document.getElementById("payoutAccountNumber").value = payout.accountNumber || "";
  document.getElementById("payoutBranchName").value = payout.branchName || "";
}

// ===================================================================
// MODAL / UTIL HELPERS
// ===================================================================
function openModal(id) { document.getElementById(id).classList.add("show"); }
function closeModal(id) { document.getElementById(id).classList.remove("show"); }
function wireModalCloseButtons() {
  document.querySelectorAll("[data-close-modal]").forEach((btn) => btn.addEventListener("click", () => closeModal(btn.dataset.closeModal)));
  document.querySelectorAll(".modal-overlay").forEach((overlay) => overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.remove("show"); }));
}

function wireCopyButtons(scope) {
  scope.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.copy);
      if (!input) return;
      navigator.clipboard.writeText(input.value).then(() => ssToast("Copied to clipboard", "fa-copy"));
    });
  });
}

// NEW — native share (Web Share API) with graceful fallback. Opens the
// phone's OS share sheet automatically on mobile; falls back to copying
// the link on desktop browsers that don't support navigator.share.
function wireNativeShareButtons(scope) {
  scope.querySelectorAll("[data-native-share]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const input = document.getElementById(btn.dataset.nativeShare);
      if (!input) return;
      const url = input.value;
      const captionAttr = btn.dataset.nativeShareCaption;
      const captionFromField = btn.dataset.nativeShareText ? document.getElementById(btn.dataset.nativeShareText)?.value : "";
      const text = captionAttr || captionFromField || "Six Star Suppliers";

      if (navigator.share) {
        try {
          await navigator.share({ title: "Six Star Suppliers", text, url });
        } catch (err) {
          // AbortError = user cancelled the share sheet — not an error worth toasting.
          if (err.name !== "AbortError") ssToast("Couldn't open share sheet", "fa-triangle-exclamation");
        }
      } else {
        navigator.clipboard.writeText(url).then(() => ssToast("Sharing isn't supported here — link copied instead", "fa-copy"));
      }
    });
  });
}

function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function debounce(fn, delay) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}