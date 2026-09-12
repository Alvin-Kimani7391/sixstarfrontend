import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from './api.js';
import { showToast } from './toast.js';
import { wireRFQTab, loadRFQs } from './admin-rfq.js';

// ===================================================================
// STATE
// ===================================================================
let currentUser = null;
let categoriesCache = []; // used to populate <select> dropdowns everywhere
let attributesCache = []; // all attribute definitions (admin management + assignment picker)
let productFilters = { status: '', search: '', category: '', page: 1 };
let userFilters = { role: '' };
let orderSubTab = 'pending-payment';
let earningsFilters = { paymentStatus: 'confirmed', from: '', to: '', search: '', page: 1 };
let earningsOrdersCache = [];
let expandedCategoryIds = new Set();
let feeTiersCache = []; // NEW — seller transaction-fee ladder


// NEW — Dynamic Shipping state
let weightTiersCache = [];
let shipCritGroupsCache = [];      // criteria groups for whichever category is currently open
let shipCritTargetCategoryId = null;
let shipCritOptionRows = [];       // working option rows for the group modal: [{localId,_id,label,price,isActive}]
let shipCritOptionRowSeq = 0;
let shipCritEditingGroupId = null;


let townLocationsCache = [];
let townLocFilters = { search: '', county: '' };



// caches backing the expandable rows
let allOrdersCache = [];      // last fetched "all orders" list, keyed by lookup below
let agentOrdersCache = {};    // agentId -> orders[] (lazy-loaded on first expand)
// NEW — Agent/Marketing system state
let agentsSubtab = 'list';
let agentsCache = [];
let badgesCache = [];
let agentFilters = { search: '', status: '' };

let marketingSubtab = 'assets';
let assetsCache = [];
let assetFilters = { search: '', status: '', audience: '' };
let campaignsCache = [];

let commissionsSubtab = 'ledger';
let commLedgerFilters = { status: '', referralType: '' };
let rulesCache = [];
let adjustmentsCache = [];

let agentLeadsCache = [];
let alFilters = { type: '', status: '' };

let fraudSubtab = 'events';
let fraudFilters = { status: '', severity: '' };
let auditFilters = { search: '', page: 1 };
let auditLogsCache = [];

const ASSET_CHANNELS = ['whatsapp', 'email', 'facebook', 'instagram', 'tiktok', 'linkedin', 'x', 'qr', 'direct', 'other'];




// working state for the category-attributes assignment modal
let catAttrAssigned = []; // [{ attributeId, name, isRequired }] in display order
let catAttrTargetCategoryId = null;

// shops state
let shopFilters = { status: '', search: '' };
let shopsCache = [];

// seller verification state
let verifFilters = { status: 'pending', search: '' };
let verificationsCache = [];
// Lookup of EVERY verification record (regardless of status), keyed by seller._id.
// Used to show pickup/warehouse location on order rows anywhere in the dashboard,
// without needing a new backend endpoint.
let verificationsBySellerId = {};

// legal documents state
let legalDocsCache = [];
const LEGAL_DOC_TYPES = [
  'terms_and_conditions', 'seller_agreement', 'privacy_policy', 'data_protection_agreement',
  'product_listing_policy', 'prohibited_products_policy', 'anti_counterfeit_policy', 'returns_policy',
  'refund_policy', 'shipping_policy', 'payments_commission_policy', 'seller_performance_policy',
  'cosmetics_compliance_policy', 'seller_code_of_conduct', 'intellectual_property_policy',
  'account_suspension_policy', 'seller_fees_schedule', 'advertising_promotions_policy',
  'seller_verification_policy', 'community_guidelines', 'other',
];

// flash sale state
let flashSaleFilters = { subtab: 'pending_review', search: '' };
let flashSalesCache = [];

const FS_SUBTAB_STATUSES = {
  pending_review: ['pending_review'],
  live: ['approved', 'scheduled', 'active', 'sold_out'],
  history: ['ended', 'rejected', 'cancelled'],
};

const FLASH_SALE_STATUS_LABEL = {
  pending_review: 'Pending review',
  approved: 'Approved',
  scheduled: 'Scheduled',
  active: 'Live now',
  sold_out: 'Sold out',
  ended: 'Ended',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};
const FLASH_SALE_STATUS_ICON = {
  pending_review: 'fa-hourglass-half',
  approved: 'fa-circle-check',
  scheduled: 'fa-calendar-check',
  active: 'fa-bolt',
  sold_out: 'fa-box-open',
  ended: 'fa-flag-checkered',
  rejected: 'fa-circle-xmark',
  cancelled: 'fa-ban',
};
const FLASH_SALE_PILL_CLASS = {
  pending_review: 'pill-pending_review',
  approved: 'pill-approved',
  scheduled: 'pill-scheduled',
  active: 'pill-active',
  sold_out: 'pill-sold_out',
  ended: 'pill-ended',
  rejected: 'pill-rejected',
  cancelled: 'pill-cancelled',
};

const CATEGORY_LABELS = {
  phones: 'Phones', electronics: 'Electronics', fashion: 'Fashion', beauty: 'Beauty',
  groceries: 'Groceries', home_living: 'Home & Living', industrial: 'Industrial',
  automotive: 'Automotive', agriculture: 'Agriculture',
};

const BUSINESS_AGE_LABELS = {
  lt_6m: 'Under 6 months', '6_12m': '6 – 12 months', '1_3y': '1 – 3 years', gt_3y: 'Over 3 years',
};

const MAX_CATEGORY_LEVEL = 2; // 0 = Parent Category, 1 = Category, 2 = Sub Category

// ===================================================================
// BOOT
// ===================================================================
document.addEventListener('DOMContentLoaded', init);

async function init() {
  wireLoginForm();
  wireSidebar();
  wireModalCloseButtons();
  wireStaticButtons();
  populateLegalTypeSelect();
  wireRFQTab();
  await checkAuth();
}

async function checkAuth() {
  try {
    const { user } = await apiGet('/auth/me');
    if (user.role !== 'admin') {
      showGate('This account is not an admin. Please log in with an admin account.');
      return;
    }
    currentUser = user;
    showDashboard();
  } catch (err) {
    showGate();
  }
}

function showGate(message) {
  document.getElementById('loginGate').style.display = 'flex';
  document.getElementById('dashboardRoot').style.display = 'none';
  const errEl = document.getElementById('loginError');
  if (message) {
    errEl.textContent = message;
    errEl.classList.add('show');
  } else {
    errEl.classList.remove('show');
  }
}

async function showDashboard() {
  document.getElementById('loginGate').style.display = 'none';
  document.getElementById('dashboardRoot').style.display = 'grid';
  document.getElementById('adminNameLabel').textContent = currentUser.name;

  await loadCategoriesCache();
  await loadAttributesCache();
  loadVerificationsLookup(); // fire-and-forget: powers pickup-location on order rows everywhere
  switchTab('overview');
}

function wireLoginForm() {
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Logging in...';
    try {
      await apiPost('/auth/login', { email, password });
      await checkAuth();
    } catch (err) {
      showGate(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Log In';
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try {
      await apiPost('/auth/logout');
    } catch (err) {
      /* ignore */
    }
    currentUser = null;
    showGate();
  });
}

// ===================================================================
// SIDEBAR / TABS
// ===================================================================
function wireSidebar() {
  document.querySelectorAll('.admin-nav button[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
      closeMobileSidebar();
    });
  });

  document.getElementById('sidebarToggle').addEventListener('click', () => {
    document.getElementById('adminSidebar').classList.add('active');
    document.getElementById('adminOverlay').classList.add('active');
  });
  document.getElementById('adminOverlay').addEventListener('click', closeMobileSidebar);
}

function closeMobileSidebar() {
  document.getElementById('adminSidebar').classList.remove('active');
  document.getElementById('adminOverlay').classList.remove('active');
}

function switchTab(tab) {
  document.querySelectorAll('.admin-nav button[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${tab}`));
  document.getElementById('topbarTitle').textContent = document.querySelector(`.admin-nav button[data-tab="${tab}"]`).textContent.trim();

  if (tab === 'overview') loadOverview();
  if (tab === 'pending') loadPendingProducts();
  if (tab === 'products') loadAllProducts();
  if (tab === 'categories') loadCategoriesTable();
  if (tab === 'attributes') loadAttributes();
  if (tab === 'shipping') loadWeightTiers();
    if (tab === 'townlocations') loadTownLocations();
  if (tab === 'shops') loadShops();
  if (tab === 'verification') loadVerifications();
  if (tab === 'legal') loadLegalDocuments();
  if (tab === 'ads') loadAds();
  if (tab === 'flashsales') loadFlashSales();
  if (tab === 'orders') loadOrdersTab();
  if (tab === 'users') loadUsers();
  if (tab === 'agents') loadAgentsTab();
  if (tab === 'marketing') loadMarketingTab();
  if (tab === 'campaigns') loadCampaigns();
  if (tab === 'commissions') loadCommissionsTab();
  if (tab === 'agentleads') loadAgentLeads();
  if (tab === 'fraud') loadFraudTab();
  if (tab === 'rfq') loadRFQs();
  if (tab === 'earnings') loadEarnings();
}

// ===================================================================
// OVERVIEW
// ===================================================================
async function loadOverview() {
  const grid = document.getElementById('statGrid');
  grid.innerHTML = `<div class="stat-card"><div class="spinner"></div></div>`.repeat(6);

  try {
    const [pending, payments, stkIssues, products, users, pendingFlash] = await Promise.all([
      apiGet('/admin/products/pending'),
      apiGet('/admin/orders/pending-payment'),
      apiGet('/admin/orders/stk-issues'),
      apiGet('/admin/products?limit=1'),
      apiGet('/admin/users'),
      apiGet('/admin/flash-sales/pending').catch(() => ({ count: 0, flashSales: [] })),
    ]);

    const wholesalers = users.users.filter((u) => u.role === 'wholesaler').length;
    const retailers = users.users.filter((u) => u.role === 'retailer').length;
    const buyers = users.users.filter((u) => u.role === 'buyer').length;

    const pendingFlashCount = pendingFlash.count ?? (pendingFlash.flashSales || []).length;

    grid.innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Pending Products</div>
        <div class="stat-value">${pending.count}</div>
        <div class="stat-sub">Awaiting price approval</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Pending Payments</div>
        <div class="stat-value">${payments.count}</div>
        <div class="stat-sub">Manual M-Pesa needs verification</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">STK Push Issues</div>
        <div class="stat-value">${stkIssues.count}</div>
        <div class="stat-sub">Failed or unresolved M-Pesa STK</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Flash Sale Review</div>
        <div class="stat-value">${pendingFlashCount}</div>
        <div class="stat-sub">Awaiting Flash Sale approval</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Products</div>
        <div class="stat-value">${products.total ?? products.count}</div>
        <div class="stat-sub">All statuses combined</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Sellers / Buyers</div>
        <div class="stat-value">${wholesalers + retailers} / ${buyers}</div>
        <div class="stat-sub">${wholesalers} wholesalers · ${retailers} retailers</div>
      </div>
    `;
  } catch (err) {
    grid.innerHTML = `<div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div>`;
  }
}

// ===================================================================
// CATEGORIES CACHE (used by product edit/create dropdowns)
// ===================================================================
async function loadCategoriesCache() {
  try {
    const { categories } = await apiGet('/admin/categories');
    categoriesCache = categories;
  } catch (err) {
    categoriesCache = [];
  }
}

function categoryOptionsHtml(selectedId) {
  return categoriesCache
    .map((c) => `<option value="${c._id}" ${c._id === selectedId ? 'selected' : ''}>${c.name}${!c.isActive ? ' (inactive)' : ''}</option>`)
    .join('');
}

// Whether a category currently has any active children (i.e. it's a leaf where
// products/attributes attach). Mirrors the backend's isLeafCategory check.
function isLeafCategoryLocal(categoryId) {
  return !categoriesCache.some((c) => {
    const parentId = c.parentCategory?._id || c.parentCategory;
    return String(parentId) === String(categoryId) && c.isActive;
  });
}

// ===================================================================
// ATTRIBUTES CACHE (used by the category-attribute assignment modal)
// ===================================================================
async function loadAttributesCache() {
  try {
    const { attributes } = await apiGet('/admin/attributes');
    attributesCache = attributes;
  } catch (err) {
    attributesCache = [];
  }
}

// ===================================================================
// PENDING PRODUCTS (approval + price-setting gate)
// ===================================================================
async function loadPendingProducts() {
  const tbody = document.getElementById('pendingProductsBody');
  tbody.innerHTML = `<tr><td colspan="7"><div class="spinner"></div></td></tr>`;

  try {
    const { products } = await apiGet('/admin/products/pending');
    if (products.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="dash-empty"><i class="fa-solid fa-clipboard-check"></i><p>Nothing waiting for review right now.</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = products
      .map(
        (p) => `
      <tr>
        <td>${p.images?.[0] ? `<img class="thumb" src="${p.images[0]}" alt="">` : ''}</td>
        <td class="wrap-cell"><strong>${escapeHtml(p.name)}</strong>${p.status === 'pending_review' && p.reviewedAt === null && p.reviewedBy === null && p.finalPrice != null ? ' <span class="pill pill-active">Re-review (was live)</span>' : ''}</td>
        <td>${escapeHtml(p.seller?.businessName || p.seller?.shopName || p.seller?.name || '-')} <span class="pill pill-${p.sellerRole}">${p.sellerRole}</span></td>
        <td>${escapeHtml(p.category?.name || '-')}</td>
        <td>KSh ${p.sellerPrice?.toLocaleString()}</td>
        <td>${p.stock}</td>
        <td>
          <div class="row-actions">
            <button class="act-approve" data-approve="${p._id}">Approve</button>
            <button class="act-reject" data-reject="${p._id}">Reject</button>
          </div>
        </td>
      </tr>`
      )
      .join('');

    tbody.querySelectorAll('[data-approve]').forEach((btn) =>
      btn.addEventListener('click', () => openApproveModal(products.find((p) => p._id === btn.dataset.approve)))
    );
    tbody.querySelectorAll('[data-reject]').forEach((btn) =>
      btn.addEventListener('click', () => openRejectModal(btn.dataset.reject))
    );
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

function openApproveModal(product) {
  const modal = document.getElementById('approveModal');
  modal.querySelector('[data-field="name"]').textContent = product.name;
  modal.querySelector('[data-field="sellerPrice"]').textContent = product.sellerPrice?.toLocaleString();
  modal.querySelector('#approveFinalPrice').value = product.finalPrice || product.sellerPrice || '';
  modal.querySelector('#approveDiscount').value = product.discountPercent || 0;
  modal.querySelector('#approveHotDeal').checked = !!product.isHotDeal;
  modal.dataset.productId = product._id;
  openModal('approveModal');
}

function wireStaticButtons() {
  document.getElementById('approveForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const modal = document.getElementById('approveModal');
    const id = modal.dataset.productId;
    const finalPrice = Number(document.getElementById('approveFinalPrice').value);
    const discountPercent = Number(document.getElementById('approveDiscount').value) || 0;
    const isHotDeal = document.getElementById('approveHotDeal').checked;

    try {
      await apiPatch(`/admin/products/${id}/approve`, { finalPrice, discountPercent, isHotDeal });
      showToast('Product approved and is now live');
      closeModal('approveModal');
      loadPendingProducts();
      loadOverview();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('rejectForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const modal = document.getElementById('rejectModal');
    const id = modal.dataset.productId;
    const reason = document.getElementById('rejectReason').value.trim();
    try {
      await apiPatch(`/admin/products/${id}/reject`, { reason });
      showToast('Product rejected and sent back to the seller');
      closeModal('rejectModal');
      loadPendingProducts();
      loadOverview();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('productEditForm').addEventListener('submit', submitProductEdit);
  document.getElementById('categoryForm').addEventListener('submit', submitCategoryForm);
  document.getElementById('attributeForm').addEventListener('submit', submitAttributeForm);
  document.getElementById('adForm').addEventListener('submit', submitAdForm);
  document.getElementById('agentForm').addEventListener('submit', submitAgentForm);

  document.getElementById('addCategoryBtn').addEventListener('click', () => openCategoryModal(null));
  document.getElementById('addAttributeBtn').addEventListener('click', () => openAttributeModal(null));
  document.getElementById('addAdBtn').addEventListener('click', () => openAdModal(null));
  document.getElementById('addAgentBtn').addEventListener('click', () => openAgentModal(null));

  // NEW — Transaction Fee Tier wiring
  document.getElementById('addFeeTierBtn').addEventListener('click', () => openFeeTierModal(null));
  document.getElementById('feeTierForm').addEventListener('submit', submitFeeTierForm);

    // NEW — Weight Tier wiring
  document.getElementById('addWeightTierBtn').addEventListener('click', () => openWeightTierModal(null));
  document.getElementById('weightTierForm').addEventListener('submit', submitWeightTierForm);

  // NEW — Shipping Criteria wiring
  document.getElementById('addShipCritGroupBtn').addEventListener('click', () => openShipCritGroupModal(null));
  document.getElementById('addShipCritOptionRowBtn').addEventListener('click', () => addShipCritOptionRow());
  document.getElementById('shipCritGroupForm').addEventListener('submit', submitShipCritGroupForm);
  document.getElementById('shipCritTypeSelect').addEventListener('change', onShipCritTypeChange);

  // Attribute type select toggles the "options" field (only relevant for select/multiselect)
  document.getElementById('attrType').addEventListener('change', (e) => {
    const optionsField = document.getElementById('attrOptionsField');
    optionsField.classList.toggle('show', ['select', 'multiselect'].includes(e.target.value));
  });

  // Category-attributes modal wiring
  document.getElementById('catAttrAddBtn').addEventListener('click', addPickedAttributeToAssignment);
  document.getElementById('catAttrSaveBtn').addEventListener('click', submitCategoryAttributes);

  document.getElementById('productSearchInput').addEventListener('input', debounce(() => {
    productFilters.search = document.getElementById('productSearchInput').value.trim();
    productFilters.page = 1;
    loadAllProducts();
  }, 400));
  document.getElementById('productStatusSelect').addEventListener('change', (e) => {
    productFilters.status = e.target.value;
    productFilters.page = 1;
    loadAllProducts();
  });
  document.getElementById('productCategorySelect').addEventListener('change', (e) => {
    productFilters.category = e.target.value;
    productFilters.page = 1;
    loadAllProducts();
  });
  document.getElementById('userRoleSelect').addEventListener('change', (e) => {
    userFilters.role = e.target.value;
    loadUsers();
  });

  document.querySelectorAll('.order-subtab button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.order-subtab button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      orderSubTab = btn.dataset.subtab;
      loadOrdersTab();
    });
  });

  // shops
  document.getElementById('shopEditForm').addEventListener('submit', submitShopEdit);

  document.getElementById('shopRejectForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('shopRejectModal').dataset.shopId;
    const reason = document.getElementById('shopRejectReason').value.trim();
    try {
      await apiPatch(`/shops/admin/${id}/reject`, { reason });
      showToast('Shop rejected and sent back to the seller');
      closeModal('shopRejectModal');
      closeModal('shopModal');
      loadShops();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('shopSearchInput').addEventListener('input', debounce(() => {
    shopFilters.search = document.getElementById('shopSearchInput').value.trim();
    loadShops();
  }, 400));

  document.getElementById('shopStatusSelect').addEventListener('change', (e) => {
    shopFilters.status = e.target.value;
    loadShops();
  });

  // seller verification
  document.getElementById('verifRejectForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('verifRejectModal').dataset.verifId;
    const reason = document.getElementById('verifRejectReason').value.trim();
    try {
      await apiPatch(`/admin/seller-verifications/${id}/reject`, { reason });
      showToast('Verification rejected');
      closeModal('verifRejectModal');
      closeModal('verificationModal');
      loadVerifications();
      loadVerificationsLookup();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('verifSearchInput').addEventListener('input', debounce(() => {
    verifFilters.search = document.getElementById('verifSearchInput').value.trim();
    loadVerifications();
  }, 400));

  document.getElementById('verifStatusSelect').addEventListener('change', (e) => {
    verifFilters.status = e.target.value;
    loadVerifications();
  });

  // legal documents
  document.getElementById('addLegalDocBtn').addEventListener('click', () => openLegalDocModal(null));
  document.getElementById('legalDocForm').addEventListener('submit', submitLegalDocForm);

  // flash sales
  document.querySelectorAll('#fsSubtabBar button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#fsSubtabBar button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      flashSaleFilters.subtab = btn.dataset.fsSubtab;
      document.getElementById('fsPanelTitle').textContent = btn.textContent.trim();
      renderFlashSalesTable();
    });
  });

  document.getElementById('fsSearchInput').addEventListener('input', debounce(() => {
    flashSaleFilters.search = document.getElementById('fsSearchInput').value.trim().toLowerCase();
    renderFlashSalesTable();
  }, 300));

  document.getElementById('flashSaleRejectForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('flashSaleRejectModal').dataset.fsId;
    const reason = document.getElementById('fsRejectReason').value.trim();
    try {
      await apiPatch(`/admin/flash-sales/${id}/reject`, { reason });
      showToast('Flash Sale submission rejected');
      closeModal('flashSaleRejectModal');
      closeModal('flashSaleModal');
      loadFlashSales();
      loadOverview();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // earnings
  document.getElementById('earningsFilterBtn').addEventListener('click', () => {
    earningsFilters.paymentStatus = document.getElementById('earningsPaymentStatusSelect').value;
    earningsFilters.from = document.getElementById('earningsFromDate').value;
    earningsFilters.to = document.getElementById('earningsToDate').value;
    earningsFilters.page = 1;
    loadEarnings();
  });

  document.getElementById('earningsOrderSearch').addEventListener('input', debounce(() => {
    earningsFilters.search = document.getElementById('earningsOrderSearch').value.trim();
    earningsFilters.page = 1;
    loadEarningsOrders();
  }, 400));


    // NEW — Agents/Badges
  wireAgentsSubtabs();
  document.getElementById('agentSearchInput').addEventListener('input', debounce(() => { agentFilters.search = document.getElementById('agentSearchInput').value.trim(); loadAgentsList(); }, 400));
  document.getElementById('agentStatusSelect').addEventListener('change', (e) => { agentFilters.status = e.target.value; loadAgentsList(); });
  document.getElementById('agentForm').addEventListener('submit', submitAgentForm);
  document.getElementById('addAgentBtn').addEventListener('click', () => openAgentModal(null));
  document.getElementById('addBadgeBtn').addEventListener('click', () => openBadgeModal(null));
  document.getElementById('badgeForm').addEventListener('submit', submitBadgeForm);

  // NEW — Marketing Center
  wireMarketingSubtabs();
  document.getElementById('assetSearchInput').addEventListener('input', debounce(() => { assetFilters.search = document.getElementById('assetSearchInput').value.trim(); loadAssets(); }, 400));
  document.getElementById('assetStatusSelect').addEventListener('change', (e) => { assetFilters.status = e.target.value; loadAssets(); });
  document.getElementById('assetAudienceSelect').addEventListener('change', (e) => { assetFilters.audience = e.target.value; loadAssets(); });
  document.getElementById('addAssetBtn').addEventListener('click', () => openAssetModal(null));
  document.getElementById('assetForm').addEventListener('submit', submitAssetForm);
  document.getElementById('assetReplaceForm').addEventListener('submit', submitAssetReplaceForm);
  document.getElementById('brandKitForm').addEventListener('submit', submitBrandKitForm);

  // NEW — Campaigns
  document.getElementById('addCampaignBtn').addEventListener('click', () => openCampaignModal(null));
  document.getElementById('campaignForm').addEventListener('submit', submitCampaignForm);

  // NEW — Commissions
  wireCommissionsSubtabs();
  document.getElementById('commLedgerStatusSelect').addEventListener('change', (e) => { commLedgerFilters.status = e.target.value; loadCommissionLedger(); });
  document.getElementById('commLedgerTypeSelect').addEventListener('change', (e) => { commLedgerFilters.referralType = e.target.value; loadCommissionLedger(); });
  document.getElementById('addRuleBtn').addEventListener('click', () => openRuleModal(null));
  document.getElementById('ruleForm').addEventListener('submit', submitRuleForm);
  document.getElementById('addAdjustmentBtn').addEventListener('click', openAdjustmentModal);
  document.getElementById('adjustmentForm').addEventListener('submit', submitAdjustmentForm);

  // NEW — Agent Leads
  document.getElementById('alTypeSelect').addEventListener('change', (e) => { alFilters.type = e.target.value; loadAgentLeads(); });
  document.getElementById('alStatusSelect').addEventListener('change', (e) => { alFilters.status = e.target.value; loadAgentLeads(); });

  // NEW — Fraud & Audit
  wireFraudSubtabs();
  document.getElementById('fraudStatusSelect').addEventListener('change', (e) => { fraudFilters.status = e.target.value; loadFraudEvents(); });
  document.getElementById('fraudSeveritySelect').addEventListener('change', (e) => { fraudFilters.severity = e.target.value; loadFraudEvents(); });
  document.getElementById('fraudMarkReviewedBtn').addEventListener('click', () => reviewFraudEvent('reviewed'));
  document.getElementById('fraudDismissBtn').addEventListener('click', () => reviewFraudEvent('dismissed'));
  document.getElementById('auditActionSearch').addEventListener('input', debounce(() => { auditFilters.search = document.getElementById('auditActionSearch').value.trim(); auditFilters.page = 1; loadAuditLogs(); }, 400));



    document.getElementById('addTownLocBtn').addEventListener('click', () => openTownLocationModal(null));
  document.getElementById('townLocationForm').addEventListener('submit', submitTownLocationForm);
  document.getElementById('tlIsNairobi').addEventListener('change', (e) => {
    document.getElementById('tlNairobiFeeField').style.display = e.target.checked ? 'block' : 'none';
  });
  document.getElementById('tlHasPickup').addEventListener('change', (e) => {
    document.getElementById('tlPickupAddressField').style.display = e.target.checked ? 'block' : 'none';
  });
  document.getElementById('townLocSearchInput').addEventListener('input', debounce(() => {
    townLocFilters.search = document.getElementById('townLocSearchInput').value.trim();
    loadTownLocations();
  }, 400));
  document.getElementById('townLocCountySelect').addEventListener('change', (e) => {
    townLocFilters.county = e.target.value;
    loadTownLocations();
  });




}

function openRejectModal(productId) {
  document.getElementById('rejectReason').value = '';
  document.getElementById('rejectModal').dataset.productId = productId;
  openModal('rejectModal');



  
}

// ===================================================================
// ALL PRODUCTS (full edit / suspend / reactivate / delete)
// ===================================================================
async function loadAllProducts() {
  // populate category filter dropdown once categories are cached
  const catSelect = document.getElementById('productCategorySelect');
  if (catSelect.options.length <= 1) {
    catSelect.innerHTML = `<option value="">All categories</option>` + categoryOptionsHtml();
  }

  const tbody = document.getElementById('allProductsBody');
  tbody.innerHTML = `<tr><td colspan="8"><div class="spinner"></div></td></tr>`;

  try {
    const params = new URLSearchParams();
    if (productFilters.status) params.set('status', productFilters.status);
    if (productFilters.search) params.set('search', productFilters.search);
    if (productFilters.category) params.set('category', productFilters.category);
    params.set('page', productFilters.page);
    params.set('limit', 15);

    const { products, pages, page } = await apiGet(`/admin/products?${params.toString()}`);

    if (products.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="dash-empty"><i class="fa-solid fa-box-open"></i><p>No products match these filters.</p></div></td></tr>`;
      document.getElementById('productsPagination').innerHTML = '';
      return;
    }

    tbody.innerHTML = products
      .map(
        (p) => `
      <tr>
        <td>${p.images?.[0] ? `<img class="thumb" src="${p.images[0]}" alt="">` : ''}</td>
        <td class="wrap-cell"><strong>${escapeHtml(p.name)}</strong>${p.isHotDeal ? ' <span class="pill pill-active">Hot Deal</span>' : ''}</td>
        <td>${escapeHtml(p.seller?.businessName || p.seller?.shopName || p.seller?.name || '-')}</td>
        <td>${escapeHtml(p.category?.name || '-')}</td>
        <td>${p.finalPrice != null ? 'KSh ' + p.finalPrice.toLocaleString() : '-'}</td>
        <td>${p.stock}</td>
        <td><span class="pill pill-${p.status}">${p.status.replace('_', ' ')}</span></td>
        <td>
          <div class="row-actions">
            <button class="act-edit" data-edit="${p._id}">Edit</button>
            ${p.status === 'suspended'
              ? `<button class="act-approve" data-reactivate="${p._id}">Reactivate</button>`
              : `<button class="act-suspend" data-suspend="${p._id}">Suspend</button>`}
            <button class="act-reject" data-delete="${p._id}">Delete</button>
          </div>
        </td>
      </tr>`
      )
      .join('');

    tbody.querySelectorAll('[data-edit]').forEach((btn) =>
      btn.addEventListener('click', () => openProductEditModal(products.find((p) => p._id === btn.dataset.edit)))
    );
    tbody.querySelectorAll('[data-suspend]').forEach((btn) =>
      btn.addEventListener('click', () => suspendProduct(btn.dataset.suspend))
    );
    tbody.querySelectorAll('[data-reactivate]').forEach((btn) =>
      btn.addEventListener('click', () => reactivateProduct(btn.dataset.reactivate))
    );
    tbody.querySelectorAll('[data-delete]').forEach((btn) =>
      btn.addEventListener('click', () => deleteProduct(btn.dataset.delete))
    );

    renderProductsPagination(page, pages);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

function renderProductsPagination(page, pages) {
  const el = document.getElementById('productsPagination');
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
      productFilters.page = Number(btn.dataset.page);
      loadAllProducts();
    })
  );
}

async function suspendProduct(id) {
  if (!confirm('Suspend this product? It will be pulled from the storefront immediately.')) return;
  try {
    await apiPatch(`/admin/products/${id}/suspend`);
    showToast('Product suspended');
    loadAllProducts();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function reactivateProduct(id) {
  try {
    await apiPatch(`/admin/products/${id}/reactivate`);
    showToast('Product reactivated');
    loadAllProducts();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteProduct(id) {
  if (!confirm('Permanently remove this product from the platform? This cannot be undone.')) return;
  try {
    await apiDelete(`/admin/products/${id}`);
    showToast('Product removed');
    loadAllProducts();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openProductEditModal(product) {
  const modal = document.getElementById('productEditModal');
  modal.dataset.productId = product._id;

  document.getElementById('editName').value = product.name || '';
  document.getElementById('editDescription').value = product.description || '';
  document.getElementById('editCategory').innerHTML = `<option value="${product.category?._id}">${escapeHtml(product.category?.name || '-')}</option>`;
  document.getElementById('editStock').value = product.stock ?? 0;

  const hasVariants = Array.isArray(product.variants) && product.variants.length > 0;
  document.getElementById('editStock').disabled = hasVariants;
  document.getElementById('editStockVariantNote').style.display = hasVariants ? 'block' : 'none';

  document.getElementById('editSellerPrice').value = product.sellerPrice ?? '';
  document.getElementById('editFinalPrice').value = product.finalPrice ?? '';
  document.getElementById('editDiscount').value = product.discountPercent ?? 0;
  document.getElementById('editHotDeal').checked = !!product.isHotDeal;
  document.getElementById('editImagesInput').value = '';

  const preview = document.getElementById('editImagePreview');
  preview.innerHTML = (product.images || []).map((src) => `<img src="${src}" alt="">`).join('');

  openModal('productEditModal');
}

async function submitProductEdit(e) {
  e.preventDefault();
  const modal = document.getElementById('productEditModal');
  const id = modal.dataset.productId;

  const formData = new FormData();
  formData.append('name', document.getElementById('editName').value.trim());
  formData.append('description', document.getElementById('editDescription').value.trim());
  // category intentionally omitted - admin edit modal doesn't touch category/attributes/variants
  if (!document.getElementById('editStock').disabled) {
    formData.append('stock', document.getElementById('editStock').value);
  }
  formData.append('sellerPrice', document.getElementById('editSellerPrice').value);
  formData.append('finalPrice', document.getElementById('editFinalPrice').value);
  formData.append('discountPercent', document.getElementById('editDiscount').value || 0);
  formData.append('isHotDeal', document.getElementById('editHotDeal').checked);

  const files = document.getElementById('editImagesInput').files;
  for (const file of files) formData.append('images', file);

  try {
    await apiPatch(`/admin/products/${id}`, formData, true);
    showToast('Product updated');
    closeModal('productEditModal');
    loadAllProducts();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===================================================================
// CATEGORIES — expandable tree
// ===================================================================
function buildCategoryChildrenMap(categories) {
  const map = {};
  categories.forEach((c) => {
    const pid = c.parentCategory?._id || c.parentCategory || 'root';
    if (!map[pid]) map[pid] = [];
    map[pid].push(c);
  });
  Object.values(map).forEach((arr) => arr.sort((a, b) => a.name.localeCompare(b.name)));
  return map;
}

async function loadCategoriesTable() {
  const wrap = document.getElementById('categoriesTree');
  wrap.innerHTML = `<div class="spinner"></div>`;
  try {
    const { categories } = await apiGet('/admin/categories');
    categoriesCache = categories;

    if (categories.length === 0) {
      wrap.innerHTML = `<div class="dash-empty"><i class="fa-solid fa-tags"></i><p>No categories yet. Add your first one.</p></div>`;
      return;
    }

    const childrenMap = buildCategoryChildrenMap(categories);
    wrap.innerHTML = renderCategoryNodes(childrenMap['root'] || [], childrenMap);
    wireCategoryTreeEvents(categories);
  } catch (err) {
    wrap.innerHTML = `<div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div>`;
  }
}

function renderCategoryNodes(nodes, childrenMap) {
  if (!nodes || nodes.length === 0) return '';
  return (
    `<ul class="cat-tree__list">` +
    nodes
      .map((c) => {
        const kids = childrenMap[c._id] || [];
        const hasKids = kids.length > 0;
        const expanded = expandedCategoryIds.has(c._id);
               const commissionCell =
          c.commissionRate !== null && c.commissionRate !== undefined
            ? `<span class="commission-pill">${c.commissionRate}%</span>`
            : `<span class="commission-pill inherited">Inherited</span>`;
        const shippingCell = c.shippingType
          ? `<span class="commission-pill shipping-pill">${c.shippingType === 'special' ? 'Special' : 'Normal'}</span>`
          : `<span class="commission-pill inherited">Ships: Inherited</span>`;

        return `
      <li class="cat-tree__node" data-cat-id="${c._id}">
        <div class="cat-tree__row">
          <button type="button" class="cat-tree__toggle ${hasKids ? '' : 'is-empty'}" data-cat-toggle="${c._id}" ${hasKids ? '' : 'disabled tabindex="-1"'}>
            <i class="fa-solid ${hasKids ? (expanded ? 'fa-chevron-down' : 'fa-chevron-right') : 'fa-circle'}"></i>
          </button>
          ${c.image ? `<img class="cat-tree__thumb" src="${c.image}" alt="">` : `<span class="cat-tree__thumb cat-tree__thumb--empty"><i class="fa-solid fa-tag"></i></span>`}
          <div class="cat-tree__info">
            <strong>${escapeHtml(c.name)}${!c.isActive ? ' <span class="text-muted">(inactive)</span>' : ''}</strong>
            <span class="text-muted">${c.slug}</span>
          </div>
                    ${commissionCell}
          ${shippingCell}
          <label class="switch">
            <input type="checkbox" ${c.isActive ? 'checked' : ''} data-toggle-cat="${c._id}">
            <span class="track"></span>
          </label>
                    ${hasKids
            ? `<span class="cat-tree__haskids text-muted">${kids.length} sub${kids.length > 1 ? 's' : ''}</span>`
            : `<button class="act-edit" data-manage-attrs="${c._id}">Attributes</button>
               <button class="act-edit" data-manage-shipping="${c._id}">Shipping</button>`}
          <button class="act-edit" data-edit-cat="${c._id}">Edit</button>
        </div>
        ${hasKids ? `<div class="cat-tree__children" style="display:${expanded ? 'block' : 'none'}">${renderCategoryNodes(kids, childrenMap)}</div>` : ''}
      </li>`;
      })
      .join('') +
    `</ul>`
  );
}

function wireCategoryTreeEvents(categories) {
  const wrap = document.getElementById('categoriesTree');

  wrap.querySelectorAll('[data-cat-toggle]:not(.is-empty)').forEach((btn) =>
    btn.addEventListener('click', () => {
      const id = btn.dataset.catToggle;
      const li = wrap.querySelector(`[data-cat-id="${id}"]`);
      const childrenEl = li?.querySelector(':scope > .cat-tree__children');
      if (!childrenEl) return;
      const isOpen = childrenEl.style.display !== 'none';
      childrenEl.style.display = isOpen ? 'none' : 'block';
      const icon = btn.querySelector('i');
      icon.className = isOpen ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down';
      if (isOpen) expandedCategoryIds.delete(id);
      else expandedCategoryIds.add(id);
    })
  );

  wrap.querySelectorAll('[data-edit-cat]').forEach((btn) =>
    btn.addEventListener('click', () => openCategoryModal(categories.find((c) => c._id === btn.dataset.editCat)))
  );
  wrap.querySelectorAll('[data-manage-attrs]').forEach((btn) =>
    btn.addEventListener('click', () => openCategoryAttributesModal(categories.find((c) => c._id === btn.dataset.manageAttrs)))
  );

    wrap.querySelectorAll('[data-manage-shipping]').forEach((btn) =>
    btn.addEventListener('click', () => openShippingCriteriaModal(categories.find((c) => c._id === btn.dataset.manageShipping)))
  );

  wrap.querySelectorAll('[data-toggle-cat]').forEach((toggle) =>
    toggle.addEventListener('change', async () => {
      try {
        await apiPut(`/categories/${toggle.dataset.toggleCat}`, { isActive: toggle.checked });
        showToast(`Category ${toggle.checked ? 'activated' : 'deactivated'}`);
      } catch (err) {
        showToast(err.message, 'error');
        loadCategoriesTable();
      }
    })
  );
}

function openCategoryModal(category) {
  const modal = document.getElementById('categoryModal');
  modal.dataset.categoryId = category?._id || '';
  document.getElementById('categoryModalTitle').textContent = category ? 'Edit Category' : 'Add Category';
  document.getElementById('categoryName').value = category?.name || '';
  document.getElementById('categoryImageInput').value = '';
  document.getElementById('categoryActive').checked = category ? category.isActive : true;

  const currentParentId = category?.parentCategory?._id || category?.parentCategory || '';
  const parentSelect = document.getElementById('categoryParent');

  // Only categories below the max depth, that aren't this category itself or one of
  // its own descendants (handled server-side too, but keep the dropdown honest here).
  const eligibleParents = categoriesCache.filter((c) => {
    if (c._id === category?._id) return false;
    if (c.level >= MAX_CATEGORY_LEVEL) return false;
    return true;
  });

  parentSelect.innerHTML =
    `<option value="">— Top level (Parent Category) —</option>` +
    eligibleParents
      .map((c) => `<option value="${c._id}" ${c._id === currentParentId ? 'selected' : ''}>${'— '.repeat(c.level)}${escapeHtml(c.name)}</option>`)
      .join('');

  // ---- Marketplace commission ----
  const commissionInput = document.getElementById('categoryCommission');
  const effEl = document.getElementById('categoryCommissionEffective');
  commissionInput.value = category?.commissionRate ?? '';

  if (category?._id) {
    effEl.textContent = 'Checking effective commission…';
    apiGet(`/categories/${category._id}/commission`)
      .then((res) => {
        effEl.textContent =
          category.commissionRate !== null && category.commissionRate !== undefined
            ? `This category's own rate: ${res.commissionRate}%.`
            : `Currently inherits ${res.commissionRate}% from ${res.sourceName}.`;
      })
      .catch(() => {
        effEl.textContent = 'Categories with no rate of their own inherit from their parent category, then finally the platform default.';
      });
  } else {
    effEl.textContent = 'New categories inherit from their parent category (or the platform default) until you set a rate here.';
  }


    // ---- Shipping classification ----
  const shipTypeSelect = document.getElementById('categoryShippingType');
  const shipEffEl = document.getElementById('categoryShippingEffective');
  shipTypeSelect.value = category?.shippingType || '';

  if (category?._id) {
    shipEffEl.textContent = 'Checking effective shipping…';
    apiGet(`/categories/${category._id}/shipping`)
      .then((res) => {
        shipEffEl.textContent = category.shippingType
          ? `This category's own setting: ${res.shippingType}.`
          : `Currently inherits "${res.shippingType}" from ${res.sourceName}.`;
      })
      .catch(() => {
        shipEffEl.textContent = 'Categories with no setting of their own inherit from their parent category, then default to Normal.';
      });
  } else {
    shipEffEl.textContent = 'New categories inherit from their parent category (or default to Normal) until you set this here.';
  }


  openModal('categoryModal');
}

async function submitCategoryForm(e) {
  e.preventDefault();
  const modal = document.getElementById('categoryModal');
  const id = modal.dataset.categoryId;

  const formData = new FormData();
  formData.append('name', document.getElementById('categoryName').value.trim());
  formData.append('isActive', document.getElementById('categoryActive').checked);
  formData.append('parentCategory', document.getElementById('categoryParent').value);

  const commissionVal = document.getElementById('categoryCommission').value.trim();
  formData.append('commissionRate', commissionVal === '' ? 'null' : commissionVal);

    const shippingTypeVal = document.getElementById('categoryShippingType').value;
  formData.append('shippingType', shippingTypeVal === '' ? 'null' : shippingTypeVal);

  const file = document.getElementById('categoryImageInput').files[0];
  if (file) formData.append('image', file);

  try {
    if (id) {
      await apiPut(`/categories/${id}`, formData, true);
      showToast('Category updated');
    } else {
      await apiPost('/categories', formData, true);
      showToast('Category created');
    }
    closeModal('categoryModal');
    loadCategoriesTable();
    loadCategoriesCache();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===================================================================
// ATTRIBUTES (admin management of reusable attribute definitions)
// ===================================================================
async function loadAttributes() {
  const tbody = document.getElementById('attributesBody');
  tbody.innerHTML = `<tr><td colspan="5"><div class="spinner"></div></td></tr>`;
  try {
    const { attributes } = await apiGet('/admin/attributes');
    attributesCache = attributes;

    if (attributes.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="dash-empty"><i class="fa-solid fa-sliders"></i><p>No attributes yet. Add Brand, Size, Color, etc.</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = attributes
      .map(
        (a) => `
      <tr>
        <td><strong>${escapeHtml(a.name)}</strong>${a.isVariantAttribute ? '<span class="attr-variant-badge">Creates variants</span>' : ''}</td>
        <td><span class="attr-type-badge">${a.type}</span></td>
        <td class="wrap-cell text-muted">${(a.options || []).join(', ') || '—'}${a.unit ? ` (${escapeHtml(a.unit)})` : ''}</td>
        <td>
          <label class="switch">
            <input type="checkbox" ${a.isActive ? 'checked' : ''} data-toggle-attr="${a._id}">
            <span class="track"></span>
          </label>
        </td>
        <td>
          <div class="row-actions">
            <button class="act-edit" data-edit-attr="${a._id}">Edit</button>
            <button class="act-reject" data-delete-attr="${a._id}">Delete</button>
          </div>
        </td>
      </tr>`
      )
      .join('');

    tbody.querySelectorAll('[data-edit-attr]').forEach((btn) =>
      btn.addEventListener('click', () => openAttributeModal(attributes.find((a) => a._id === btn.dataset.editAttr)))
    );
    tbody.querySelectorAll('[data-delete-attr]').forEach((btn) =>
      btn.addEventListener('click', () => deleteAttributeRow(btn.dataset.deleteAttr))
    );
    tbody.querySelectorAll('[data-toggle-attr]').forEach((toggle) =>
      toggle.addEventListener('change', async () => {
        try {
          await apiPut(`/admin/attributes/${toggle.dataset.toggleAttr}`, { isActive: toggle.checked });
          showToast(`Attribute ${toggle.checked ? 'activated' : 'deactivated'}`);
        } catch (err) {
          showToast(err.message, 'error');
          loadAttributes();
        }
      })
    );
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

function openAttributeModal(attribute) {
  const modal = document.getElementById('attributeModal');
  modal.dataset.attributeId = attribute?._id || '';
  document.getElementById('attributeModalTitle').textContent = attribute ? 'Edit Attribute' : 'Add Attribute';
  document.getElementById('attrName').value = attribute?.name || '';
  document.getElementById('attrType').value = attribute?.type || 'select';
  document.getElementById('attrOptions').value = (attribute?.options || []).join(', ');
  document.getElementById('attrUnit').value = attribute?.unit || '';
  document.getElementById('attrIsVariant').checked = !!attribute?.isVariantAttribute;
  document.getElementById('attrActive').checked = attribute ? attribute.isActive : true;

  document.getElementById('attrOptionsField').classList.toggle(
    'show',
    ['select', 'multiselect'].includes(attribute?.type || 'select')
  );

  openModal('attributeModal');
}

async function submitAttributeForm(e) {
  e.preventDefault();
  const modal = document.getElementById('attributeModal');
  const id = modal.dataset.attributeId;

  const type = document.getElementById('attrType').value;
  const optionsRaw = document.getElementById('attrOptions').value.trim();
  const options = optionsRaw ? optionsRaw.split(',').map((o) => o.trim()).filter(Boolean) : [];

  if (['select', 'multiselect'].includes(type) && options.length === 0) {
    showToast('Add at least one option for a select/multi-select attribute', 'error');
    return;
  }

  const payload = {
    name: document.getElementById('attrName').value.trim(),
    type,
    options,
    unit: document.getElementById('attrUnit').value.trim(),
    isVariantAttribute: document.getElementById('attrIsVariant').checked,
    isActive: document.getElementById('attrActive').checked,
  };

  try {
    if (id) {
      await apiPut(`/admin/attributes/${id}`, payload);
      showToast('Attribute updated');
    } else {
      await apiPost('/admin/attributes', payload);
      showToast('Attribute created');
    }
    closeModal('attributeModal');
    loadAttributes();
    loadAttributesCache();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteAttributeRow(id) {
  if (!confirm('Delete this attribute? This only works if it is not currently assigned to any category.')) return;
  try {
    await apiDelete(`/admin/attributes/${id}`);
    showToast('Attribute deleted');
    loadAttributes();
    loadAttributesCache();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===================================================================
// CATEGORY ↔ ATTRIBUTE ASSIGNMENT MODAL
// ===================================================================
async function openCategoryAttributesModal(category) {
  catAttrTargetCategoryId = category._id;
  document.getElementById('catAttrCategoryName').textContent = category.name;

  const list = document.getElementById('catAttrAssignedList');
  list.innerHTML = `<div class="spinner"></div>`;
  openModal('categoryAttributesModal');

  try {
    const { attributes } = await apiGet(`/categories/${category._id}/attributes`);
    catAttrAssigned = attributes
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((a) => ({ attributeId: a._id, name: a.name, isRequired: a.isRequired }));
  } catch (err) {
    catAttrAssigned = [];
    showToast('Could not load current attributes for this category', 'error');
  }

  renderCategoryAttributesModal();
}

function renderCategoryAttributesModal() {
  // picker dropdown: only active attributes not already assigned
  const picker = document.getElementById('catAttrPickerSelect');
  const assignedIds = new Set(catAttrAssigned.map((a) => a.attributeId));
  const available = attributesCache.filter((a) => a.isActive && !assignedIds.has(a._id));

  picker.innerHTML =
    `<option value="">Choose an attribute to add…</option>` +
    available.map((a) => `<option value="${a._id}">${escapeHtml(a.name)} (${a.type}${a.isVariantAttribute ? ', creates variants' : ''})</option>`).join('');

  const list = document.getElementById('catAttrAssignedList');
  if (catAttrAssigned.length === 0) {
    list.innerHTML = `<div class="assigned-attr-empty">No attributes assigned yet. Sellers won't see any extra fields for this category until you add some.</div>`;
    return;
  }

  list.innerHTML = catAttrAssigned
    .map(
      (a, i) => `
    <div class="assigned-attr-row" data-index="${i}">
      <span class="attr-name">${escapeHtml(a.name)}</span>
      <label style="display:flex; align-items:center; gap:6px; font-size:0.85rem; margin:0;">
        <input type="checkbox" data-required-index="${i}" ${a.isRequired ? 'checked' : ''}> Required
      </label>
      <div class="move-btns">
        <button type="button" data-move-up="${i}" ${i === 0 ? 'disabled' : ''}><i class="fa-solid fa-arrow-up"></i></button>
        <button type="button" data-move-down="${i}" ${i === catAttrAssigned.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-arrow-down"></i></button>
        <button type="button" data-remove-assigned="${i}"><i class="fa-solid fa-xmark"></i></button>
      </div>
    </div>`
    )
    .join('');

  list.querySelectorAll('[data-required-index]').forEach((cb) =>
    cb.addEventListener('change', (e) => {
      catAttrAssigned[Number(e.target.dataset.requiredIndex)].isRequired = e.target.checked;
    })
  );
  list.querySelectorAll('[data-move-up]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.moveUp);
      [catAttrAssigned[i - 1], catAttrAssigned[i]] = [catAttrAssigned[i], catAttrAssigned[i - 1]];
      renderCategoryAttributesModal();
    })
  );
  list.querySelectorAll('[data-move-down]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.moveDown);
      [catAttrAssigned[i + 1], catAttrAssigned[i]] = [catAttrAssigned[i], catAttrAssigned[i + 1]];
      renderCategoryAttributesModal();
    })
  );
  list.querySelectorAll('[data-remove-assigned]').forEach((btn) =>
    btn.addEventListener('click', () => {
      catAttrAssigned.splice(Number(btn.dataset.removeAssigned), 1);
      renderCategoryAttributesModal();
    })
  );
}

function addPickedAttributeToAssignment() {
  const picker = document.getElementById('catAttrPickerSelect');
  const attributeId = picker.value;
  if (!attributeId) return;

  const attr = attributesCache.find((a) => a._id === attributeId);
  if (!attr) return;

  catAttrAssigned.push({ attributeId: attr._id, name: attr.name, isRequired: false });
  renderCategoryAttributesModal();
}

async function submitCategoryAttributes() {
  const payload = {
    attributes: catAttrAssigned.map((a, i) => ({
      attribute: a.attributeId,
      isRequired: a.isRequired,
      displayOrder: i,
    })),
  };

  try {
    await apiPut(`/admin/categories/${catAttrTargetCategoryId}/attributes`, payload);
    showToast('Category attributes saved');
    closeModal('categoryAttributesModal');
  } catch (err) {
    showToast(err.message, 'error');
  }
}
// ===================================================================
// WEIGHT TIERS (NEW — global weight-based shipping ladder for 'normal'
// categories, mirrors the Transaction Fee Tier pattern exactly)
// ===================================================================
async function loadWeightTiers() {
  const tbody = document.getElementById('weightTiersBody');
  tbody.innerHTML = `<tr><td colspan="5"><div class="spinner"></div></td></tr>`;
  try {
    const { tiers } = await apiGet('/admin/weight-tiers');
    weightTiersCache = [...tiers].sort((a, b) => a.weightFrom - b.weightFrom);
    renderWeightTiersTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

function renderWeightTiersTable() {
  const tbody = document.getElementById('weightTiersBody');

  if (weightTiersCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="dash-empty"><i class="fa-solid fa-weight-hanging"></i><p>No weight tiers yet — normal-shipping items won't be charged anything until you add some.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = weightTiersCache
    .map(
      (t) => `
    <tr>
      <td>${t.weightFrom}kg – ${t.weightTo != null ? t.weightTo + 'kg' : 'and above'}</td>
      <td>KSh ${t.price.toLocaleString()}</td>
      <td class="wrap-cell text-muted">${escapeHtml(t.label || '—')}</td>
      <td>
        <label class="switch">
          <input type="checkbox" ${t.isActive ? 'checked' : ''} data-toggle-weight-tier="${t._id}">
          <span class="track"></span>
        </label>
      </td>
      <td>
        <div class="row-actions">
          <button class="act-edit" data-edit-weight-tier="${t._id}">Edit</button>
          <button class="act-reject" data-delete-weight-tier="${t._id}">Delete</button>
        </div>
      </td>
    </tr>`
    )
    .join('');

  tbody.querySelectorAll('[data-edit-weight-tier]').forEach((btn) =>
    btn.addEventListener('click', () => openWeightTierModal(weightTiersCache.find((t) => t._id === btn.dataset.editWeightTier)))
  );
  tbody.querySelectorAll('[data-delete-weight-tier]').forEach((btn) =>
    btn.addEventListener('click', () => deleteWeightTierRow(btn.dataset.deleteWeightTier))
  );
  tbody.querySelectorAll('[data-toggle-weight-tier]').forEach((toggle) =>
    toggle.addEventListener('change', async () => {
      try {
        await apiPatch(`/admin/weight-tiers/${toggle.dataset.toggleWeightTier}`, { isActive: toggle.checked });
        showToast(`Tier ${toggle.checked ? 'activated' : 'deactivated'}`);
        loadWeightTiers();
      } catch (err) {
        showToast(err.message, 'error');
        toggle.checked = !toggle.checked;
      }
    })
  );
}

function openWeightTierModal(tier) {
  const modal = document.getElementById('weightTierModal');
  modal.dataset.tierId = tier?._id || '';
  document.getElementById('weightTierModalTitle').textContent = tier ? 'Edit Weight Tier' : 'Add Weight Tier';
  document.getElementById('weightTierFrom').value = tier?.weightFrom ?? '';
  document.getElementById('weightTierTo').value = tier?.weightTo ?? '';
  document.getElementById('weightTierPrice').value = tier?.price ?? '';
  document.getElementById('weightTierLabel').value = tier?.label || '';
  document.getElementById('weightTierActive').checked = tier ? tier.isActive : true;
  openModal('weightTierModal');
}

async function submitWeightTierForm(e) {
  e.preventDefault();
  const modal = document.getElementById('weightTierModal');
  const id = modal.dataset.tierId;

  const toRaw = document.getElementById('weightTierTo').value.trim();
  const payload = {
    weightFrom: Number(document.getElementById('weightTierFrom').value),
    weightTo: toRaw === '' ? null : Number(toRaw),
    price: Number(document.getElementById('weightTierPrice').value),
    label: document.getElementById('weightTierLabel').value.trim(),
    isActive: document.getElementById('weightTierActive').checked,
  };

  try {
    if (id) {
      await apiPatch(`/admin/weight-tiers/${id}`, payload);
      showToast('Weight tier updated');
    } else {
      await apiPost('/admin/weight-tiers', payload);
      showToast('Weight tier created');
    }
    closeModal('weightTierModal');
    loadWeightTiers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteWeightTierRow(id) {
  if (!confirm('Delete this weight tier permanently?')) return;
  try {
    await apiDelete(`/admin/weight-tiers/${id}`);
    showToast('Weight tier deleted');
    loadWeightTiers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}





// ===================================================================
// TOWN LOCATIONS (NEW — Nairobi manual fee + pickup stations)
// ===================================================================
async function loadTownLocations() {
  const tbody = document.getElementById('townLocationsBody');
  tbody.innerHTML = `<tr><td colspan="8"><div class="spinner"></div></td></tr>`;
  try {
    const params = new URLSearchParams();
    if (townLocFilters.search) params.set('search', townLocFilters.search);
    if (townLocFilters.county) params.set('county', townLocFilters.county);
    const { towns } = await apiGet(`/town-locations/admin/all?${params.toString()}`);
    townLocationsCache = towns;
    populateTownLocCountyFilter(towns);
    renderTownLocationsTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

function populateTownLocCountyFilter(towns) {
  const select = document.getElementById('townLocCountySelect');
  const current = select.value;
  const counties = [...new Set(towns.map((t) => t.county))].sort();
  select.innerHTML = `<option value="">All counties</option>` +
    counties.map((c) => `<option value="${c}" ${c === current ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
}

function renderTownLocationsTable() {
  const tbody = document.getElementById('townLocationsBody');
  if (!townLocationsCache.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="dash-empty"><i class="fa-solid fa-map-pin"></i><p>No towns yet. Add your first one.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = townLocationsCache
    .map(
      (t) => `
    <tr>
      <td>${escapeHtml(t.county)}</td>
      <td><strong>${escapeHtml(t.town)}</strong></td>
      <td>${t.isNairobi ? '<span class="pill pill-active">Nairobi</span>' : '<span class="text-muted">—</span>'}</td>
      <td>${t.isNairobi ? 'KSh ' + (t.nairobiManualFee || 0).toLocaleString() : '<span class="text-muted">Dynamic</span>'}</td>
      <td>${t.hasPickupStation ? `<span class="pill pill-active" title="${escapeHtml(t.pickupStationAddress || '')}">Pickup Station</span>` : '<span class="text-muted">None</span>'}</td>
      <td>${t.deliveryDays}d</td>
      <td><label class="switch"><input type="checkbox" ${t.isActive ? 'checked' : ''} data-toggle-town="${t._id}"><span class="track"></span></label></td>
      <td>
        <div class="row-actions">
          <button class="act-edit" data-edit-town="${t._id}">Edit</button>
          <button class="act-reject" data-delete-town="${t._id}">Delete</button>
        </div>
      </td>
    </tr>`
    )
    .join('');

  tbody.querySelectorAll('[data-edit-town]').forEach((btn) =>
    btn.addEventListener('click', () => openTownLocationModal(townLocationsCache.find((t) => t._id === btn.dataset.editTown)))
  );
  tbody.querySelectorAll('[data-delete-town]').forEach((btn) =>
    btn.addEventListener('click', () => deleteTownLocationRow(btn.dataset.deleteTown))
  );
  tbody.querySelectorAll('[data-toggle-town]').forEach((toggle) =>
    toggle.addEventListener('change', async () => {
      try {
        await apiPatch(`/town-locations/admin/${toggle.dataset.toggleTown}`, { isActive: toggle.checked });
        showToast(`Town ${toggle.checked ? 'activated' : 'deactivated'}`);
        loadTownLocations();
      } catch (err) {
        showToast(err.message, 'error');
        toggle.checked = !toggle.checked;
      }
    })
  );
}

function openTownLocationModal(town) {
  const modal = document.getElementById('townLocationModal');
  modal.dataset.townId = town?._id || '';
  document.getElementById('townLocationModalTitle').textContent = town ? 'Edit Town' : 'Add Town';
  document.getElementById('tlCounty').value = town?.county || '';
  document.getElementById('tlTown').value = town?.town || '';
  document.getElementById('tlIsNairobi').checked = !!town?.isNairobi;
  document.getElementById('tlNairobiFee').value = town?.nairobiManualFee ?? 0;
  document.getElementById('tlNairobiFeeField').style.display = town?.isNairobi ? 'block' : 'none';
  document.getElementById('tlDeliveryDays').value = town?.deliveryDays ?? 2;
  document.getElementById('tlHasPickup').checked = !!town?.hasPickupStation;
  document.getElementById('tlPickupAddress').value = town?.pickupStationAddress || '';
  document.getElementById('tlPickupAddressField').style.display = town?.hasPickupStation ? 'block' : 'none';
  document.getElementById('tlActive').checked = town ? town.isActive : true;
  openModal('townLocationModal');
}

async function submitTownLocationForm(e) {
  e.preventDefault();
  const modal = document.getElementById('townLocationModal');
  const id = modal.dataset.townId;
  const payload = {
    county: document.getElementById('tlCounty').value.trim(),
    town: document.getElementById('tlTown').value.trim(),
    isNairobi: document.getElementById('tlIsNairobi').checked,
    nairobiManualFee: Number(document.getElementById('tlNairobiFee').value) || 0,
    deliveryDays: Number(document.getElementById('tlDeliveryDays').value) || 2,
    hasPickupStation: document.getElementById('tlHasPickup').checked,
    pickupStationAddress: document.getElementById('tlPickupAddress').value.trim(),
    isActive: document.getElementById('tlActive').checked,
  };

  try {
    if (id) {
      await apiPatch(`/town-locations/admin/${id}`, payload);
      showToast('Town updated');
    } else {
      await apiPost('/town-locations/admin', payload);
      showToast('Town created');
    }
    closeModal('townLocationModal');
    loadTownLocations();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteTownLocationRow(id) {
  if (!confirm('Delete this town permanently? It will disappear from checkout immediately.')) return;
  try {
    await apiDelete(`/town-locations/admin/${id}`);
    showToast('Town deleted');
    loadTownLocations();
  } catch (err) {
    showToast(err.message, 'error');
  }
}













// ===================================================================
// SHIPPING CRITERIA (NEW — per-category priced option groups for
// 'special' categories, mirrors the Category ↔ Attribute assignment
// modal pattern)
// ===================================================================
async function openShippingCriteriaModal(category) {
  shipCritTargetCategoryId = category._id;
  document.getElementById('shipCritCategoryName').textContent = category.name;

  const typeSelect = document.getElementById('shipCritTypeSelect');
  typeSelect.value = category.shippingType || '';

  const banner = document.getElementById('shipCritEffectiveBanner');
  banner.style.display = 'inline-flex';
  banner.className = 'commission-mini-badge';
  banner.textContent = 'Checking effective shipping classification…';

  openModal('shippingCriteriaModal');
  await refreshShipCritEffectiveBanner();
  loadShipCritGroupsForCategory(category._id);
}

async function refreshShipCritEffectiveBanner() {
  const banner = document.getElementById('shipCritEffectiveBanner');
  const hint = document.getElementById('shipCritTypeHint');
  try {
    const res = await apiGet(`/categories/${shipCritTargetCategoryId}/shipping`);
    const tone = res.source === 'default' ? 'cm-default' : res.inherited ? 'cm-inherited' : '';
    banner.className = `commission-mini-badge ${tone}`;
    banner.innerHTML = `<i class="fa-solid fa-truck-fast"></i> Effective shipping: <strong style="text-transform:capitalize;">${res.shippingType}</strong>${res.inherited ? ` (inherited from ${escapeHtml(res.sourceName)})` : ''}`;
    hint.textContent =
      res.shippingType === 'special'
        ? 'This category is priced by custom criteria — manage the groups below.'
        : 'This category is priced by weight (see the Shipping tab). Switch to "Special" to price it by custom criteria instead.';
  } catch (err) {
    banner.style.display = 'none';
  }
}

async function onShipCritTypeChange(e) {
  const val = e.target.value; // '', 'normal', 'special'
  try {
    await apiPut(`/categories/${shipCritTargetCategoryId}`, { shippingType: val });
    showToast('Shipping classification updated');
    loadCategoriesTable(); // refresh the tree pill in the background
    refreshShipCritEffectiveBanner();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadShipCritGroupsForCategory(categoryId) {
  const list = document.getElementById('shipCritGroupsList');
  list.innerHTML = `<div class="spinner"></div>`;
  try {
    const { criteria } = await apiGet(`/admin/shipping-criteria?category=${categoryId}`);
    shipCritGroupsCache = criteria;
    renderShipCritGroupsList();
  } catch (err) {
    list.innerHTML = `<div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div>`;
  }
}

function renderShipCritGroupsList() {
  const list = document.getElementById('shipCritGroupsList');

  if (!shipCritGroupsCache.length) {
    list.innerHTML = `<div class="assigned-attr-empty">No criteria groups yet for this category.</div>`;
    return;
  }

  list.innerHTML = shipCritGroupsCache
    .map(
      (g) => `
    <div class="assigned-attr-row" style="flex-direction:column; align-items:stretch; gap:8px;">
      <div style="display:flex; align-items:center; gap:10px;">
        <span class="attr-name">${escapeHtml(g.name)}</span>
        ${g.isRequired ? '<span class="attr-variant-badge">Required</span>' : ''}
        ${!g.isActive ? '<span class="pill pill-rejected">Inactive</span>' : ''}
        <div class="move-btns" style="margin-left:auto;">
          <button type="button" data-edit-ship-group="${g._id}"><i class="fa-solid fa-pen"></i></button>
          <button type="button" data-delete-ship-group="${g._id}"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
      <div class="badge-row">
        ${g.options.map((o) => `<span class="commission-pill${!o.isActive ? ' inherited' : ''}">${escapeHtml(o.label)} — KSh ${o.price.toLocaleString()}</span>`).join('')}
      </div>
    </div>`
    )
    .join('');

  list.querySelectorAll('[data-edit-ship-group]').forEach((btn) =>
    btn.addEventListener('click', () => openShipCritGroupModal(shipCritGroupsCache.find((g) => g._id === btn.dataset.editShipGroup)))
  );
  list.querySelectorAll('[data-delete-ship-group]').forEach((btn) =>
    btn.addEventListener('click', () => deleteShipCritGroupRow(btn.dataset.deleteShipGroup))
  );
}

function addShipCritOptionRow(prefill) {
  shipCritOptionRows.push({
    localId: ++shipCritOptionRowSeq,
    _id: prefill?._id || null,
    label: prefill?.label ?? '',
    price: prefill?.price ?? '',
    isActive: prefill ? prefill.isActive !== false : true,
  });
  renderShipCritOptionRows();
}

function removeShipCritOptionRow(localId) {
  shipCritOptionRows = shipCritOptionRows.filter((r) => r.localId !== localId);
  renderShipCritOptionRows();
}

function renderShipCritOptionRows() {
  const wrap = document.getElementById('shipCritOptionRows');
  if (!wrap) return;

  if (!shipCritOptionRows.length) {
    wrap.innerHTML = `<div class="assigned-attr-empty">No options yet — add at least one.</div>`;
    return;
  }

  wrap.innerHTML = shipCritOptionRows
    .map(
      (r) => `
    <div class="repeater-row" data-ship-opt-row="${r.localId}">
      <input type="text" data-ship-opt-input="label" placeholder="Option label e.g. Small" value="${escapeHtml(r.label)}">
      <input type="number" min="0" step="1" data-ship-opt-input="price" placeholder="Price (KSh)" value="${escapeHtml(String(r.price))}">
      <button type="button" class="btn-rm" data-ship-opt-remove="${r.localId}" title="Remove option"><i class="fa-solid fa-trash"></i></button>
    </div>`
    )
    .join('');

  wrap.querySelectorAll('[data-ship-opt-row]').forEach((rowEl) => {
    const localId = Number(rowEl.dataset.shipOptRow);
    rowEl.querySelectorAll('[data-ship-opt-input]').forEach((input) => {
      input.addEventListener('input', () => {
        const row = shipCritOptionRows.find((r) => r.localId === localId);
        if (!row) return;
        row[input.dataset.shipOptInput] = input.value;
      });
    });
  });
  wrap.querySelectorAll('[data-ship-opt-remove]').forEach((btn) =>
    btn.addEventListener('click', () => removeShipCritOptionRow(Number(btn.dataset.shipOptRemove)))
  );
}

function openShipCritGroupModal(group) {
  shipCritEditingGroupId = group?._id || null;
  document.getElementById('shipCritGroupModalTitle').textContent = group ? 'Edit Criteria Group' : 'Add Criteria Group';
  document.getElementById('shipCritGroupName').value = group?.name || '';
  document.getElementById('shipCritGroupRequired').checked = group ? group.isRequired : true;
  document.getElementById('shipCritGroupActive').checked = group ? group.isActive : true;

  shipCritOptionRows = [];
  (group?.options || []).forEach((o) => shipCritOptionRows.push({
    localId: ++shipCritOptionRowSeq, _id: o._id, label: o.label, price: o.price, isActive: o.isActive !== false,
  }));
  if (!group) shipCritOptionRows.push({ localId: ++shipCritOptionRowSeq, _id: null, label: '', price: '', isActive: true });
  renderShipCritOptionRows();

  openModal('shipCritGroupModal');
}

async function submitShipCritGroupForm(e) {
  e.preventDefault();
  const name = document.getElementById('shipCritGroupName').value.trim();
  const isRequired = document.getElementById('shipCritGroupRequired').checked;
  const isActive = document.getElementById('shipCritGroupActive').checked;

  const options = shipCritOptionRows
    .filter((r) => r.label.trim() !== '' && r.price !== '')
    .map((r) => ({ _id: r._id || undefined, label: r.label.trim(), price: Number(r.price), isActive: r.isActive !== false }));

  if (!name) { showToast('Group name is required', 'error'); return; }
  if (!options.length) { showToast('Add at least one priced option', 'error'); return; }

  const payload = { name, isRequired, isActive, options };

  try {
    if (shipCritEditingGroupId) {
      await apiPatch(`/admin/shipping-criteria/${shipCritEditingGroupId}`, payload);
      showToast('Criteria group updated');
    } else {
      payload.category = shipCritTargetCategoryId;
      await apiPost('/admin/shipping-criteria', payload);
      showToast('Criteria group created');
    }
    closeModal('shipCritGroupModal');
    loadShipCritGroupsForCategory(shipCritTargetCategoryId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteShipCritGroupRow(id) {
  if (!confirm('Delete this shipping criteria group? This only works if no product currently uses it.')) return;
  try {
    await apiDelete(`/admin/shipping-criteria/${id}`);
    showToast('Criteria group deleted');
    loadShipCritGroupsForCategory(shipCritTargetCategoryId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}




// ===================================================================
// SHOPS (approve / reject / suspend / reactivate / verify / feature / edit / remove)
// ===================================================================
const SHOP_STATUS_PILL = {
  pending_approval: 'pill-pending_approval',
  approved: 'pill-approved',
  rejected: 'pill-rejected',
  suspended: 'pill-suspended',
};

async function loadShops() {
  const tbody = document.getElementById('shopsBody');
  tbody.innerHTML = `<tr><td colspan="7"><div class="spinner"></div></td></tr>`;
  try {
    const params = new URLSearchParams();
    if (shopFilters.status) params.set('status', shopFilters.status);
    if (shopFilters.search) params.set('search', shopFilters.search);
    const { shops } = await apiGet(`/shops/admin?${params.toString()}`);
    shopsCache = shops;

    if (shops.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="dash-empty"><i class="fa-solid fa-store"></i><p>No shops match these filters.</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = shops
      .map((s) => {
        const badges = [];
        if (s.verificationStatus === 'verified') badges.push('<span class="pill pill-active">Verified</span>');
        if (s.isFeatured) badges.push('<span class="pill pill-active">Featured</span>');
        if (!s.isActive) badges.push('<span class="pill pill-rejected">Inactive</span>');

        return `
      <tr>
        <td>${s.logo ? `<img class="thumb" src="${s.logo}" alt="">` : ''}</td>
        <td class="wrap-cell"><strong>${escapeHtml(s.shopName)}</strong><div class="text-muted">/${escapeHtml(s.slug)}</div></td>
        <td>${escapeHtml(s.seller?.businessName || s.seller?.shopName || s.seller?.name || '-')}</td>
        <td>${escapeHtml(s.businessCategory || '-')}</td>
        <td><span class="pill ${SHOP_STATUS_PILL[s.status] || ''}">${s.status.replace(/_/g, ' ')}</span></td>
        <td>${badges.join(' ') || '<span class="text-muted">—</span>'}</td>
        <td>
          <div class="row-actions">
            <button class="act-edit" data-view-shop="${s._id}">${s.status === 'pending_approval' ? 'Review' : 'View / Edit'}</button>
          </div>
        </td>
      </tr>`;
      })
      .join('');

    tbody.querySelectorAll('[data-view-shop]').forEach((btn) =>
      btn.addEventListener('click', () => openShopModal(shopsCache.find((s) => s._id === btn.dataset.viewShop)))
    );
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

function openShopModal(shop) {
  const modal = document.getElementById('shopModal');
  modal.dataset.shopId = shop._id;

  document.getElementById('shopModalName').textContent = shop.shopName;
  document.getElementById('shopSellerName').textContent =
    shop.seller?.businessName || shop.seller?.shopName || shop.seller?.name || '-';
  document.getElementById('shopSellerContact').textContent =
    [shop.seller?.email, shop.seller?.phone].filter(Boolean).join(' · ');

  const statusPill = document.getElementById('shopStatusPill');
  statusPill.className = `pill ${SHOP_STATUS_PILL[shop.status] || ''}`;
  statusPill.textContent = shop.status.replace(/_/g, ' ');

  const badgeRow = document.getElementById('shopBadgeRow');
  const badges = [];
  if (shop.verificationStatus === 'verified') badges.push('<span class="pill pill-active">Verified</span>');
  if (shop.isFeatured) badges.push('<span class="pill pill-active">Featured</span>');
  if (!shop.isActive) badges.push('<span class="pill pill-rejected">Inactive</span>');
  badgeRow.innerHTML = badges.join(' ') || '<span class="text-muted">—</span>';

  document.getElementById('shopCreatedAt').textContent = new Date(shop.createdAt).toLocaleString();

  const rejNote = document.getElementById('shopRejectionNote');
  if (shop.status === 'rejected' && shop.rejectionReason) {
    rejNote.style.display = 'block';
    rejNote.textContent = `Rejected: ${shop.rejectionReason}`;
  } else {
    rejNote.style.display = 'none';
  }

  document.getElementById('shopEditName').value = shop.shopName || '';
  document.getElementById('shopEditCategory').value = shop.businessCategory || '';
  document.getElementById('shopEditDescription').value = shop.description || '';
  document.getElementById('shopEditHours').value = shop.businessHours || '';
  document.getElementById('shopEditActive').checked = !!shop.isActive;
  document.getElementById('shopEditLogoInput').value = '';
  document.getElementById('shopEditBannerInput').value = '';
  document.getElementById('shopLogoPreview').innerHTML = shop.logo ? `<img src="${shop.logo}" alt="">` : '';
  document.getElementById('shopBannerPreview').innerHTML = shop.banner ? `<img src="${shop.banner}" alt="">` : '';

  renderShopModalActions(shop);
  openModal('shopModal');
}

function renderShopModalActions(shop) {
  const wrap = document.getElementById('shopModalActions');
  const buttons = [];

  if (shop.status === 'pending_approval') {
    buttons.push(`<button type="button" class="btn btn-primary act-approve" id="shopApproveBtn">Approve Shop</button>`);
    buttons.push(`<button type="button" class="btn btn-dark act-reject" id="shopRejectBtn">Reject Shop</button>`);
  }
  if (shop.status === 'approved') {
    buttons.push(`<button type="button" class="btn btn-dark act-suspend" id="shopSuspendBtn">Suspend Shop</button>`);
    buttons.push(`<button type="button" class="btn btn-primary" id="shopVerifyBtn">${shop.verificationStatus === 'verified' ? 'Remove Verified Badge' : 'Mark Verified'}</button>`);
    buttons.push(`<button type="button" class="btn btn-primary" id="shopFeatureBtn">${shop.isFeatured ? 'Unfeature Shop' : 'Feature Shop'}</button>`);
  }
  if (shop.status === 'suspended') {
    buttons.push(`<button type="button" class="btn btn-primary act-approve" id="shopReactivateBtn">Reactivate Shop</button>`);
  }
  buttons.push(`<button type="button" class="btn btn-dark act-reject" id="shopDeleteBtn">Remove Shop</button>`);

  wrap.innerHTML = buttons.join('');

  document.getElementById('shopApproveBtn')?.addEventListener('click', () => approveShopRow(shop._id));
  document.getElementById('shopRejectBtn')?.addEventListener('click', () => {
    document.getElementById('shopRejectReason').value = '';
    document.getElementById('shopRejectModal').dataset.shopId = shop._id;
    openModal('shopRejectModal');
  });
  document.getElementById('shopSuspendBtn')?.addEventListener('click', () => suspendShopRow(shop._id));
  document.getElementById('shopReactivateBtn')?.addEventListener('click', () => reactivateShopRow(shop._id));
  document.getElementById('shopVerifyBtn')?.addEventListener('click', () =>
    setShopVerificationRow(shop._id, shop.verificationStatus === 'verified' ? 'unverified' : 'verified')
  );
  document.getElementById('shopFeatureBtn')?.addEventListener('click', () => setShopFeaturedRow(shop._id, !shop.isFeatured));
  document.getElementById('shopDeleteBtn')?.addEventListener('click', () => deleteShopRow(shop._id));
}

async function approveShopRow(id) {
  try {
    await apiPatch(`/shops/admin/${id}/approve`);
    showToast('Shop approved and published');
    closeModal('shopModal');
    loadShops();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function suspendShopRow(id) {
  if (!confirm('Suspend this shop? Its storefront will be pulled immediately.')) return;
  try {
    await apiPatch(`/shops/admin/${id}/suspend`);
    showToast('Shop suspended');
    closeModal('shopModal');
    loadShops();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function reactivateShopRow(id) {
  try {
    await apiPatch(`/shops/admin/${id}/reactivate`);
    showToast('Shop reactivated');
    closeModal('shopModal');
    loadShops();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function setShopVerificationRow(id, verificationStatus) {
  try {
    await apiPatch(`/shops/admin/${id}/verify`, { verificationStatus });
    showToast(verificationStatus === 'verified' ? 'Shop marked as verified' : 'Verified badge removed');
    closeModal('shopModal');
    loadShops();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function setShopFeaturedRow(id, isFeatured) {
  try {
    await apiPatch(`/shops/admin/${id}/feature`, { isFeatured });
    showToast(isFeatured ? 'Shop featured' : 'Shop unfeatured');
    closeModal('shopModal');
    loadShops();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteShopRow(id) {
  if (!confirm('Remove this shop permanently? The seller can create a new one later.')) return;
  try {
    await apiDelete(`/shops/admin/${id}`);
    showToast('Shop removed');
    closeModal('shopModal');
    loadShops();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function submitShopEdit(e) {
  e.preventDefault();
  const id = document.getElementById('shopModal').dataset.shopId;

  const formData = new FormData();
  formData.append('shopName', document.getElementById('shopEditName').value.trim());
  formData.append('businessCategory', document.getElementById('shopEditCategory').value.trim());
  formData.append('description', document.getElementById('shopEditDescription').value.trim());
  formData.append('businessHours', document.getElementById('shopEditHours').value.trim());
  formData.append('isActive', document.getElementById('shopEditActive').checked);

  const logoFile = document.getElementById('shopEditLogoInput').files[0];
  if (logoFile) formData.append('logo', logoFile);
  const bannerFile = document.getElementById('shopEditBannerInput').files[0];
  if (bannerFile) formData.append('banner', bannerFile);

  try {
    await apiPatch(`/shops/admin/${id}`, formData, true);
    showToast('Shop details updated');
    closeModal('shopModal');
    loadShops();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===================================================================
// SELLER VERIFICATION LOOKUP (background cache used to power pickup
// location display on order rows all across the dashboard)
// ===================================================================
async function loadVerificationsLookup() {
  try {
    const { verifications } = await apiGet('/admin/seller-verifications'); // no status filter = everything
    const map = {};
    verifications.forEach((v) => {
      const sellerId = v.seller?._id || v.seller;
      if (sellerId) map[String(sellerId)] = v;
    });
    verificationsBySellerId = map;
  } catch (err) {
    verificationsBySellerId = {};
  }
}

// Resolves the address a courier/buyer should actually go to for pickup:
// the dedicated warehouse address if the seller set one, otherwise the
// business address (their sameAsBusiness default).
function resolvePickupAddress(record) {
  if (!record) return null;
  const wh = record.warehouseAddress;
  const biz = record.businessAddress;
  if (wh && wh.sameAsBusiness === false && (wh.county || wh.city || wh.street)) {
    return {
      label: wh.warehouseName || 'Warehouse',
      county: wh.county, city: wh.city, street: wh.street, building: wh.building, mapLink: wh.mapLink,
    };
  }
  if (biz && (biz.county || biz.city || biz.street)) {
    return { label: 'Business Address', county: biz.county, city: biz.city, street: biz.street, building: biz.building };
  }
  return null;
}

function formatAddressLine(addr) {
  if (!addr) return '';
  return [addr.building, addr.street, addr.city, addr.county].filter(Boolean).join(', ');
}

// Small reusable "pickup" banner used in the verification modal, the seller
// orders modal, and inline within each order's item breakdown.
function pickupBannerHtml(sellerLabel, record) {
  const addr = resolvePickupAddress(record);
  if (!addr) {
    return `<div class="pickup-card pickup-card--empty"><i class="fa-solid fa-circle-question"></i><div><strong>${escapeHtml(sellerLabel || 'Seller')}</strong><div class="text-muted">No pickup/warehouse location on file yet.</div></div></div>`;
  }
  const line = formatAddressLine(addr);
  return `
    <div class="pickup-card">
      <i class="fa-solid fa-warehouse"></i>
      <div>
        <strong>${escapeHtml(sellerLabel || 'Seller')}</strong>
        <span class="pickup-card__tag">${escapeHtml(addr.label)}</span>
        <div class="pickup-card__addr">${escapeHtml(line) || '<span class="text-muted">Address incomplete</span>'}</div>
        ${addr.mapLink ? `<a href="${escapeHtml(addr.mapLink)}" target="_blank" rel="noopener" class="doc-chip" style="margin-top:6px;"><i class="fa-solid fa-map-location-dot"></i> Open map</a>` : ''}
      </div>
    </div>`;
}

// ===================================================================
// SELLER VERIFICATION (review identity/tax/business/store/pickup docs, approve/reject)
// ===================================================================
function verifField(label, value) {
  return `<div class="verif-field"><span class="vf-label">${escapeHtml(label)}</span><span class="vf-value">${value || '<span class="text-muted">—</span>'}</span></div>`;
}

function fileChip(label, url) {
  if (!url) return `<span class="text-muted">Not provided</span>`;
  const isImage = /\.(jpg|jpeg|png|webp)(\?|$)/i.test(url);
  return `<a class="doc-chip" href="${url}" target="_blank" rel="noopener">
    <i class="fa-solid ${isImage ? 'fa-image' : 'fa-file-pdf'}"></i> ${escapeHtml(label)}
  </a>`;
}

function linkChip(icon, label, url) {
  if (!url) return '';
  const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  return `<a class="doc-chip" href="${escapeHtml(href)}" target="_blank" rel="noopener"><i class="fa-solid ${icon}"></i> ${escapeHtml(label)}</a>`;
}

async function loadVerifications() {
  const tbody = document.getElementById('verificationsBody');
  tbody.innerHTML = `<tr><td colspan="7"><div class="spinner"></div></td></tr>`;
  try {
    const params = new URLSearchParams();
    if (verifFilters.status) params.set('status', verifFilters.status);
    const { verifications } = await apiGet(`/admin/seller-verifications?${params.toString()}`);

    let list = verifications;
    if (verifFilters.search) {
      const q = verifFilters.search.toLowerCase();
      list = list.filter((v) =>
        (v.seller?.name || '').toLowerCase().includes(q) ||
        (v.seller?.businessName || '').toLowerCase().includes(q) ||
        (v.seller?.shopName || '').toLowerCase().includes(q) ||
        (v.store?.storeName || '').toLowerCase().includes(q)
      );
    }
    verificationsCache = list;

    // keep the background lookup fresh too, since we already have the full payload here
    list.forEach((v) => {
      const sellerId = v.seller?._id || v.seller;
      if (sellerId) verificationsBySellerId[String(sellerId)] = v;
    });

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="dash-empty"><i class="fa-solid fa-id-card"></i><p>No verification records match these filters.</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = list
      .map(
        (v) => `
      <tr>
        <td><strong>${escapeHtml(v.seller?.businessName || v.seller?.shopName || v.seller?.name || '-')}</strong><div class="text-muted">${escapeHtml(v.seller?.email || '')}</div></td>
        <td>${v.store?.storeName ? escapeHtml(v.store.storeName) : '<span class="text-muted">—</span>'}</td>
        <td><span class="pill pill-${v.sellerRole}">${v.sellerRole}</span></td>
        <td class="text-muted" style="text-transform:capitalize;">${v.tier}</td>
        <td><span class="pill pill-${v.status === 'pending' ? 'pending_review' : v.status}">${v.status.replace(/_/g, ' ')}</span></td>
        <td>${v.submittedAt ? new Date(v.submittedAt).toLocaleDateString() : '—'}</td>
        <td>
          <div class="row-actions">
            <button class="act-edit" data-view-verif="${v._id}">${v.status === 'pending' ? 'Review' : 'View'}</button>
          </div>
        </td>
      </tr>`
      )
      .join('');

    tbody.querySelectorAll('[data-view-verif]').forEach((btn) =>
      btn.addEventListener('click', () => openVerificationModal(verificationsCache.find((v) => v._id === btn.dataset.viewVerif)))
    );
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

function openVerificationModal(v) {
  if (!v) return;
  const modal = document.getElementById('verificationModal');
  modal.dataset.verifId = v._id;
  modal.dataset.sellerId = v.seller?._id || v.seller || '';

  const sellerLabel = v.seller?.businessName || v.seller?.shopName || v.seller?.name || '-';
  document.getElementById('verifSellerName').textContent = sellerLabel;
  document.getElementById('verifSellerEmail').textContent = v.seller?.email || v.emailVerification?.email || '';

  const rolePill = document.getElementById('verifRolePill');
  rolePill.className = `pill pill-${v.sellerRole}`;
  rolePill.textContent = v.sellerRole;

  const tierPill = document.getElementById('verifTierPill');
  tierPill.className = 'pill pill-active';
  tierPill.textContent = v.tier;

  const statusPill = document.getElementById('verifStatusPill');
  statusPill.className = `pill pill-${v.status === 'pending' ? 'pending_review' : v.status}`;
  statusPill.textContent = v.status.replace(/_/g, ' ');

  const emailPill = document.getElementById('verifEmailPill');
  const emailVerified = !!v.emailVerification?.verified;
  emailPill.className = `pill ${emailVerified ? 'pill-active' : 'pill-rejected'}`;
  emailPill.textContent = emailVerified ? 'Verified' : 'Not verified';

  document.getElementById('verifSubmittedAt').textContent = v.submittedAt ? new Date(v.submittedAt).toLocaleString() : '—';
  document.getElementById('verifAgreedAt').textContent = v.agreedAt ? new Date(v.agreedAt).toLocaleString() : '—';

  const rejNote = document.getElementById('verifRejectionNote');
  if (v.status === 'rejected' && v.rejectionReason) {
    rejNote.style.display = 'block';
    rejNote.textContent = `Rejected: ${v.rejectionReason}`;
  } else {
    rejNote.style.display = 'none';
  }

  // ---- Store & Branding ----
  const store = v.store || {};
  const storePreview = document.getElementById('verifStorePreview');
  if (store.storeLogo || store.storeBanner) {
    storePreview.innerHTML = `
      ${store.storeBanner ? `<img class="store-preview__banner" src="${store.storeBanner}" alt="Store banner">` : ''}
      <div class="store-preview__row">
        ${store.storeLogo ? `<img class="store-preview__logo" src="${store.storeLogo}" alt="Store logo">` : '<div class="store-preview__logo store-preview__logo--empty"><i class="fa-solid fa-shop"></i></div>'}
        <div>
          <strong>${escapeHtml(store.storeName || 'Unnamed store')}</strong>
          <div class="text-muted" style="font-size:.8rem;">${escapeHtml(store.storeDescription || 'No description provided')}</div>
        </div>
      </div>`;
  } else {
    storePreview.innerHTML = '';
  }
  document.getElementById('verifStoreGrid').innerHTML = [
    verifField('Store Name', escapeHtml(store.storeName || '')),
    verifField('Description', escapeHtml(store.storeDescription || '')),
  ].join('');

  // ---- Categories ----
  const categories = v.categories || [];
  document.getElementById('verifCategoriesRow').innerHTML = categories.length
    ? categories.map((c) => `<span class="chip active">${escapeHtml(CATEGORY_LABELS[c] || c)}</span>`).join('')
    : '<span class="text-muted">No categories selected</span>';

  // ---- Identity ----
  const id = v.identity || {};
  document.getElementById('verifIdentityGrid').innerHTML = [
    verifField('Full Name', escapeHtml(id.fullName || '')),
    verifField('Date of Birth', id.dateOfBirth ? new Date(id.dateOfBirth).toLocaleDateString() : ''),
    verifField('Nationality', escapeHtml(id.nationality || '')),
    verifField('ID Type', id.idType ? id.idType.replace(/_/g, ' ') : ''),
    verifField('ID Number', escapeHtml(id.idNumber || '')),
    `<div class="verif-field"><span class="vf-label">ID Front</span>${fileChip('View', id.idFrontImage)}</div>`,
    `<div class="verif-field"><span class="vf-label">ID Back</span>${fileChip('View', id.idBackImage)}</div>`,
    `<div class="verif-field"><span class="vf-label">Selfie with ID</span>${fileChip('View', id.selfieWithId)}</div>`,
  ].join('');

  // ---- Tax ----
  const tax = v.tax || {};
  document.getElementById('verifTaxGrid').innerHTML = [
    verifField('KRA PIN', escapeHtml(tax.kraPinNumber || '')),
    `<div class="verif-field"><span class="vf-label">KRA Certificate</span>${fileChip('View', tax.kraPinCertificate)}</div>`,
    verifField('VAT Registered', tax.vatRegistered ? 'Yes' : 'No'),
    `<div class="verif-field"><span class="vf-label">VAT Certificate</span>${fileChip('View', tax.vatCertificate)}</div>`,
  ].join('');

  // ---- Business (business tier only) ----
  const bizSection = document.getElementById('verifBusinessSection');
  if (v.tier === 'business') {
    bizSection.style.display = 'block';
    const biz = v.business || {};
    document.getElementById('verifBusinessGrid').innerHTML = [
      verifField('Classification', biz.classification ? biz.classification.replace(/_/g, ' ') : ''),
      verifField('Business Name', escapeHtml(biz.businessName || '')),
      verifField('Registration No.', escapeHtml(biz.registrationNumber || '')),
      verifField('Business Age', BUSINESS_AGE_LABELS[biz.businessAge] || ''),
      `<div class="verif-field"><span class="vf-label">Registration Cert.</span>${fileChip('View', biz.registrationCertificate)}</div>`,
      `<div class="verif-field"><span class="vf-label">CR12 Document</span>${fileChip('View', biz.cr12Document)}</div>`,
      `<div class="verif-field"><span class="vf-label">Partnership Agreement</span>${fileChip('View', biz.partnershipAgreement)}</div>`,
      `<div class="verif-field"><span class="vf-label">Business Permit</span>${fileChip('View', biz.businessLicense)}</div>`,
    ].join('');
  } else {
    bizSection.style.display = 'none';
  }

  // ---- Business Address ----
  const addr = v.businessAddress || {};
  document.getElementById('verifAddressGrid').innerHTML = [
    verifField('County', escapeHtml(addr.county || '')),
    verifField('City/Town', escapeHtml(addr.city || '')),
    verifField('Street', escapeHtml(addr.street || '')),
    verifField('Building', escapeHtml(addr.building || '')),
    verifField('Postal Code', escapeHtml(addr.postalCode || '')),
  ].join('');

  // ---- Warehouse / Pickup Location ----
  document.getElementById('verifPickupBanner').innerHTML = pickupBannerHtml(sellerLabel, v);
  const wh = v.warehouseAddress || {};
  if (wh.sameAsBusiness === false) {
    document.getElementById('verifWarehouseGrid').innerHTML = [
      verifField('Warehouse Name', escapeHtml(wh.warehouseName || '')),
      verifField('County', escapeHtml(wh.county || '')),
      verifField('City/Town', escapeHtml(wh.city || '')),
      verifField('Street', escapeHtml(wh.street || '')),
      verifField('Building', escapeHtml(wh.building || '')),
      wh.mapLink ? `<div class="verif-field"><span class="vf-label">Map Link</span>${linkChip('fa-map-location-dot', 'Open map', wh.mapLink)}</div>` : '',
    ].join('');
  } else {
    document.getElementById('verifWarehouseGrid').innerHTML = `<div class="verif-field" style="grid-column:1/-1;"><span class="text-muted">Same as business address above.</span></div>`;
  }

  // ---- Return Address ----
  const ret = v.returnAddress || {};
  document.getElementById('verifReturnGrid').innerHTML = [
    verifField('Recipient Name', escapeHtml(ret.recipientName || '')),
    verifField('County', escapeHtml(ret.county || '')),
    verifField('City/Town', escapeHtml(ret.city || '')),
    verifField('Street', escapeHtml(ret.street || '')),
    verifField('Postal Code', escapeHtml(ret.postalCode || '')),
  ].join('');

  // ---- Payout ----
  const payout = v.payout || {};
  const payoutFields = payout.method === 'bank'
    ? [
        verifField('Method', 'Bank Transfer'),
        verifField('Bank Name', escapeHtml(payout.bankName || '')),
        verifField('Account Name', escapeHtml(payout.accountName || '')),
        verifField('Account Number', escapeHtml(payout.accountNumber || '')),
        verifField('Branch', escapeHtml(payout.branchName || '')),
      ]
    : [
        verifField('Method', payout.method === 'mpesa' ? 'M-Pesa' : '—'),
        verifField('M-Pesa Number', escapeHtml(payout.mpesaNumber || '')),
        verifField('M-Pesa Name', escapeHtml(payout.mpesaName || '')),
      ];
  document.getElementById('verifPayoutGrid').innerHTML = payoutFields.join('');

  // ---- Social & Web ----
  const social = v.social || {};
  const socialChips = [
    linkChip('fa-globe', 'Website', social.website),
    linkChip('fa-brands fa-facebook', 'Facebook', social.facebook),
    linkChip('fa-brands fa-instagram', 'Instagram', social.instagram),
    linkChip('fa-brands fa-tiktok', 'TikTok', social.tiktok),
  ].filter(Boolean);
  document.getElementById('verifSocialRow').innerHTML = socialChips.length ? socialChips.join('') : '<span class="text-muted">No social or web links provided</span>';

  renderVerificationModalActions(v);
  openModal('verificationModal');
}

function renderVerificationModalActions(v) {
  const wrap = document.getElementById('verifModalActions');
  const buttons = [];
  if (v.status === 'pending') {
    buttons.push(`<button type="button" class="btn btn-primary act-approve" id="verifApproveBtn">Approve Seller</button>`);
    buttons.push(`<button type="button" class="btn btn-dark act-reject" id="verifRejectBtn">Reject</button>`);
  } else {
    buttons.push(`<span class="text-muted" style="align-self:center;">Status: ${v.status.replace(/_/g, ' ')}</span>`);
  }
  buttons.push(`<button type="button" class="btn btn-outline" id="verifViewOrdersBtn"><i class="fa-solid fa-receipt"></i> View Orders</button>`);
  wrap.innerHTML = buttons.join('');

  document.getElementById('verifApproveBtn')?.addEventListener('click', () => approveVerificationRow(v._id));
  document.getElementById('verifRejectBtn')?.addEventListener('click', () => {
    document.getElementById('verifRejectReason').value = '';
    document.getElementById('verifRejectModal').dataset.verifId = v._id;
    openModal('verifRejectModal');
  });
  document.getElementById('verifViewOrdersBtn')?.addEventListener('click', () => openSellerOrdersModal(v));
}

async function approveVerificationRow(id) {
  if (!confirm('Approve this seller? They will immediately be able to list products.')) return;
  try {
    await apiPatch(`/admin/seller-verifications/${id}/approve`);
    showToast('Seller verification approved');
    closeModal('verificationModal');
    loadVerifications();
    loadVerificationsLookup();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===================================================================
// SELLER ORDERS MODAL — opened from the Verification review screen.
// ===================================================================
async function openSellerOrdersModal(v) {
  const sellerId = v.seller?._id || v.seller;
  const sellerLabel = v.seller?.businessName || v.seller?.shopName || v.seller?.name || '-';

  document.getElementById('sellerOrdersName').textContent = sellerLabel;
  document.getElementById('sellerOrdersSub').textContent = v.seller?.email ? `${v.seller.email}${v.seller?.phone ? ' · ' + v.seller.phone : ''}` : '';
  document.getElementById('sellerOrdersPickupBanner').innerHTML = pickupBannerHtml(sellerLabel, v);

  const tbody = document.getElementById('sellerOrdersBody');
  tbody.innerHTML = `<tr><td colspan="9"><div class="spinner"></div></td></tr>`;
  openModal('sellerOrdersModal');

  try {
    const { orders } = await apiGet(`/admin/orders?sellerId=${sellerId}&limit=100`);
    if (!orders.length) {
      tbody.innerHTML = `<tr><td colspan="9"><div class="dash-empty"><i class="fa-solid fa-receipt"></i><p>This seller has no orders yet.</p></div></td></tr>`;
      return;
    }

    const statusOptions = ['processing', 'shipped', 'delivered', 'cancelled'];
    tbody.innerHTML = orders.map((o) => orderRowPairHtml(o, statusOptions, 'seller')).join('');

    tbody.querySelectorAll('[data-order-toggle-seller]').forEach((btn) =>
      btn.addEventListener('click', () => toggleOrderDetail(btn.dataset.orderToggleSeller, 'seller'))
    );
    tbody.querySelectorAll('.order-status-select').forEach((sel) =>
      sel.addEventListener('change', async () => {
        const previousValue = sel.dataset.currentValue || sel.value;
        sel.disabled = true;
        try {
          await apiPatch(`/orders/${sel.dataset.order}/status`, { orderStatus: sel.value });
          sel.dataset.currentValue = sel.value;
          showToast('Order status updated');
        } catch (err) {
          showToast(err.message, 'error');
          sel.value = previousValue;
        } finally {
          sel.disabled = false;
        }
      })
    );
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

// ===================================================================
// LEGAL DOCUMENTS
// ===================================================================
function docTypeLabel(t) {
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function populateLegalTypeSelect() {
  document.getElementById('legalType').innerHTML = LEGAL_DOC_TYPES
    .map((t) => `<option value="${t}">${docTypeLabel(t)}</option>`)
    .join('');
}

async function loadLegalDocuments() {
  const tbody = document.getElementById('legalDocsBody');
  tbody.innerHTML = `<tr><td colspan="7"><div class="spinner"></div></td></tr>`;
  try {
    const { documents } = await apiGet('/admin/legal-documents');
    legalDocsCache = documents;

    if (documents.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="dash-empty"><i class="fa-solid fa-file-contract"></i><p>No legal documents yet. Add your Terms &amp; Conditions or Seller Agreement to get started.</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = documents
      .map(
        (d) => `
      <tr>
        <td class="wrap-cell"><strong>${escapeHtml(d.title)}</strong>${d.description ? `<div class="text-muted">${escapeHtml(d.description)}</div>` : ''}</td>
        <td class="text-muted">${docTypeLabel(d.type)}</td>
        <td>${escapeHtml(d.version)}</td>
        <td class="text-muted" style="text-transform:capitalize;">${d.audience}</td>
        <td><span class="pill pill-${d.status}">${d.status}</span></td>
        <td>${new Date(d.effectiveDate).toLocaleDateString()}</td>
        <td>
          <div class="row-actions">
            ${d.status !== 'published' ? `<button class="act-edit" data-edit-legal="${d._id}">Edit</button>` : ''}
            ${d.status === 'draft' ? `<button class="act-approve" data-publish-legal="${d._id}">Publish</button>` : ''}
            ${d.status === 'published' ? `<button class="act-suspend" data-archive-legal="${d._id}">Archive</button>` : ''}
            <button class="act-edit" data-view-acceptances="${d._id}" title="View acceptances"><i class="fa-solid fa-users"></i></button>
            ${d.status !== 'published' ? `<button class="act-reject" data-delete-legal="${d._id}">Delete</button>` : ''}
          </div>
        </td>
      </tr>`
      )
      .join('');

    tbody.querySelectorAll('[data-edit-legal]').forEach((btn) =>
      btn.addEventListener('click', () => openLegalDocModal(legalDocsCache.find((d) => d._id === btn.dataset.editLegal)))
    );
    tbody.querySelectorAll('[data-publish-legal]').forEach((btn) =>
      btn.addEventListener('click', () => publishLegalDocRow(btn.dataset.publishLegal))
    );
    tbody.querySelectorAll('[data-archive-legal]').forEach((btn) =>
      btn.addEventListener('click', () => archiveLegalDocRow(btn.dataset.archiveLegal))
    );
    tbody.querySelectorAll('[data-delete-legal]').forEach((btn) =>
      btn.addEventListener('click', () => deleteLegalDocRow(btn.dataset.deleteLegal))
    );
    tbody.querySelectorAll('[data-view-acceptances]').forEach((btn) =>
      btn.addEventListener('click', () => openAcceptancesModal(legalDocsCache.find((d) => d._id === btn.dataset.viewAcceptances)))
    );
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

function openLegalDocModal(doc) {
  const modal = document.getElementById('legalDocModal');
  modal.dataset.docId = doc?._id || '';
  document.getElementById('legalDocModalTitle').textContent = doc ? 'Edit Document' : 'Add Document';
  document.getElementById('legalTitle').value = doc?.title || '';
  document.getElementById('legalType').value = doc?.type || LEGAL_DOC_TYPES[0];
  document.getElementById('legalVersion').value = doc?.version || '';
  document.getElementById('legalDescription').value = doc?.description || '';
  document.getElementById('legalAudience').value = doc?.audience || 'sellers';
  document.getElementById('legalEffectiveDate').value = doc?.effectiveDate ? doc.effectiveDate.slice(0, 10) : '';
  document.getElementById('legalExpiryDate').value = doc?.expiryDate ? doc.expiryDate.slice(0, 10) : '';
  document.getElementById('legalMandatory').checked = doc ? doc.isMandatory : true;
  document.getElementById('legalFileInput').value = '';
  document.getElementById('legalFileRequired').style.display = doc ? 'none' : 'inline';
  document.getElementById('legalCurrentFileHint').innerHTML = doc?.fileUrl
    ? `Current file: <a href="${doc.fileUrl}" target="_blank" rel="noopener">view PDF</a> — leave empty to keep it.`
    : '';
  openModal('legalDocModal');
}

async function submitLegalDocForm(e) {
  e.preventDefault();
  const modal = document.getElementById('legalDocModal');
  const id = modal.dataset.docId;
  const file = document.getElementById('legalFileInput').files[0];

  if (!id && !file) {
    showToast('A PDF file is required for a new document', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('title', document.getElementById('legalTitle').value.trim());
  formData.append('type', document.getElementById('legalType').value);
  formData.append('version', document.getElementById('legalVersion').value.trim());
  formData.append('description', document.getElementById('legalDescription').value.trim());
  formData.append('audience', document.getElementById('legalAudience').value);
  formData.append('effectiveDate', document.getElementById('legalEffectiveDate').value);
  if (document.getElementById('legalExpiryDate').value) formData.append('expiryDate', document.getElementById('legalExpiryDate').value);
  formData.append('isMandatory', document.getElementById('legalMandatory').checked);
  if (file) formData.append('file', file);

  try {
    if (id) {
      await apiPatch(`/admin/legal-documents/${id}`, formData, true);
      showToast('Document updated');
    } else {
      await apiPost('/admin/legal-documents', formData, true);
      showToast('Document created as a draft');
    }
    closeModal('legalDocModal');
    loadLegalDocuments();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function publishLegalDocRow(id) {
  if (!confirm('Publish this document? It becomes the active version and any previously published version of this type is auto-archived.')) return;
  try {
    await apiPatch(`/admin/legal-documents/${id}/publish`);
    showToast('Document published');
    loadLegalDocuments();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function archiveLegalDocRow(id) {
  if (!confirm('Archive this document? It will stop being shown as active.')) return;
  try {
    await apiPatch(`/admin/legal-documents/${id}/archive`);
    showToast('Document archived');
    loadLegalDocuments();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteLegalDocRow(id) {
  if (!confirm('Delete this document permanently?')) return;
  try {
    await apiDelete(`/admin/legal-documents/${id}`);
    showToast('Document deleted');
    loadLegalDocuments();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function openAcceptancesModal(doc) {
  if (!doc) return;
  document.getElementById('legalAcceptancesDocTitle').textContent = doc.title;
  const tbody = document.getElementById('legalAcceptancesBody');
  tbody.innerHTML = `<tr><td colspan="3"><div class="spinner"></div></td></tr>`;
  openModal('legalAcceptancesModal');
  try {
    const { acceptances } = await apiGet(`/admin/legal-documents/${doc._id}/acceptances`);
    if (acceptances.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3"><div class="dash-empty"><i class="fa-solid fa-users"></i><p>No sellers have accepted this yet.</p></div></td></tr>`;
      return;
    }
    tbody.innerHTML = acceptances
      .map(
        (a) => `
      <tr>
        <td><strong>${escapeHtml(a.seller?.businessName || a.seller?.shopName || a.seller?.name || '-')}</strong><div class="text-muted">${escapeHtml(a.seller?.email || '')}</div></td>
        <td>${a.seller?.role ? `<span class="pill pill-${a.seller.role}">${a.seller.role}</span>` : '<span class="text-muted">—</span>'}</td>
        <td>${new Date(a.acceptedAt).toLocaleString()}</td>
      </tr>`
      )
      .join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="3"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

// ===================================================================
// ADS
// ===================================================================
async function loadAds() {
  const tbody = document.getElementById('adsBody');
  tbody.innerHTML = `<tr><td colspan="6"><div class="spinner"></div></td></tr>`;
  try {
    const { ads } = await apiGet('/admin/ads');

    if (ads.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="dash-empty"><i class="fa-solid fa-rectangle-ad"></i><p>No ads yet. Add your first banner.</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = ads
      .map(
        (ad) => `
      <tr>
        <td><img class="thumb" src="${ad.image}" alt=""></td>
        <td class="wrap-cell"><strong>${escapeHtml(ad.title)}</strong>${ad.brandName ? `<div class="text-muted">${escapeHtml(ad.brandName)}</div>` : ''}</td>
        <td>${ad.placement.replace(/_/g, ' ')}</td>
        <td>${ad.clickCount}</td>
        <td>
          <label class="switch">
            <input type="checkbox" ${ad.isActive ? 'checked' : ''} data-toggle-ad="${ad._id}">
            <span class="track"></span>
          </label>
        </td>
        <td>
          <div class="row-actions">
            <button class="act-edit" data-edit-ad="${ad._id}">Edit</button>
            <button class="act-reject" data-delete-ad="${ad._id}">Delete</button>
          </div>
        </td>
      </tr>`
      )
      .join('');

    tbody.querySelectorAll('[data-edit-ad]').forEach((btn) =>
      btn.addEventListener('click', () => openAdModal(ads.find((a) => a._id === btn.dataset.editAd)))
    );
    tbody.querySelectorAll('[data-delete-ad]').forEach((btn) =>
      btn.addEventListener('click', () => deleteAd(btn.dataset.deleteAd))
    );
    tbody.querySelectorAll('[data-toggle-ad]').forEach((toggle) =>
      toggle.addEventListener('change', () => toggleAdActive(toggle.dataset.toggleAd, toggle.checked))
    );
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

async function toggleAdActive(id, isActive) {
  try {
    await apiPut(`/ads/${id}`, { isActive });
    showToast(`Ad ${isActive ? 'activated' : 'deactivated'}`);
  } catch (err) {
    showToast(err.message, 'error');
    loadAds();
  }
}

async function deleteAd(id) {
  if (!confirm('Delete this ad permanently?')) return;
  try {
    await apiDelete(`/ads/${id}`);
    showToast('Ad deleted');
    loadAds();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openAdModal(ad) {
  const modal = document.getElementById('adModal');
  modal.dataset.adId = ad?._id || '';
  document.getElementById('adModalTitle').textContent = ad ? 'Edit Ad' : 'Add Ad';
  document.getElementById('adTitle').value = ad?.title || '';
  document.getElementById('adBrand').value = ad?.brandName || '';
  document.getElementById('adLink').value = ad?.linkUrl || '';
  document.getElementById('adPlacement').value = ad?.placement || 'homepage_hero';
  document.getElementById('adStartDate').value = ad?.startDate ? ad.startDate.slice(0, 10) : '';
  document.getElementById('adEndDate').value = ad?.endDate ? ad.endDate.slice(0, 10) : '';
  document.getElementById('adImageInput').value = '';
  document.getElementById('adImageRequired').style.display = ad ? 'none' : 'inline';
  openModal('adModal');
}

async function submitAdForm(e) {
  e.preventDefault();
  const modal = document.getElementById('adModal');
  const id = modal.dataset.adId;

  const formData = new FormData();
  formData.append('title', document.getElementById('adTitle').value.trim());
  formData.append('brandName', document.getElementById('adBrand').value.trim());
  formData.append('linkUrl', document.getElementById('adLink').value.trim());
  formData.append('placement', document.getElementById('adPlacement').value);
  if (document.getElementById('adStartDate').value) formData.append('startDate', document.getElementById('adStartDate').value);
  if (document.getElementById('adEndDate').value) formData.append('endDate', document.getElementById('adEndDate').value);
  const file = document.getElementById('adImageInput').files[0];
  if (file) formData.append('image', file);

  if (!id && !file) {
    showToast('An image is required for a new ad', 'error');
    return;
  }

  try {
    if (id) {
      await apiPut(`/ads/${id}`, formData, true);
      showToast('Ad updated');
    } else {
      await apiPost('/ads', formData, true);
      showToast('Ad created');
    }
    closeModal('adModal');
    loadAds();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===================================================================
// FLASH SALE
// ===================================================================
async function loadFlashSales() {
  const tbody = document.getElementById('flashSalesBody');
  tbody.innerHTML = `<tr><td colspan="9"><div class="spinner"></div></td></tr>`;
  try {
    const { flashSales } = await apiGet('/admin/flash-sales?limit=200');
    flashSalesCache = flashSales || [];
    renderFlashSalesTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

function renderFlashSalesTable() {
  const tbody = document.getElementById('flashSalesBody');
  const allowedStatuses = FS_SUBTAB_STATUSES[flashSaleFilters.subtab] || [];

  let list = flashSalesCache.filter((fs) => allowedStatuses.includes(fs.status));

  if (flashSaleFilters.search) {
    const q = flashSaleFilters.search;
    list = list.filter((fs) =>
      (fs.product?.name || '').toLowerCase().includes(q) ||
      (fs.seller?.businessName || fs.seller?.shopName || fs.seller?.name || '').toLowerCase().includes(q)
    );
  }

  list = [...list].sort((a, b) =>
    flashSaleFilters.subtab === 'pending_review'
      ? new Date(a.submittedAt || a.createdAt) - new Date(b.submittedAt || b.createdAt)
      : new Date(b.createdAt) - new Date(a.createdAt)
  );

  if (list.length === 0) {
    const emptyCopy = {
      pending_review: 'Nothing waiting for Flash Sale review right now.',
      live: 'No scheduled or currently live Flash Sale products.',
      history: 'No past Flash Sale submissions yet.',
    }[flashSaleFilters.subtab];
    tbody.innerHTML = `<tr><td colspan="9"><div class="dash-empty"><i class="fa-solid fa-bolt"></i><p>${emptyCopy}</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(flashSaleRowHtml).join('');

  tbody.querySelectorAll('[data-fs-view]').forEach((btn) =>
    btn.addEventListener('click', () => openFlashSaleModal(flashSalesCache.find((fs) => fs._id === btn.dataset.fsView)))
  );
  tbody.querySelectorAll('[data-fs-approve]').forEach((btn) =>
    btn.addEventListener('click', () => approveFlashSaleRow(btn.dataset.fsApprove))
  );
  tbody.querySelectorAll('[data-fs-reject]').forEach((btn) =>
    btn.addEventListener('click', () => openFlashSaleRejectModal(btn.dataset.fsReject))
  );
}

function flashSaleRowHtml(fs) {
  const product = fs.product || {};
  const seller = fs.seller || {};
  const remaining = Math.max(0, (fs.stockAllocated || 0) - (fs.stockSold || 0));
  const pct = fs.stockAllocated ? Math.min(100, Math.round((fs.stockSold / fs.stockAllocated) * 100)) : 0;
  const pillClass = FLASH_SALE_PILL_CLASS[fs.status] || '';

  const actions = fs.status === 'pending_review'
    ? `<button class="act-approve" data-fs-approve="${fs._id}">Approve</button>
       <button class="act-reject" data-fs-reject="${fs._id}">Reject</button>
       <button class="act-edit" data-fs-view="${fs._id}">View</button>`
    : `<button class="act-edit" data-fs-view="${fs._id}">View</button>`;

  return `
    <tr>
      <td>${product.images?.[0] ? `<img class="thumb" src="${product.images[0]}" alt="">` : ''}</td>
      <td class="wrap-cell"><strong>${escapeHtml(product.name || '-')}</strong></td>
      <td>${escapeHtml(seller.businessName || seller.shopName || seller.name || '-')}</td>
      <td class="fs-price-cell">
        <span class="fs-new">KSh ${Number(fs.flashSalePrice || 0).toLocaleString()}</span>
        <span class="fs-old">KSh ${Number(fs.originalPrice || 0).toLocaleString()}</span>
      </td>
      <td><span class="fs-discount-badge">${fs.discountPercent || 0}% off</span></td>
      <td>
        <div class="fs-mini-progress">
          <div class="fs-mini-progress__track"><div class="fs-mini-progress__fill" style="width:${pct}%"></div></div>
          <span class="fs-mini-progress__label">${remaining} of ${fs.stockAllocated} left</span>
        </div>
      </td>
      <td>${fs.saleDate ? new Date(fs.saleDate).toLocaleDateString() : '-'}</td>
      <td><span class="pill ${pillClass}"><i class="fa-solid ${FLASH_SALE_STATUS_ICON[fs.status] || 'fa-circle'}"></i> ${FLASH_SALE_STATUS_LABEL[fs.status] || fs.status}</span></td>
      <td><div class="row-actions">${actions}</div></td>
    </tr>`;
}

function formatFsWindow(fs) {
  if (!fs.startAt) return '-';
  const d = new Date(fs.startAt);
  const dateLabel = d.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return `${dateLabel}, 2:00 PM – Midnight`;
}

function openFlashSaleModal(fs) {
  if (!fs) return;
  const product = fs.product || {};
  const seller = fs.seller || {};

  document.getElementById('flashSaleModal').dataset.fsId = fs._id;
  document.getElementById('fsModalProductName').textContent = product.name || '-';
  document.getElementById('fsModalImage').src = product.images?.[0] || 'https://placehold.co/80x80/E4D6BD/5B564C?text=%20';
  document.getElementById('fsModalSeller').textContent =
    seller.businessName || seller.shopName || seller.name || '-';

  const statusPill = document.getElementById('fsModalStatusPill');
  statusPill.className = `pill ${FLASH_SALE_PILL_CLASS[fs.status] || ''}`;
  statusPill.innerHTML = `<i class="fa-solid ${FLASH_SALE_STATUS_ICON[fs.status] || 'fa-circle'}"></i> ${FLASH_SALE_STATUS_LABEL[fs.status] || fs.status}`;

  document.getElementById('fsModalOriginalPrice').textContent = `KSh ${Number(fs.originalPrice || 0).toLocaleString()}`;
  document.getElementById('fsModalFlashPrice').textContent = `KSh ${Number(fs.flashSalePrice || 0).toLocaleString()}`;
  document.getElementById('fsModalDiscount').textContent = `${fs.discountPercent || 0}% off`;
  document.getElementById('fsModalStock').textContent = `${fs.stockAllocated || 0} units allocated`;
  document.getElementById('fsModalWindow').textContent = formatFsWindow(fs);
  document.getElementById('fsModalSubmitted').textContent = fs.submittedAt ? new Date(fs.submittedAt).toLocaleString() : '-';

  const remaining = Math.max(0, (fs.stockAllocated || 0) - (fs.stockSold || 0));
  const pct = fs.stockAllocated ? Math.min(100, Math.round((fs.stockSold / fs.stockAllocated) * 100)) : 0;
  document.getElementById('fsModalStockFill').style.width = `${pct}%`;
  document.getElementById('fsModalStockLabel').textContent = `${fs.stockSold || 0} sold · ${remaining} of ${fs.stockAllocated} remaining`;

  const rejNote = document.getElementById('fsModalRejectionNote');
  if (fs.status === 'rejected' && fs.rejectionReason) {
    rejNote.style.display = 'block';
    rejNote.textContent = `Rejected: ${fs.rejectionReason}`;
  } else {
    rejNote.style.display = 'none';
  }

  const actionsWrap = document.getElementById('fsModalActions');
  actionsWrap.innerHTML = fs.status === 'pending_review'
    ? `<button type="button" class="btn btn-primary act-approve" id="fsModalApproveBtn">Approve Submission</button>
       <button type="button" class="btn btn-dark act-reject" id="fsModalRejectBtn">Reject</button>`
    : '';

  document.getElementById('fsModalApproveBtn')?.addEventListener('click', () => approveFlashSaleRow(fs._id));
  document.getElementById('fsModalRejectBtn')?.addEventListener('click', () => openFlashSaleRejectModal(fs._id));

  openModal('flashSaleModal');
}

function openFlashSaleRejectModal(id) {
  document.getElementById('fsRejectReason').value = '';
  document.getElementById('flashSaleRejectModal').dataset.fsId = id;
  openModal('flashSaleRejectModal');
}

async function approveFlashSaleRow(id) {
  if (!confirm('Approve this Flash Sale submission? It will automatically go live at 2:00 PM on the sale date.')) return;
  try {
    await apiPatch(`/admin/flash-sales/${id}/approve`);
    showToast('Flash Sale submission approved and scheduled');
    closeModal('flashSaleModal');
    loadFlashSales();
    loadOverview();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===================================================================
// ORDERS (payment verification + full oversight, with expandable detail rows)
// ===================================================================

const STK_FAILURE_LABELS = {
  wrong_pin: 'Wrong M-Pesa PIN',
  insufficient_funds: 'Insufficient Balance',
  cancelled: 'Cancelled by buyer',
  timeout: 'No response (timeout)',
  in_progress: 'Another M-Pesa request in progress',
  system_error: 'M-Pesa system error',
  failed: 'Payment failed',
  '': 'Waiting for M-Pesa response',
};

function paymentStatusDisplay(o) {
  const method = o.paymentMethod || 'manual';

  if (o.paymentStatus === 'confirmed') {
    return method === 'stk'
      ? { label: 'Confirmed — STK', pillClass: 'pill-confirmed', title: o.mpesaCode ? `M-Pesa receipt: ${o.mpesaCode}` : 'Auto-confirmed via M-Pesa STK Push' }
      : { label: 'Confirmed — Manual', pillClass: 'pill-confirmed', title: o.verifiedBy?.name ? `Verified by ${o.verifiedBy.name}` : 'Verified manually from pasted M-Pesa SMS' };
  }

  if (o.paymentStatus === 'rejected') {
    if (method === 'stk') {
      const failType = o.stk?.failureType || '';
      const label = STK_FAILURE_LABELS[failType] || 'STK Failed';
      return { label: `STK Failed — ${label}`, pillClass: 'pill-rejected', title: o.rejectionReason || '' };
    }
    return { label: 'Payment Rejected', pillClass: 'pill-rejected', title: o.rejectionReason || '' };
  }

  if (method === 'stk') {
    return { label: 'STK — Awaiting Response', pillClass: 'pill-pending_verification', title: 'Waiting on M-Pesa\'s webhook — see STK Push Issues if this sits too long' };
  }
  return { label: 'Pending Verification', pillClass: 'pill-pending_verification', title: 'Buyer pasted an M-Pesa SMS — needs manual review' };
}

function loadOrdersTab() {
  document.getElementById('panel-pending-payment').style.display = orderSubTab === 'pending-payment' ? 'block' : 'none';
  document.getElementById('panel-stk-issues').style.display = orderSubTab === 'stk-issues' ? 'block' : 'none';
  document.getElementById('panel-all-orders').style.display = orderSubTab === 'all-orders' ? 'block' : 'none';
  if (orderSubTab === 'pending-payment') loadPendingPayments();
  else if (orderSubTab === 'stk-issues') loadStkIssues();
  else loadAllOrders();
}

async function loadPendingPayments() {
  const tbody = document.getElementById('pendingPaymentsBody');
  tbody.innerHTML = `<tr><td colspan="8"><div class="spinner"></div></td></tr>`;
  try {
    const { orders } = await apiGet('/admin/orders/pending-payment');
    if (orders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="dash-empty"><i class="fa-solid fa-money-bill-wave"></i><p>No payments waiting for verification.</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = orders
      .map(
        (o) => `
      <tr>
        <td><span class="agent-code">${escapeHtml(o.orderNumber || ('#' + o._id.slice(-8).toUpperCase()))}</span></td>
        <td>${escapeHtml(o.buyer?.name || '-')}<div class="text-muted">${escapeHtml(o.buyer?.phone || '')}</div></td>
        <td>KSh ${o.totalAmount?.toLocaleString()}</td>
        <td>${o.agentCode ? `<span class="pill-agent">${escapeHtml(o.agentCode)}</span>` : '<span class="text-muted">—</span>'}</td>
        <td class="wrap-cell">${escapeHtml(o.mpesaCode || '-')}</td>
        <td class="wrap-cell">${escapeHtml(o.mpesaMessage)}</td>
        <td>${new Date(o.createdAt).toLocaleString()}</td>
        <td>
          <div class="row-actions">
            <button class="act-approve" data-confirm="${o._id}">Confirm</button>
            <button class="act-reject" data-rejectpay="${o._id}">Reject</button>
          </div>
        </td>
      </tr>`
      )
      .join('');

    tbody.querySelectorAll('[data-confirm]').forEach((btn) =>
      btn.addEventListener('click', () => verifyPayment(btn.dataset.confirm, 'confirmed'))
    );
    tbody.querySelectorAll('[data-rejectpay]').forEach((btn) =>
      btn.addEventListener('click', () => verifyPayment(btn.dataset.rejectpay, 'rejected'))
    );
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

async function verifyPayment(id, decision) {
  const label = decision === 'confirmed' ? 'confirm this payment' : 'reject this payment (order will be cancelled)';
  if (!confirm(`Are you sure you want to ${label}?`)) return;
  try {
    await apiPatch(`/admin/orders/${id}/verify-payment`, { decision });
    showToast(`Payment ${decision}`);
    loadPendingPayments();
    loadOverview();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadStkIssues() {
  const tbody = document.getElementById('stkIssuesBody');
  tbody.innerHTML = `<tr><td colspan="8"><div class="spinner"></div></td></tr>`;
  try {
    const { orders } = await apiGet('/admin/orders/stk-issues');
    if (orders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="dash-empty"><i class="fa-solid fa-circle-check"></i><p>No unresolved STK Push payments right now.</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = orders
      .map((o) => {
        const failType = o.stk?.failureType || '';
        const label = STK_FAILURE_LABELS[failType] || (o.paymentStatus === 'pending_verification' ? 'Awaiting response' : 'Failed');
        const lastAttempt = o.stk?.lastAttemptAt ? new Date(o.stk.lastAttemptAt) : new Date(o.createdAt);
        const minsAgo = Math.max(0, Math.round((Date.now() - lastAttempt.getTime()) / 60000));
        const pillClass = failType ? 'pill-rejected' : 'pill-pending_review';

        return `
      <tr>
        <td><span class="agent-code">${escapeHtml(o.orderNumber || ('#' + o._id.slice(-8).toUpperCase()))}</span></td>
        <td>${escapeHtml(o.buyer?.name || '-')}<div class="text-muted">${escapeHtml(o.buyer?.phone || '')}</div></td>
        <td>KSh ${(o.totalAmount || 0).toLocaleString()}</td>
        <td><span class="pill ${pillClass}">${label}</span></td>
        <td class="wrap-cell text-muted">${escapeHtml(o.rejectionReason || '-')}</td>
        <td>${minsAgo < 1 ? 'Just now' : minsAgo + ' min ago'}</td>
        <td>${new Date(o.createdAt).toLocaleString()}</td>
        <td>
          <div class="row-actions">
            <button class="act-edit" data-stk-recheck="${o._id}">Recheck with M-Pesa</button>
            <button class="act-reject" data-stk-cancel="${o._id}">Cancel &amp; Restore Stock</button>
          </div>
        </td>
      </tr>`;
      })
      .join('');

    tbody.querySelectorAll('[data-stk-recheck]').forEach((btn) =>
      btn.addEventListener('click', () => recheckStkOrder(btn.dataset.stkRecheck))
    );
    tbody.querySelectorAll('[data-stk-cancel]').forEach((btn) =>
      btn.addEventListener('click', () => cancelStkOrderRow(btn.dataset.stkCancel))
    );
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

async function recheckStkOrder(id) {
  try {
    const res = await apiPatch(`/admin/orders/${id}/stk-recheck`);
    showToast(res.message || 'Rechecked with M-Pesa');
    loadStkIssues();
    loadOverview();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function cancelStkOrderRow(id) {
  if (!confirm('Cancel this order and restore its reserved stock? This cannot be undone.')) return;
  try {
    await apiPatch(`/admin/orders/${id}/stk-cancel`);
    showToast('Order cancelled and stock restored');
    loadStkIssues();
    loadOverview();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadAllOrders() {
  const tbody = document.getElementById('allOrdersBody');
  tbody.innerHTML = `<tr><td colspan="9"><div class="spinner"></div></td></tr>`;
  try {
    // make sure pickup-location data is fresh before rendering item breakdowns
    if (!Object.keys(verificationsBySellerId).length) await loadVerificationsLookup();

    const { orders } = await apiGet('/admin/orders?limit=50');
    allOrdersCache = orders;

    if (orders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9"><div class="dash-empty"><i class="fa-solid fa-receipt"></i><p>No orders yet.</p></div></td></tr>`;
      return;
    }

    const statusOptions = ['processing', 'shipped', 'delivered', 'cancelled'];

    tbody.innerHTML = orders.map((o) => orderRowPairHtml(o, statusOptions, 'all')).join('');

    tbody.querySelectorAll('[data-order-toggle-all]').forEach((btn) =>
      btn.addEventListener('click', () => toggleOrderDetail(btn.dataset.orderToggleAll, 'all'))
    );

    tbody.querySelectorAll('.order-status-select').forEach((sel) =>
      sel.addEventListener('change', async () => {
        const previousValue = sel.dataset.currentValue || sel.value;
        sel.disabled = true;
        try {
          await apiPatch(`/orders/${sel.dataset.order}/status`, { orderStatus: sel.value });
          sel.dataset.currentValue = sel.value;
          showToast('Order status updated');
        } catch (err) {
          showToast(err.message, 'error');
          sel.value = previousValue;
        } finally {
          sel.disabled = false;
        }
      })
    );
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

function orderRowPairHtml(o, statusOptions, scope) {
  const id = o._id;
  const pay = paymentStatusDisplay(o);
  return `
    <tr data-order-row="${id}">
      <td><button type="button" class="row-toggle-btn" data-order-toggle-${scope}="${id}" aria-label="Expand order"><i class="fa-solid fa-chevron-right"></i></button></td>
      <td><span class="agent-code">${escapeHtml(o.orderNumber || ('#' + id.slice(-8).toUpperCase()))}</span></td>
      <td>${escapeHtml(o.buyer?.name || '-')}</td>
      <td>KSh ${o.totalAmount?.toLocaleString()}</td>
      <td>${o.agentCode ? `<span class="pill-agent">${escapeHtml(o.agentCode)}</span>` : '<span class="text-muted">—</span>'}</td>
      <td><span class="pill ${pay.pillClass}" ${pay.title ? `title="${escapeHtml(pay.title)}"` : ''}>${escapeHtml(pay.label)}</span></td>
      <td>
        <select class="order-status-select" data-order="${id}" data-current-value="${o.orderStatus}">
          ${statusOptions.map((s) => `<option value="${s}" ${s === o.orderStatus ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </td>
      <td>${o.items.length} item(s)</td>
      <td>${new Date(o.createdAt).toLocaleDateString()}</td>
    </tr>
    <tr class="order-detail-row" id="order-detail-${scope}-${id}" style="display:none;">
      <td colspan="9">${orderDetailHtml(o)}</td>
    </tr>`;
}

function orderDetailHtml(o) {
  const dd = o.deliveryDetails || {};
  const subtotal = (o.totalAmount || 0) - (o.deliveryFee || 0);

  const totalCommission = o.items.reduce((sum, i) => sum + (i.commissionAmount || 0), 0);
  const totalPayout = o.items.reduce((sum, i) => sum + (i.sellerPayout || 0), 0);
  // NEW — total seller transaction fees on this order
  const totalTxnFees = (o.sellerFees || []).reduce((sum, f) => sum + (f.transactionFee || 0), 0);

  const statsHtml = `
    <div class="od-stats">
      <div class="od-stat"><span class="od-stat-label">Subtotal</span><span class="od-stat-value">KSh ${subtotal.toLocaleString()}</span></div>
      <div class="od-stat"><span class="od-stat-label">Delivery Fee</span><span class="od-stat-value">KSh ${(o.deliveryFee || 0).toLocaleString()}</span></div>
      <div class="od-stat tone-commission"><span class="od-stat-label">Marketplace Commission</span><span class="od-stat-value">KSh ${totalCommission.toLocaleString()}</span></div>
      <div class="od-stat tone-payout"><span class="od-stat-label">Seller Payout</span><span class="od-stat-value">KSh ${totalPayout.toLocaleString()}</span></div>
      <div class="od-stat"><span class="od-stat-label">Transaction Fees</span><span class="od-stat-value">KSh ${totalTxnFees.toLocaleString()}</span></div>
      ${o.agent ? `<div class="od-stat"><span class="od-stat-label">Agent Commission</span><span class="od-stat-value">KSh ${(o.commissionAmount || 0).toLocaleString()}</span></div>` : ''}
    </div>`;

    const sa = o.shippingAddress || {};
  const deliveryBadge = sa.isNairobi
    ? '<span class="pill pill-active">Nairobi</span>'
    : '<span class="text-muted">Standard (dynamic shipping)</span>';
  const pickupBadge = sa.hasPickupStation
    ? `<span class="pill pill-active" title="${escapeHtml(sa.pickupStationAddress || '')}">Pickup Station</span>`
    : '<span class="text-muted">No pickup station</span>';

  const contactCard = `
    <div class="od-card">
      <h5><i class="fa-solid fa-user"></i> Contact &amp; Shipping</h5>
      <div class="od-row"><span>Phone</span><span>${escapeHtml(o.buyer?.phone || '—')}</span></div>
      <div class="od-row"><span>Email</span><span>${escapeHtml(o.buyer?.email || '—')}</span></div>
      <div class="od-row"><span>Recipient</span><span>${escapeHtml(sa.fullName || '—')}</span></div>
      <div class="od-row"><span>County</span><span>${escapeHtml(sa.county || '—')}</span></div>
      <div class="od-row"><span>Town</span><span>${escapeHtml(sa.city || '—')} ${deliveryBadge}</span></div>
      <div class="od-row"><span>Pickup</span><span>${pickupBadge}</span></div>
      ${sa.hasPickupStation && sa.pickupStationAddress ? `<div class="od-note">${escapeHtml(sa.pickupStationAddress)}</div>` : ''}
      <div class="od-row"><span>Address</span><span>${escapeHtml(sa.address || '-')}${sa.city ? ', ' + escapeHtml(sa.city) : ''}</span></div>
      ${sa.notes ? `<div class="od-note">${escapeHtml(sa.notes)}</div>` : ''}
    </div>`;

  const agentBlock = o.agent
    ? `<div class="od-row"><span>Agent</span><span>${escapeHtml(o.agent.name)} · ${o.agent.commissionRate}%</span></div>`
    : '';

  const paymentCard = `
    <div class="od-card">
      <h5><i class="fa-solid fa-money-bill-wave"></i> Payment &amp; Delivery</h5>
      <div class="od-row"><span>M-Pesa Code</span><span>${escapeHtml(o.mpesaCode || '—')}</span></div>
      <div class="od-row"><span>Message</span><span>${escapeHtml(o.mpesaMessage || '—')}</span></div>
      ${o.verifiedBy ? `<div class="od-row"><span>Verified By</span><span>${escapeHtml(o.verifiedBy.name)}${o.verifiedAt ? ' · ' + new Date(o.verifiedAt).toLocaleDateString() : ''}</span></div>` : ''}
      ${agentBlock}
      ${dd.transportFee ? `<div class="od-row"><span>Retail Transport</span><span>KSh ${dd.transportFee.toLocaleString()}</span></div>` : ''}
      ${dd.wholesaleDeliveryFee ? `<div class="od-row"><span>Wholesale Delivery</span><span>KSh ${dd.wholesaleDeliveryFee.toLocaleString()}</span></div>` : ''}
      ${(dd.notes || []).map((n) => `<div class="od-note">${escapeHtml(n)}</div>`).join('')}
    </div>`;

  const uniqueSellers = [];
  const seenSellerIds = new Set();
  o.items.forEach((i) => {
    const sid = i.seller?._id || i.seller;
    if (!sid || seenSellerIds.has(String(sid))) return;
    seenSellerIds.add(String(sid));
    uniqueSellers.push({ id: sid, label: i.seller?.businessName || i.seller?.shopName || i.seller?.name || 'Seller' });
  });

  const pickupCards = uniqueSellers
    .map((s) => pickupBannerHtml(s.label, verificationsBySellerId[String(s.id)]))
    .join('');

  const pickupSection = uniqueSellers.length
    ? `<div class="od-card od-card--pickup">
         <h5><i class="fa-solid fa-warehouse"></i> Pickup Location${uniqueSellers.length > 1 ? 's' : ''}</h5>
         ${pickupCards}
       </div>`
    : '';

  // NEW — per-seller transaction fee breakdown card (uses item.seller for labels
  // since Order.sellerFees[].seller is just an ObjectId, not populated)
  const sellerNameMap = {};
  o.items.forEach((i) => {
    const sid = i.seller?._id || i.seller;
    if (sid) sellerNameMap[String(sid)] = i.seller?.businessName || i.seller?.shopName || i.seller?.name || 'Seller';
  });

  const feesSection = (o.sellerFees || []).length
    ? `<div class="od-items-wrap" style="margin-bottom:20px;">
         <h5><i class="fa-solid fa-sack-dollar"></i> Seller Transaction Fees</h5>
         <table class="dtable">
           <thead><tr><th>Seller</th><th>Subtotal</th><th>Tier</th><th>Fee</th></tr></thead>
           <tbody>
             ${o.sellerFees
               .map((f) => {
                 const sid = f.seller?._id || f.seller;
                 const label = sellerNameMap[String(sid)] || 'Seller';
                 return `
               <tr>
                 <td>${escapeHtml(label)}</td>
                 <td>KSh ${(f.subtotal || 0).toLocaleString()}</td>
                 <td class="text-muted">${escapeHtml(f.tier?.label || '—')}</td>
                 <td>KSh ${(f.transactionFee || 0).toLocaleString()}</td>
               </tr>`;
               })
               .join('')}
           </tbody>
         </table>
       </div>`
    : '';

  const itemsHtml = o.items
    .map((i) => {
      const sellerLabel = i.seller?.businessName || i.seller?.shopName || i.seller?.name || '-';
      const lineTotal = (i.priceAtPurchase || 0) * (i.quantity || 0);
      const sellerLineTotal = (i.sellerPriceAtPurchase || 0) * (i.quantity || 0);
      return `
      <tr>
        <td>${i.image ? `<img class="thumb" src="${i.image}" alt="">` : ''}</td>
        <td class="wrap-cell">
          ${escapeHtml(i.name || '-')}
          ${i.variantLabel ? `<div class="text-muted">${escapeHtml(i.variantLabel)}</div>` : ''}
        </td>
        <td>${escapeHtml(sellerLabel)}</td>
        <td>${i.quantity}</td>
        <td>
          KSh ${(i.priceAtPurchase || 0).toLocaleString()}
          <div class="text-muted">Seller: KSh ${(i.sellerPriceAtPurchase || 0).toLocaleString()}</div>
        </td>
        <td>
          KSh ${lineTotal.toLocaleString()}
          <div class="text-muted">Seller: KSh ${sellerLineTotal.toLocaleString()}</div>
        </td>
        <td>
          ${i.commissionRate ?? 0}%
          <div class="text-muted">KSh ${(i.commissionAmount || 0).toLocaleString()}</div>
        </td>
        <td>KSh ${(i.sellerPayout || 0).toLocaleString()}</td>
        <td>${i.deliveryFee ? 'KSh ' + i.deliveryFee.toLocaleString() : '<span class="text-muted">—</span>'}</td>
      </tr>`;
    })
    .join('');

  return `
    <div class="order-detail-panel-v2">
      ${statsHtml}
      <div class="od-columns">
        ${contactCard}
        ${paymentCard}
      </div>
      ${pickupSection}
      ${feesSection}
      <div class="od-items-wrap">
        <h5><i class="fa-solid fa-boxes-stacked"></i> Items</h5>
        <table class="dtable">
          <thead><tr><th></th><th>Item</th><th>Seller</th><th>Qty</th><th>Price</th><th>Subtotal</th><th>Commission</th><th>Payout</th><th>Delivery</th></tr></thead>
          <tbody>${itemsHtml}</tbody>
        </table>
      </div>
    </div>`;
}

function toggleOrderDetail(id, scope) {
  const row = document.getElementById(`order-detail-${scope}-${id}`);
  if (!row) return;
  const btn = document.querySelector(`[data-order-toggle-${scope}="${id}"] i`);
  const isOpen = row.style.display !== 'none';
  row.style.display = isOpen ? 'none' : 'table-row';
  if (btn) btn.className = isOpen ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down';
}

// ===================================================================
// USERS
// ===================================================================
async function loadUsers() {
  const tbody = document.getElementById('usersBody');
  tbody.innerHTML = `<tr><td colspan="6"><div class="spinner"></div></td></tr>`;
  try {
    const params = userFilters.role ? `?role=${userFilters.role}` : '';
    const { users } = await apiGet(`/admin/users${params}`);

    if (users.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="dash-empty"><i class="fa-solid fa-users"></i><p>No users found.</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = users
      .map(
        (u) => `
      <tr>
        <td><strong>${escapeHtml(u.name)}</strong></td>
        <td>${escapeHtml(u.businessName || u.shopName || '-')}</td>
        <td>${escapeHtml(u.email)}<div class="text-muted">${escapeHtml(u.phone || '')}</div></td>
        <td><span class="pill pill-${u.role}">${u.role}</span></td>
        <td>${new Date(u.createdAt).toLocaleDateString()}</td>
        <td>
          <label class="switch">
            <input type="checkbox" ${u.isActive ? 'checked' : ''} data-toggle-user="${u._id}" ${u.role === 'admin' ? 'disabled' : ''}>
            <span class="track"></span>
          </label>
          <span class="text-muted">${u.isActive ? 'Active' : 'Suspended'}</span>
        </td>
      </tr>`
      )
      .join('');

    tbody.querySelectorAll('[data-toggle-user]').forEach((toggle) =>
      toggle.addEventListener('change', async () => {
        try {
          await apiPatch(`/admin/users/${toggle.dataset.toggleUser}/status`, { isActive: toggle.checked });
          showToast(`User ${toggle.checked ? 'reactivated' : 'suspended'}`);
        } catch (err) {
          showToast(err.message, 'error');
          loadUsers();
        }
      })
    );
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

// ===================================================================
// AGENTS
// ===================================================================
// ===================================================================
// AGENTS — list + application lifecycle + badges
// ===================================================================
function wireAgentsSubtabs() {
  document.querySelectorAll('#agentsSubtabBar button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#agentsSubtabBar button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      agentsSubtab = btn.dataset.agentsSubtab;
      document.getElementById('agentsPanelList').style.display = agentsSubtab === 'list' ? 'block' : 'none';
      document.getElementById('agentsPanelBadges').style.display = agentsSubtab === 'badges' ? 'block' : 'none';
      if (agentsSubtab === 'badges') loadBadges();
    });
  });
}

async function loadAgentsTab() {
  await loadBadges(); // needed for badge dropdown/display even on the list subtab
  if (agentsSubtab === 'list') loadAgentsList();
}

async function loadAgentsList() {
  const tbody = document.getElementById('agentsBody');
  tbody.innerHTML = `<tr><td colspan="9"><div class="spinner"></div></td></tr>`;
  agentOrdersCache = {};
  try {
    const params = new URLSearchParams();
    if (agentFilters.status) params.set('status', agentFilters.status);
    if (agentFilters.search) params.set('search', agentFilters.search);
    const { agents } = await apiGet(`/agents/admin/all?${params.toString()}`);
    agentsCache = agents;

    if (agents.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9"><div class="dash-empty"><i class="fa-solid fa-user-tie"></i><p>No agents match these filters.</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = agents.map(agentRowPairHtml).join('');

    tbody.querySelectorAll('[data-agent-toggle]').forEach((btn) => btn.addEventListener('click', () => toggleAgentDetail(btn.dataset.agentToggle)));
    tbody.querySelectorAll('[data-agent-approve]').forEach((btn) => btn.addEventListener('click', () => agentAction(btn.dataset.agentApprove, 'approve')));
    tbody.querySelectorAll('[data-agent-suspend]').forEach((btn) => btn.addEventListener('click', () => agentAction(btn.dataset.agentSuspend, 'suspend')));
    tbody.querySelectorAll('[data-agent-reactivate]').forEach((btn) => btn.addEventListener('click', () => agentAction(btn.dataset.agentReactivate, 'reactivate')));
    tbody.querySelectorAll('[data-agent-reject]').forEach((btn) => btn.addEventListener('click', () => openAgentRejectPrompt(btn.dataset.agentReject)));
    tbody.querySelectorAll('[data-agent-badge-select]').forEach((sel) =>
      sel.addEventListener('change', async () => {
        try {
          await apiPut(`/agents/admin/${sel.dataset.agentBadgeSelect}`, { badge: sel.value || null });
          showToast('Badge updated');
          loadAgentsList();
        } catch (err) {
          showToast(err.message, 'error');
        }
      })
    );
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

function agentRowPairHtml(a) {
  const id = a._id;
  const statusPillClass = { pending: 'pill-pending_review', under_review: 'pill-pending_review', active: 'pill-active', approved: 'pill-active', suspended: 'pill-suspended', rejected: 'pill-rejected', deactivated: 'pill-rejected' }[a.status] || '';

  let actions = '';
  if (['pending', 'under_review'].includes(a.status)) {
    actions = `<button class="act-approve" data-agent-approve="${id}">Approve</button><button class="act-reject" data-agent-reject="${id}">Reject</button>`;
  } else if (a.status === 'active') {
    actions = `<button class="act-suspend" data-agent-suspend="${id}">Suspend</button>`;
  } else if (a.status === 'suspended') {
    actions = `<button class="act-approve" data-agent-reactivate="${id}">Reactivate</button>`;
  }

  const badgeSelect = `
    <select class="order-status-select" data-agent-badge-select="${id}" style="min-width:110px;">
      <option value="">— No badge —</option>
      ${badgesCache.map((b) => `<option value="${b._id}" ${a.badge?._id === b._id ? 'selected' : ''}>${escapeHtml(b.name)} (${b.commissionRate}%)</option>`).join('')}
    </select>`;

  return `
    <tr>
      <td><button type="button" class="row-toggle-btn" data-agent-toggle="${id}" aria-label="Expand agent"><i class="fa-solid fa-chevron-right"></i></button></td>
      <td><strong>${escapeHtml(a.name)}</strong><div class="text-muted">${escapeHtml(a.email || '')}</div></td>
      <td><span class="agent-code">${escapeHtml(a.code)}</span></td>
      <td>${escapeHtml(a.phone || '-')}</td>
      <td>${badgeSelect}</td>
      <td><span class="pill ${statusPillClass}">${a.status.replace(/_/g, ' ')}</span></td>
      <td>${a.totalOrders || 0}</td>
      <td>KES ${(a.totalCommission || 0).toLocaleString()}</td>
      <td><div class="row-actions">${actions}</div></td>
    </tr>
    <tr class="agent-detail-row" id="agent-detail-${id}" style="display:none;">
      <td colspan="9"><div id="agent-orders-${id}"><div class="spinner"></div></div></td>
    </tr>`;
}

async function agentAction(id, action) {
  const labels = { approve: 'approve this agent application', suspend: 'suspend this agent', reactivate: 'reactivate this agent' };
  if (!confirm(`Are you sure you want to ${labels[action]}?`)) return;
  try {
    await apiPatch(`/agents/admin/${id}/${action}`);
    showToast(`Agent ${action}d`.replace('approved', 'approved').replace('ed', action === 'approve' ? 'ed' : 'd'));
    loadAgentsList();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openAgentRejectPrompt(id) {
  const reason = prompt('Reason for rejection (shown to the agent):');
  if (!reason) return;
  apiPatch(`/agents/admin/${id}/reject`, { reason })
    .then(() => { showToast('Application rejected'); loadAgentsList(); })
    .catch((err) => showToast(err.message, 'error'));
}

async function toggleAgentDetail(id) {
  const row = document.getElementById(`agent-detail-${id}`);
  if (!row) return;
  const btn = document.querySelector(`[data-agent-toggle="${id}"] i`);
  const isOpen = row.style.display !== 'none';
  row.style.display = isOpen ? 'none' : 'table-row';
  if (btn) btn.className = isOpen ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down';

  const container = document.getElementById(`agent-orders-${id}`);

  // Profile data is already in agentsCache from the list fetch — render it
  // immediately on first expand, no extra API call needed.
  if (!isOpen && container && !container.dataset.profileRendered) {
    const agent = agentsCache.find((a) => a._id === id);
    if (agent) {
      container.innerHTML = renderAgentProfileHtml(agent) + `<div id="agent-orders-inner-${id}"><div class="spinner"></div></div>`;
      container.dataset.profileRendered = '1';
    }
  }

  if (!isOpen && !agentOrdersCache[id]) {
    try {
      const [{ orders }, { clicks }] = await Promise.all([
        apiGet(`/agents/admin/${id}/orders`),
        apiGet(`/agents/admin/${id}/clicks?limit=1000`),
      ]);
      agentOrdersCache[id] = orders;
      renderAgentOrdersAndClicks(id, orders, clicks);
    } catch (err) {
      const inner = document.getElementById(`agent-orders-inner-${id}`);
      if (inner) inner.innerHTML = `<div class="dash-empty"><p>${err.message}</p></div>`;
    }
  }
}

// NEW — referral click type/channel labels for grouped display
const CLICK_TYPE_LABELS = {
  general: 'General Marketplace',
  buyer: 'Buyer Referral',
  seller: 'Seller Recruitment',
  agent: 'Agent Recruitment',
  product: 'Product Share',
};

// NEW — collapses a raw click list into one row per type, with a
// per-channel breakdown and the most recent click timestamp, so an
// active agent's panel doesn't turn into dozens of near-identical rows.
function groupReferralClicks(clicks) {
  const groups = {};
  (clicks || []).forEach((c) => {
    const type = c.type || 'other';
    if (!groups[type]) groups[type] = { type, count: 0, channels: {}, lastAt: null };
    const g = groups[type];
    g.count += 1;
    const channel = c.channel || 'unknown';
    g.channels[channel] = (g.channels[channel] || 0) + 1;
    const d = new Date(c.createdAt);
    if (!g.lastAt || d > g.lastAt) g.lastAt = d;
  });
  return Object.values(groups).sort((a, b) => b.count - a.count);
}

function renderAgentOrdersAndClicks(id, orders, clicks) {
  const container = document.getElementById(`agent-orders-inner-${id}`);
  if (!container) return;

  const ordersHtml = orders.length
    ? `<table class="dtable"><thead><tr><th>Order</th><th>Buyer</th><th>Date</th><th>Amount</th><th>Commission</th><th>Payment</th></tr></thead><tbody>
        ${orders.map((o) => `<tr>
          <td><span class="agent-code">${escapeHtml(o.orderNumber || ('#' + o._id.slice(-8).toUpperCase()))}</span></td>
          <td>${escapeHtml(o.buyer?.name || '-')}</td>
          <td>${new Date(o.createdAt).toLocaleDateString()}</td>
          <td>KSh ${(o.totalAmount || 0).toLocaleString()}</td>
          <td>KSh ${(o.commissionAmount || 0).toLocaleString()}</td>
          <td><span class="pill pill-${o.paymentStatus}">${o.paymentStatus.replace(/_/g, ' ')}</span></td>
        </tr>`).join('')}
      </tbody></table>`
    : `<div class="dash-empty"><p>No orders have used this agent's code yet.</p></div>`;

  const groupedClicks = groupReferralClicks(clicks);
  const totalClicks = (clicks || []).length;

  const clicksHtml = groupedClicks.length
    ? `<table class="dtable"><thead><tr><th>Link Type</th><th>Total Clicks</th><th>By Channel</th><th>Last Click</th></tr></thead><tbody>
        ${groupedClicks.map((g) => {
          const channelBreakdown = Object.entries(g.channels)
            .sort((a, b) => b[1] - a[1])
            .map(([ch, count]) => `<span class="pill" style="margin:2px 4px 2px 0; text-transform:capitalize;">${escapeHtml(ch)}: ${count}</span>`)
            .join('');
          return `<tr>
            <td><strong>${escapeHtml(CLICK_TYPE_LABELS[g.type] || g.type)}</strong></td>
            <td>${g.count}</td>
            <td class="wrap-cell">${channelBreakdown}</td>
            <td class="text-muted">${g.lastAt ? g.lastAt.toLocaleString() : '—'}</td>
          </tr>`;
        }).join('')}
      </tbody></table>`
    : `<div class="dash-empty"><p>No referral clicks logged yet.</p></div>`;

  container.innerHTML = `
    <h5 style="margin:0 0 8px; font-size:.85rem;">Orders</h5>${ordersHtml}
    <h5 style="margin:16px 0 8px; font-size:.85rem;">Referral Clicks${totalClicks ? ` <span class="text-muted" style="font-weight:400;">(${totalClicks} total${totalClicks >= 1000 ? '+' : ''})</span>` : ''}</h5>
    ${clicksHtml}`;
}

// NEW — renders everything the Agent model actually stores that the table
// row doesn't show: avatar, location, bio, payout details, verification
// docs (idNumber/kraPin/businessName), social/preferred channel.
function renderAgentProfileHtml(agent) {
  const payout = agent.payout || {};
  const verification = agent.verification || {};
  const social = agent.socialMedia || {};

  const payoutHtml = payout.method === 'bank'
    ? [
        verifField('Payout Method', 'Bank Transfer'),
        verifField('ID Number', escapeHtml(payout.idNumber || '')),
        verifField('Bank Name', escapeHtml(payout.bankName || '')),
        verifField('Branch', escapeHtml(payout.branchName || '')),
        verifField('Account Name', escapeHtml(payout.accountName || '')),
        verifField('Account Number', escapeHtml(payout.accountNumber || '')),
      ].join('')
    : [
        verifField('Payout Method', payout.method === 'mpesa' ? 'M-Pesa' : '— Not set —'),
        verifField('ID Number', escapeHtml(payout.idNumber || '')),
        verifField('M-Pesa Number', escapeHtml(payout.mpesaNumber || '')),
        verifField('M-Pesa Name', escapeHtml(payout.mpesaName || '')),
      ].join('');

  const socialChips = [
    linkChip('fa-brands fa-whatsapp', 'WhatsApp', social.whatsapp),
    linkChip('fa-brands fa-facebook', 'Facebook', social.facebook),
    linkChip('fa-brands fa-instagram', 'Instagram', social.instagram),
    linkChip('fa-brands fa-tiktok', 'TikTok', social.tiktok),
    linkChip('fa-brands fa-x-twitter', 'X', social.x),
    linkChip('fa-brands fa-linkedin', 'LinkedIn', social.linkedin),
  ].filter(Boolean);

  return `
    <div class="verif-section" style="margin-bottom:18px;">
      <h4 style="font-size:.85rem; margin-bottom:10px;"><i class="fa-solid fa-user-tie"></i> Agent Profile</h4>
      <div style="display:flex; gap:16px; align-items:flex-start; margin-bottom:14px;">
        ${agent.avatar
          ? `<img src="${agent.avatar}" alt="" style="width:64px; height:64px; border-radius:50%; object-fit:cover; flex-shrink:0;">`
          : `<div style="width:64px; height:64px; border-radius:50%; background:rgba(0,0,0,.06); display:flex; align-items:center; justify-content:center; flex-shrink:0;"><i class="fa-solid fa-user" style="font-size:22px; color:var(--ink-soft);"></i></div>`}
        <div>
          <div style="font-weight:700;">${escapeHtml(agent.name)}</div>
          <div class="text-muted" style="font-size:.8rem;">${escapeHtml(agent.location || 'No location set')}</div>
          <div class="text-muted" style="font-size:.8rem; margin-top:4px;">${escapeHtml(agent.bio || 'No bio provided')}</div>
        </div>
      </div>

      <div class="verif-field-grid" style="margin-bottom:14px;">
        ${verifField('Agent Type', agent.agentType ? agent.agentType.replace(/_/g, ' ') : '')}
        ${verifField('Preferred Channel', agent.preferredChannel || '')}
        ${verifField('Business Name (verification)', escapeHtml(verification.businessName || ''))}
        ${verifField('ID Number (verification)', escapeHtml(verification.idNumber || ''))}
        ${verifField('KRA PIN (verification)', escapeHtml(verification.kraPin || ''))}
        ${verifField('Lifetime Marketplace Profit', 'KES ' + (agent.lifetimeMarketplaceProfit || 0).toLocaleString())}
      </div>

      <h5 style="font-size:.8rem; margin-bottom:8px;"><i class="fa-solid fa-money-bill-transfer"></i> Payout Details</h5>
      <div class="verif-field-grid" style="margin-bottom:14px;">${payoutHtml}</div>

      <h5 style="font-size:.8rem; margin-bottom:8px;"><i class="fa-solid fa-share-nodes"></i> Social &amp; Contact</h5>
      <div class="chip-row">${socialChips.length ? socialChips.join('') : '<span class="text-muted">No social/contact links provided</span>'}</div>
    </div>`;
}

function openAgentModal(agent) {
  const modal = document.getElementById('agentModal');
  modal.dataset.agentId = agent?._id || '';
  document.getElementById('agentModalTitle').textContent = agent ? 'Edit Agent' : 'Add Agent';
  document.getElementById('agentName').value = agent?.name || '';
  document.getElementById('agentPhone').value = agent?.phone || '';
  document.getElementById('agentEmail').value = agent?.email || '';
  document.getElementById('agentCommission').value = agent?.commissionRate ?? 5;
  document.getElementById('agentActive').checked = agent ? agent.status === 'active' : true;

  const codeField = document.getElementById('agentCodeField');
  if (agent) {
    codeField.style.display = 'flex';
    document.getElementById('agentCodeDisplay').value = agent.code;
  } else {
    codeField.style.display = 'none';
  }
  openModal('agentModal');
}

async function submitAgentForm(e) {
  e.preventDefault();
  const modal = document.getElementById('agentModal');
  const id = modal.dataset.agentId;
  const payload = {
    name: document.getElementById('agentName').value.trim(),
    phone: document.getElementById('agentPhone').value.trim(),
    email: document.getElementById('agentEmail').value.trim(),
    commissionRate: Number(document.getElementById('agentCommission').value),
  };

  try {
    if (id) {
      await apiPut(`/agents/admin/${id}`, payload);
      showToast('Agent updated');
    } else {
      await apiPost('/agents/admin', payload);
      showToast('Agent created — welcome email sent with temp password');
    }
    closeModal('agentModal');
    loadAgentsList();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ---------- Badges ----------
async function loadBadges() {
  try {
    const { badges } = await apiGet('/agents/admin/badges');
    badgesCache = badges;
    if (agentsSubtab === 'badges') renderBadgesTable();
  } catch (err) {
    badgesCache = [];
  }
}

function renderBadgesTable() {
  const tbody = document.getElementById('badgesBody');
  if (!badgesCache.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="dash-empty"><i class="fa-solid fa-medal"></i><p>No badges yet. Add Bronze/Silver/Gold to get started.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = badgesCache
    .map((b) => {
      const r = b.requirements || {};
      const reqParts = [];
      if (r.minBuyerReferrals) reqParts.push(`${r.minBuyerReferrals} buyers`);
      if (r.minSellerReferrals) reqParts.push(`${r.minSellerReferrals} sellers`);
      if (r.minApprovedSellers) reqParts.push(`${r.minApprovedSellers} approved sellers`);
      if (r.minConfirmedCommission) reqParts.push(`KES ${r.minConfirmedCommission.toLocaleString()} commission`);
      if (r.minMarketplaceProfit) reqParts.push(`KES ${r.minMarketplaceProfit.toLocaleString()} profit`);

      return `
      <tr>
        <td><span class="badge-color-dot" style="background:${b.color}"></span><strong>${escapeHtml(b.name)}</strong></td>
        <td>${b.commissionRate}%</td>
        <td class="wrap-cell text-muted">${reqParts.join(', ') || 'None'}</td>
        <td>${b.isDefault ? '<span class="pill pill-active">Default</span>' : ''}</td>
        <td><label class="switch"><input type="checkbox" ${b.isActive ? 'checked' : ''} data-toggle-badge="${b._id}"><span class="track"></span></label></td>
        <td><div class="row-actions"><button class="act-edit" data-edit-badge="${b._id}">Edit</button><button class="act-reject" data-delete-badge="${b._id}">Delete</button></div></td>
      </tr>`;
    })
    .join('');

  tbody.querySelectorAll('[data-edit-badge]').forEach((btn) => btn.addEventListener('click', () => openBadgeModal(badgesCache.find((b) => b._id === btn.dataset.editBadge))));
  tbody.querySelectorAll('[data-delete-badge]').forEach((btn) => btn.addEventListener('click', () => deleteBadgeRow(btn.dataset.deleteBadge)));
  tbody.querySelectorAll('[data-toggle-badge]').forEach((toggle) =>
    toggle.addEventListener('change', async () => {
      try {
        await apiPatch(`/agents/admin/badges/${toggle.dataset.toggleBadge}`, { isActive: toggle.checked });
        showToast(`Badge ${toggle.checked ? 'activated' : 'deactivated'}`);
        loadBadges();
      } catch (err) {
        showToast(err.message, 'error');
        toggle.checked = !toggle.checked;
      }
    })
  );
}

function openBadgeModal(badge) {
  const modal = document.getElementById('badgeModal');
  modal.dataset.badgeId = badge?._id || '';
  document.getElementById('badgeModalTitle').textContent = badge ? 'Edit Badge' : 'Add Badge';
  document.getElementById('badgeName').value = badge?.name || '';
  document.getElementById('badgeSlug').value = badge?.slug || '';
  document.getElementById('badgeColor').value = badge?.color || '#c9791f';
  document.getElementById('badgeCommissionRate').value = badge?.commissionRate ?? '';
  document.getElementById('badgeSortOrder').value = badge?.sortOrder ?? 0;
  const r = badge?.requirements || {};
  document.getElementById('badgeMinBuyers').value = r.minBuyerReferrals || 0;
  document.getElementById('badgeMinSellers').value = r.minSellerReferrals || 0;
  document.getElementById('badgeMinApprovedSellers').value = r.minApprovedSellers || 0;
  document.getElementById('badgeMinCommission').value = r.minConfirmedCommission || 0;
  document.getElementById('badgeMinProfit').value = r.minMarketplaceProfit || 0;
  document.getElementById('badgeIsDefault').checked = !!badge?.isDefault;
  document.getElementById('badgeActive').checked = badge ? badge.isActive : true;
  openModal('badgeModal');
}

async function submitBadgeForm(e) {
  e.preventDefault();
  const modal = document.getElementById('badgeModal');
  const id = modal.dataset.badgeId;

  const payload = {
    name: document.getElementById('badgeName').value.trim(),
    slug: document.getElementById('badgeSlug').value.trim(),
    color: document.getElementById('badgeColor').value,
    commissionRate: Number(document.getElementById('badgeCommissionRate').value),
    sortOrder: Number(document.getElementById('badgeSortOrder').value) || 0,
    isDefault: document.getElementById('badgeIsDefault').checked,
    isActive: document.getElementById('badgeActive').checked,
    requirements: {
      minBuyerReferrals: Number(document.getElementById('badgeMinBuyers').value) || 0,
      minSellerReferrals: Number(document.getElementById('badgeMinSellers').value) || 0,
      minApprovedSellers: Number(document.getElementById('badgeMinApprovedSellers').value) || 0,
      minConfirmedCommission: Number(document.getElementById('badgeMinCommission').value) || 0,
      minMarketplaceProfit: Number(document.getElementById('badgeMinProfit').value) || 0,
    },
  };

  try {
    if (id) {
      await apiPatch(`/agents/admin/badges/${id}`, payload);
      showToast('Badge updated');
    } else {
      await apiPost('/agents/admin/badges', payload);
      showToast('Badge created');
    }
    closeModal('badgeModal');
    loadBadges().then(renderBadgesTable);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteBadgeRow(id) {
  if (!confirm('Delete this badge? Agents on it fall back to their flat commission rate.')) return;
  try {
    await apiDelete(`/agents/admin/badges/${id}`);
    showToast('Badge deleted');
    loadBadges().then(renderBadgesTable);
  } catch (err) {
    showToast(err.message, 'error');
  }
}



// ===================================================================
// MARKETING CENTER — assets + brand kit
// ===================================================================
function wireMarketingSubtabs() {
  document.querySelectorAll('#marketingSubtabBar button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#marketingSubtabBar button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      marketingSubtab = btn.dataset.marketingSubtab;
      document.getElementById('marketingPanelAssets').style.display = marketingSubtab === 'assets' ? 'block' : 'none';
      document.getElementById('marketingPanelBrandKit').style.display = marketingSubtab === 'brandkit' ? 'block' : 'none';
      if (marketingSubtab === 'brandkit') loadBrandKit();
    });
  });
}

async function loadMarketingTab() {
  if (!campaignsCache.length) {
    try { const { campaigns } = await apiGet('/campaigns/admin'); campaignsCache = campaigns; } catch (_) {}
  }
  if (marketingSubtab === 'assets') loadAssets();
  else loadBrandKit();
}

async function loadAssets() {
  const grid = document.getElementById('assetsGrid');
  grid.innerHTML = `<div class="spinner"></div>`;
  try {
    const params = new URLSearchParams();
    if (assetFilters.search) params.set('search', assetFilters.search);
    if (assetFilters.status) params.set('status', assetFilters.status);
    if (assetFilters.audience) params.set('audience', assetFilters.audience);
    const { assets } = await apiGet(`/marketing/admin/assets?${params.toString()}`);
    assetsCache = assets;

    if (!assets.length) {
      grid.innerHTML = `<div class="dash-empty"><i class="fa-solid fa-photo-film"></i><p>No assets match these filters.</p></div>`;
      return;
    }

    const statusOptions = ['draft', 'pending_review', 'approved', 'scheduled', 'published', 'expired', 'archived'];
    grid.innerHTML = assets
      .map((a) => {
        const icon = { image: 'fa-image', banner: 'fa-panorama', video: 'fa-video', flyer: 'fa-file-lines', document: 'fa-file-pdf' }[a.assetType] || 'fa-file';
        const thumb = a.thumbnailUrl || (['image', 'banner'].includes(a.assetType) ? a.fileUrl : '');
        return `
        <div class="asset-admin-card">
          <div class="asset-admin-card__thumb">
            ${a.isFeatured ? '<span class="asset-admin-card__featured">Featured</span>' : ''}
            ${thumb ? `<img src="${thumb}" alt="">` : `<i class="fa-solid ${icon}"></i>`}
          </div>
          <div class="asset-admin-card__body">
            <div class="asset-admin-card__title">${escapeHtml(a.title)}</div>
            <div class="asset-admin-card__meta">
              <span class="pill pill-${a.status}">${a.status.replace(/_/g, ' ')}</span>
              <span>v${a.version}</span>
              <span><i class="fa-solid fa-download"></i> ${a.downloadCount || 0}</span>
              <span><i class="fa-solid fa-share-nodes"></i> ${a.shareCount || 0}</span>
            </div>
            <div class="asset-admin-card__row">
              <select data-asset-status-select="${a._id}">${statusOptions.map((s) => `<option value="${s}" ${s === a.status ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`).join('')}</select>
            </div>
            <div class="asset-admin-card__row">
              <button class="act-edit" data-edit-asset="${a._id}">Edit</button>
              <button class="act-edit" data-replace-asset="${a._id}">Replace</button>
              <button class="act-edit" data-analytics-asset="${a._id}"><i class="fa-solid fa-chart-simple"></i></button>
              <button class="act-suspend" data-feature-asset="${a._id}">${a.isFeatured ? 'Unfeature' : 'Feature'}</button>
              <button class="act-reject" data-delete-asset="${a._id}">Delete</button>
            </div>
          </div>
        </div>`;
      })
      .join('');

    grid.querySelectorAll('[data-asset-status-select]').forEach((sel) =>
      sel.addEventListener('change', async () => {
        try {
          await apiPatch(`/marketing/admin/assets/${sel.dataset.assetStatusSelect}/status`, { status: sel.value });
          showToast('Asset status updated');
          loadAssets();
        } catch (err) {
          showToast(err.message, 'error');
        }
      })
    );
    grid.querySelectorAll('[data-edit-asset]').forEach((btn) => btn.addEventListener('click', () => openAssetModal(assetsCache.find((a) => a._id === btn.dataset.editAsset))));
    grid.querySelectorAll('[data-replace-asset]').forEach((btn) => btn.addEventListener('click', () => openAssetReplaceModal(btn.dataset.replaceAsset)));
    grid.querySelectorAll('[data-analytics-asset]').forEach((btn) => btn.addEventListener('click', () => openAssetAnalyticsModal(btn.dataset.analyticsAsset)));
    grid.querySelectorAll('[data-feature-asset]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        try { await apiPatch(`/marketing/admin/assets/${btn.dataset.featureAsset}/feature`); loadAssets(); } catch (err) { showToast(err.message, 'error'); }
      })
    );
    grid.querySelectorAll('[data-delete-asset]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this asset permanently?')) return;
        try { await apiDelete(`/marketing/admin/assets/${btn.dataset.deleteAsset}`); showToast('Asset deleted'); loadAssets(); } catch (err) { showToast(err.message, 'error'); }
      })
    );
  } catch (err) {
    grid.innerHTML = `<div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div>`;
  }
}

function renderAssetChannelsRow(selected = []) {
  const row = document.getElementById('assetChannelsRow');
  row.innerHTML = ASSET_CHANNELS.map((c) => `
    <label class="chip ${selected.includes(c) ? 'active' : ''}" data-channel-chip="${c}">
      <input type="checkbox" value="${c}" ${selected.includes(c) ? 'checked' : ''} style="display:none;"> ${c}
    </label>`).join('');
  row.querySelectorAll('[data-channel-chip]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const cb = chip.querySelector('input');
      cb.checked = !cb.checked;
      chip.classList.toggle('active', cb.checked);
    });
  });
}

function openAssetModal(asset) {
  const modal = document.getElementById('assetModal');
  modal.dataset.assetId = asset?._id || '';
  document.getElementById('assetModalTitle').textContent = asset ? 'Edit Asset' : 'Upload Asset';
  document.getElementById('assetTitle').value = asset?.title || '';
  document.getElementById('assetDescription').value = asset?.description || '';
  document.getElementById('assetType').value = asset?.assetType || 'image';
  document.getElementById('assetType').disabled = !!asset;
  document.getElementById('assetAudience').value = asset?.audience || 'everyone';
  document.getElementById('assetCta').value = asset?.cta || 'Shop Now';
  document.getElementById('assetPublishAt').value = asset?.publishAt ? asset.publishAt.slice(0, 16) : '';
  document.getElementById('assetExpiryAt').value = asset?.expiryAt ? asset.expiryAt.slice(0, 16) : '';
  document.getElementById('assetIsAcademy').checked = !!asset?.isAcademyContent;
  document.getElementById('assetFileInput').value = '';
  document.getElementById('assetThumbInput').value = '';
  document.getElementById('assetFileRequired').style.display = asset ? 'none' : 'inline';
  document.getElementById('assetCurrentFileHint').innerHTML = asset?.fileUrl
    ? `Current file: <a href="${asset.fileUrl}" target="_blank" rel="noopener">view</a> — leave file blank to keep metadata-only edit; use "Replace" on the card to swap the actual file.`
    : '';

  const campSelect = document.getElementById('assetCampaign');
  campSelect.innerHTML = `<option value="">None</option>` + campaignsCache.map((c) => `<option value="${c._id}" ${asset?.campaign?._id === c._id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');

  renderAssetChannelsRow(asset?.channels || []);
  openModal('assetModal');
}

async function submitAssetForm(e) {
  e.preventDefault();
  const modal = document.getElementById('assetModal');
  const id = modal.dataset.assetId;
  const file = document.getElementById('assetFileInput').files[0];

  if (!id && !file) {
    showToast('A file is required for a new asset', 'error');
    return;
  }

  const channels = Array.from(document.querySelectorAll('#assetChannelsRow input:checked')).map((i) => i.value);

  const fd = new FormData();
  fd.append('title', document.getElementById('assetTitle').value.trim());
  fd.append('description', document.getElementById('assetDescription').value.trim());
  if (!id) fd.append('assetType', document.getElementById('assetType').value);
  fd.append('audience', document.getElementById('assetAudience').value);
  fd.append('campaign', document.getElementById('assetCampaign').value);
  fd.append('cta', document.getElementById('assetCta').value.trim());
  fd.append('channels', JSON.stringify(channels));
  if (document.getElementById('assetPublishAt').value) fd.append('publishAt', document.getElementById('assetPublishAt').value);
  if (document.getElementById('assetExpiryAt').value) fd.append('expiryAt', document.getElementById('assetExpiryAt').value);
  fd.append('isAcademyContent', document.getElementById('assetIsAcademy').checked);
  if (file) fd.append('file', file);
  const thumb = document.getElementById('assetThumbInput').files[0];
  if (thumb) fd.append('thumbnail', thumb);

  try {
    if (id) {
      await apiPatch(`/marketing/admin/assets/${id}`, fd, true);
      showToast('Asset updated');
    } else {
      await apiPost('/marketing/admin/assets', fd, true);
      showToast('Asset created as draft');
    }
    closeModal('assetModal');
    loadAssets();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openAssetReplaceModal(id) {
  document.getElementById('assetReplaceModal').dataset.assetId = id;
  document.getElementById('assetReplaceForm').reset();
  openModal('assetReplaceModal');
}

async function submitAssetReplaceForm(e) {
  e.preventDefault();
  const id = document.getElementById('assetReplaceModal').dataset.assetId;
  const file = document.getElementById('assetReplaceFileInput').files[0];
  if (!file) { showToast('Choose a file', 'error'); return; }

  const fd = new FormData();
  fd.append('file', file);
  const thumb = document.getElementById('assetReplaceThumbInput').files[0];
  if (thumb) fd.append('thumbnail', thumb);

  try {
    await apiPost(`/marketing/admin/assets/${id}/replace`, fd, true);
    showToast('New version created — previous version archived');
    closeModal('assetReplaceModal');
    loadAssets();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function openAssetAnalyticsModal(id) {
  const asset = assetsCache.find((a) => a._id === id);
  document.getElementById('assetAnalyticsTitle').textContent = asset?.title || '';
  document.getElementById('assetAnalyticsStats').innerHTML = `<div class="stat-card"><div class="spinner"></div></div>`.repeat(3);
  document.getElementById('assetAnalyticsChannelsBody').innerHTML = '';
  openModal('assetAnalyticsModal');

  try {
    const data = await apiGet(`/marketing/admin/assets/${id}/analytics`);
    document.getElementById('assetAnalyticsStats').innerHTML = `
      <div class="stat-card"><div class="stat-label">Views</div><div class="stat-value">${data.asset.views}</div></div>
      <div class="stat-card"><div class="stat-label">Downloads</div><div class="stat-value">${data.asset.downloads}</div></div>
      <div class="stat-card"><div class="stat-label">Shares</div><div class="stat-value">${data.asset.shares}</div></div>`;
    document.getElementById('assetAnalyticsChannelsBody').innerHTML = data.channelBreakdown.length
      ? data.channelBreakdown.map((c) => `<tr><td>${escapeHtml(c._id)}</td><td>${c.count}</td></tr>`).join('')
      : `<tr><td colspan="2"><div class="dash-empty"><p>No shares yet.</p></div></td></tr>`;
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ---------- Brand Kit ----------
async function loadBrandKit() {
  try {
    const { brandKit } = await apiGet('/marketing/admin/brand-kit');
    document.getElementById('bkSiteName').value = brandKit.siteName || '';
    document.getElementById('bkSiteUrl').value = brandKit.siteUrl || '';
    document.getElementById('bkContactEmail').value = brandKit.contactEmail || '';
    document.getElementById('bkContactPhone').value = brandKit.contactPhone || '';
    document.getElementById('bkPrimaryColor').value = brandKit.primaryColor || '#101d31';
    document.getElementById('bkSecondaryColor').value = brandKit.secondaryColor || '#c9791f';
    document.getElementById('bkDefaultCta').value = brandKit.defaultCta || '';
    document.getElementById('bkLegalText').value = brandKit.legalText || '';
    document.getElementById('bkFacebook').value = brandKit.socialAccounts?.facebook || '';
    document.getElementById('bkInstagram').value = brandKit.socialAccounts?.instagram || '';
    document.getElementById('bkTiktok').value = brandKit.socialAccounts?.tiktok || '';
    document.getElementById('bkX').value = brandKit.socialAccounts?.x || '';
    document.getElementById('bkLogoPreview').innerHTML = brandKit.logo ? `<img src="${brandKit.logo}" alt="">` : '';
    document.getElementById('bkAltLogoPreview').innerHTML = brandKit.altLogo ? `<img src="${brandKit.altLogo}" alt="">` : '';
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function submitBrandKitForm(e) {
  e.preventDefault();
  const fd = new FormData();
  fd.append('siteName', document.getElementById('bkSiteName').value.trim());
  fd.append('siteUrl', document.getElementById('bkSiteUrl').value.trim());
  fd.append('contactEmail', document.getElementById('bkContactEmail').value.trim());
  fd.append('contactPhone', document.getElementById('bkContactPhone').value.trim());
  fd.append('primaryColor', document.getElementById('bkPrimaryColor').value);
  fd.append('secondaryColor', document.getElementById('bkSecondaryColor').value);
  fd.append('defaultCta', document.getElementById('bkDefaultCta').value.trim());
  fd.append('legalText', document.getElementById('bkLegalText').value.trim());
  fd.append('socialAccounts', JSON.stringify({
    facebook: document.getElementById('bkFacebook').value.trim(),
    instagram: document.getElementById('bkInstagram').value.trim(),
    tiktok: document.getElementById('bkTiktok').value.trim(),
    x: document.getElementById('bkX').value.trim(),
  }));
  const logo = document.getElementById('bkLogoInput').files[0];
  if (logo) fd.append('logo', logo);
  const altLogo = document.getElementById('bkAltLogoInput').files[0];
  if (altLogo) fd.append('altLogo', altLogo);

  try {
    await apiPatch('/marketing/admin/brand-kit', fd, true);
    showToast('Brand Kit saved');
    loadBrandKit();
  } catch (err) {
    showToast(err.message, 'error');
  }
}




// ===================================================================
// CAMPAIGNS
// ===================================================================
async function loadCampaigns() {
  const tbody = document.getElementById('campaignsBody');
  tbody.innerHTML = `<tr><td colspan="5"><div class="spinner"></div></td></tr>`;
  try {
    const { campaigns } = await apiGet('/campaigns/admin');
    campaignsCache = campaigns;

    if (!campaigns.length) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="dash-empty"><i class="fa-solid fa-bullhorn"></i><p>No campaigns yet.</p></div></td></tr>`;
      return;
    }

    const statusOptions = ['draft', 'scheduled', 'active', 'ended', 'archived'];
    tbody.innerHTML = campaigns
      .map((c) => `
      <tr>
        <td><strong>${escapeHtml(c.name)}</strong></td>
        <td class="text-muted" style="text-transform:capitalize;">${c.targetAudience}</td>
        <td class="text-muted">${new Date(c.startDate).toLocaleDateString()} – ${new Date(c.endDate).toLocaleDateString()}</td>
        <td><select data-campaign-status-select="${c._id}">${statusOptions.map((s) => `<option value="${s}" ${s === c.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
        <td><div class="row-actions">
          <button class="act-edit" data-edit-campaign="${c._id}">Edit</button>
          <button class="act-edit" data-analytics-campaign="${c._id}"><i class="fa-solid fa-chart-simple"></i></button>
          <button class="act-reject" data-delete-campaign="${c._id}">Delete</button>
        </div></td>
      </tr>`)
      .join('');

    tbody.querySelectorAll('[data-campaign-status-select]').forEach((sel) =>
      sel.addEventListener('change', async () => {
        try { await apiPatch(`/campaigns/admin/${sel.dataset.campaignStatusSelect}/status`, { status: sel.value }); showToast('Campaign status updated'); } catch (err) { showToast(err.message, 'error'); }
      })
    );
    tbody.querySelectorAll('[data-edit-campaign]').forEach((btn) => btn.addEventListener('click', () => openCampaignModal(campaignsCache.find((c) => c._id === btn.dataset.editCampaign))));
    tbody.querySelectorAll('[data-delete-campaign]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this campaign? Assets stay, but lose their campaign link.')) return;
        try { await apiDelete(`/campaigns/admin/${btn.dataset.deleteCampaign}`); showToast('Campaign deleted'); loadCampaigns(); } catch (err) { showToast(err.message, 'error'); }
      })
    );
    tbody.querySelectorAll('[data-analytics-campaign]').forEach((btn) => btn.addEventListener('click', () => openCampaignAnalytics(btn.dataset.analyticsCampaign)));
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

function openCampaignModal(campaign) {
  const modal = document.getElementById('campaignModal');
  modal.dataset.campaignId = campaign?._id || '';
  document.getElementById('campaignModalTitle').textContent = campaign ? 'Edit Campaign' : 'Add Campaign';
  document.getElementById('campaignName').value = campaign?.name || '';
  document.getElementById('campaignDescription').value = campaign?.description || '';
  document.getElementById('campaignStartDate').value = campaign?.startDate ? campaign.startDate.slice(0, 10) : '';
  document.getElementById('campaignEndDate').value = campaign?.endDate ? campaign.endDate.slice(0, 10) : '';
  document.getElementById('campaignAudience').value = campaign?.targetAudience || 'everyone';
  openModal('campaignModal');
}

async function submitCampaignForm(e) {
  e.preventDefault();
  const modal = document.getElementById('campaignModal');
  const id = modal.dataset.campaignId;
  const payload = {
    name: document.getElementById('campaignName').value.trim(),
    description: document.getElementById('campaignDescription').value.trim(),
    startDate: document.getElementById('campaignStartDate').value,
    endDate: document.getElementById('campaignEndDate').value,
    targetAudience: document.getElementById('campaignAudience').value,
  };

  try {
    if (id) {
      await apiPatch(`/campaigns/admin/${id}`, payload);
      showToast('Campaign updated');
    } else {
      await apiPost('/campaigns/admin', payload);
      showToast('Campaign created');
    }
    closeModal('campaignModal');
    loadCampaigns();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function openCampaignAnalytics(id) {
  try {
    const data = await apiGet(`/campaigns/admin/${id}/analytics`);
    alert(
      `${data.campaign.name} (${data.campaign.status})\n\n` +
      `Referral clicks: ${data.clicks}\n` +
      `Total downloads: ${data.totalDownloads}\n` +
      `Total shares: ${data.totalShares}\n` +
      `Assets in this campaign: ${data.assets.length}`
    );
  } catch (err) {
    showToast(err.message, 'error');
  }
}

















// ===================================================================
// AGENT COMMISSIONS
// ===================================================================
function wireCommissionsSubtabs() {
  document.querySelectorAll('#commissionsSubtabBar button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#commissionsSubtabBar button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      commissionsSubtab = btn.dataset.commissionsSubtab;
      document.getElementById('commissionsPanelLedger').style.display = commissionsSubtab === 'ledger' ? 'block' : 'none';
      document.getElementById('commissionsPanelRules').style.display = commissionsSubtab === 'rules' ? 'block' : 'none';
      document.getElementById('commissionsPanelAdjustments').style.display = commissionsSubtab === 'adjustments' ? 'block' : 'none';
      if (commissionsSubtab === 'ledger') loadCommissionLedger();
      if (commissionsSubtab === 'rules') loadRules();
      if (commissionsSubtab === 'adjustments') loadAdjustments();
    });
  });
}

function loadCommissionsTab() {
  if (commissionsSubtab === 'ledger') loadCommissionLedger();
  else if (commissionsSubtab === 'rules') loadRules();
  else loadAdjustments();
}

async function loadCommissionLedger() {
  const statsGrid = document.getElementById('commissionLedgerStats');
  statsGrid.innerHTML = `<div class="stat-card"><div class="spinner"></div></div>`.repeat(3);
  try {
    const { totals } = await apiGet('/commissions/admin/summary');
    statsGrid.innerHTML = `
      <div class="stat-card"><div class="stat-label">Total Generated</div><div class="stat-value">KES ${(totals.totalGenerated||0).toLocaleString()}</div></div>
      <div class="stat-card"><div class="stat-label">Pending</div><div class="stat-value">KES ${(totals.pending||0).toLocaleString()}</div></div>
      <div class="stat-card"><div class="stat-label">Confirmed</div><div class="stat-value">KES ${(totals.confirmed||0).toLocaleString()}</div></div>`;
  } catch (err) { statsGrid.innerHTML = `<div class="dash-empty"><p>${err.message}</p></div>`; }

  const tbody = document.getElementById('commLedgerBody');
  tbody.innerHTML = `<tr><td colspan="9"><div class="spinner"></div></td></tr>`;
  try {
    const params = new URLSearchParams();
    if (commLedgerFilters.status) params.set('status', commLedgerFilters.status);
    if (commLedgerFilters.referralType) params.set('referralType', commLedgerFilters.referralType);
    params.set('limit', 100);
    const { commissions } = await apiGet(`/commissions/admin?${params.toString()}`);

    if (!commissions.length) {
      tbody.innerHTML = `<tr><td colspan="9"><div class="dash-empty"><i class="fa-solid fa-sack-dollar"></i><p>No commissions match these filters.</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = commissions.map((c) => `
      <tr>
        <td><strong>${escapeHtml(c.agent?.name || '-')}</strong><div class="text-muted">${escapeHtml(c.agent?.code || '')}</div></td>
        <td><span class="agent-code">${escapeHtml(c.order?.orderNumber || '-')}</span></td>
        <td><span class="pill pill-${c.referralType.includes('buyer') ? 'buyer' : 'retailer'}">${c.referralType.replace('_referral', '')}</span></td>
        <td>KES ${(c.marketplaceProfit||0).toLocaleString()}</td>
        <td>${c.commissionRate}%</td>
        <td><strong>KES ${(c.commissionAmount||0).toLocaleString()}</strong></td>
        <td><span class="pill pill-${c.status === 'confirmed' ? 'active' : c.status === 'cancelled' || c.status === 'reversed' ? 'rejected' : 'pending_review'}">${c.status}</span></td>
        <td class="text-muted">${new Date(c.createdAt).toLocaleDateString()}</td>
        <td>${c.status === 'confirmed' ? `<button class="act-reject" data-reverse-comm="${c._id}">Reverse</button>` : ''}</td>
      </tr>`).join('');

    tbody.querySelectorAll('[data-reverse-comm]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (!confirm('Reverse this confirmed commission? This deducts it from the agent\'s total.')) return;
        try { await apiPatch(`/commissions/admin/${btn.dataset.reverseComm}/reverse`); showToast('Commission reversed'); loadCommissionLedger(); } catch (err) { showToast(err.message, 'error'); }
      })
    );
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

// ---------- Rules ----------
async function loadRules() {
  const tbody = document.getElementById('rulesBody');
  tbody.innerHTML = `<tr><td colspan="7"><div class="spinner"></div></td></tr>`;
  try {
    const { rules } = await apiGet('/commissions/admin/rules');
    rulesCache = rules;

    if (!rules.length) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="dash-empty"><i class="fa-solid fa-sliders"></i><p>No commission rules yet — agents fall back to their own flat rate.</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = rules.map((r) => `
      <tr>
        <td><strong>${escapeHtml(r.name)}</strong></td>
        <td class="text-muted">${r.audience.replace('_', ' ')}</td>
        <td class="text-muted">${r.badge ? escapeHtml(r.badge.name) : 'Any'}</td>
        <td>${r.commissionRate}%</td>
        <td>${r.priority}</td>
        <td><label class="switch"><input type="checkbox" ${r.isActive ? 'checked' : ''} data-toggle-rule="${r._id}"><span class="track"></span></label></td>
        <td><div class="row-actions"><button class="act-edit" data-edit-rule="${r._id}">Edit</button><button class="act-reject" data-delete-rule="${r._id}">Delete</button></div></td>
      </tr>`).join('');

    tbody.querySelectorAll('[data-edit-rule]').forEach((btn) => btn.addEventListener('click', () => openRuleModal(rulesCache.find((r) => r._id === btn.dataset.editRule))));
    tbody.querySelectorAll('[data-delete-rule]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this rule?')) return;
        try { await apiDelete(`/commissions/admin/rules/${btn.dataset.deleteRule}`); showToast('Rule deleted'); loadRules(); } catch (err) { showToast(err.message, 'error'); }
      })
    );
    tbody.querySelectorAll('[data-toggle-rule]').forEach((toggle) =>
      toggle.addEventListener('change', async () => {
        try { await apiPatch(`/commissions/admin/rules/${toggle.dataset.toggleRule}`, { isActive: toggle.checked }); showToast('Rule updated'); } catch (err) { showToast(err.message, 'error'); toggle.checked = !toggle.checked; }
      })
    );
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

function openRuleModal(rule) {
  const modal = document.getElementById('ruleModal');
  modal.dataset.ruleId = rule?._id || '';
  document.getElementById('ruleModalTitle').textContent = rule ? 'Edit Rule' : 'Add Commission Rule';
  document.getElementById('ruleName').value = rule?.name || '';
  document.getElementById('ruleAudience').value = rule?.audience || 'buyer_referral';
  document.getElementById('ruleCommissionRate').value = rule?.commissionRate ?? '';
  document.getElementById('rulePriority').value = rule?.priority ?? 0;
  document.getElementById('ruleActive').checked = rule ? rule.isActive : true;

  const badgeSelect = document.getElementById('ruleBadge');
  badgeSelect.innerHTML = `<option value="">Any badge</option>` + badgesCache.map((b) => `<option value="${b._id}" ${rule?.badge?._id === b._id ? 'selected' : ''}>${escapeHtml(b.name)}</option>`).join('');

  openModal('ruleModal');
}

async function submitRuleForm(e) {
  e.preventDefault();
  const modal = document.getElementById('ruleModal');
  const id = modal.dataset.ruleId;
  const payload = {
    name: document.getElementById('ruleName').value.trim(),
    audience: document.getElementById('ruleAudience').value,
    badge: document.getElementById('ruleBadge').value || null,
    commissionRate: Number(document.getElementById('ruleCommissionRate').value),
    priority: Number(document.getElementById('rulePriority').value) || 0,
    isActive: document.getElementById('ruleActive').checked,
  };

  try {
    if (id) {
      await apiPatch(`/commissions/admin/rules/${id}`, payload);
      showToast('Rule updated');
    } else {
      await apiPost('/commissions/admin/rules', payload);
      showToast('Rule created');
    }
    closeModal('ruleModal');
    loadRules();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ---------- Adjustments ----------
async function loadAdjustments() {
  const tbody = document.getElementById('adjustmentsBody');
  tbody.innerHTML = `<tr><td colspan="5"><div class="spinner"></div></td></tr>`;
  try {
    const { adjustments } = await apiGet('/commissions/admin/adjustments');
    adjustmentsCache = adjustments;

    if (!adjustments.length) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="dash-empty"><i class="fa-solid fa-sack-dollar"></i><p>No manual adjustments yet.</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = adjustments.map((a) => `
      <tr>
        <td><strong>${escapeHtml(a.agent?.name || '-')}</strong><div class="text-muted">${escapeHtml(a.agent?.code || '')}</div></td>
        <td style="color:${a.amount >= 0 ? 'var(--teal-deep)' : 'var(--brick)'}; font-weight:700;">${a.amount >= 0 ? '+' : ''}KES ${a.amount.toLocaleString()}</td>
        <td class="wrap-cell">${escapeHtml(a.reason)}</td>
        <td class="text-muted">${escapeHtml(a.addedBy?.name || '-')}</td>
        <td class="text-muted">${new Date(a.createdAt).toLocaleDateString()}</td>
      </tr>`).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

function openAdjustmentModal() {
  document.getElementById('adjustmentForm').reset();
  const sel = document.getElementById('adjustmentAgent');
  sel.innerHTML = agentsCache.map((a) => `<option value="${a._id}">${escapeHtml(a.name)} (${escapeHtml(a.code)})</option>`).join('');
  openModal('adjustmentModal');
}

async function submitAdjustmentForm(e) {
  e.preventDefault();
  const payload = {
    agentId: document.getElementById('adjustmentAgent').value,
    amount: Number(document.getElementById('adjustmentAmount').value),
    reason: document.getElementById('adjustmentReason').value.trim(),
  };
  try {
    await apiPost('/commissions/admin/adjustments', payload);
    showToast('Adjustment applied');
    closeModal('adjustmentModal');
    loadAdjustments();
  } catch (err) {
    showToast(err.message, 'error');
  }
}








// ===================================================================
// AGENT LEADS (oversight across all agents)
// ===================================================================
async function loadAgentLeads() {
  const tbody = document.getElementById('agentLeadsBody');
  tbody.innerHTML = `<tr><td colspan="7"><div class="spinner"></div></td></tr>`;
  try {
    const params = new URLSearchParams();
    if (alFilters.type) params.set('type', alFilters.type);
    if (alFilters.status) params.set('status', alFilters.status);
    const { leads } = await apiGet(`/recruitment/admin/leads?${params.toString()}`);
    agentLeadsCache = leads;

    if (!leads.length) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="dash-empty"><i class="fa-solid fa-address-book"></i><p>No leads match these filters.</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = leads.map((l) => `
      <tr>
        <td><strong>${escapeHtml(l.name)}</strong>${l.businessName ? `<div class="text-muted">${escapeHtml(l.businessName)}</div>` : ''}</td>
        <td><span class="pill pill-${l.leadType}">${l.leadType}</span></td>
        <td>${escapeHtml(l.agent?.name || '-')} <span class="agent-code">${escapeHtml(l.agent?.code || '')}</span></td>
        <td class="text-muted">${escapeHtml(l.phone || l.email || '—')}</td>
        <td class="text-muted">${escapeHtml(l.source)}</td>
        <td><span class="pill">${l.status.replace(/_/g, ' ')}</span></td>
        <td class="text-muted">${l.lastContactAt ? new Date(l.lastContactAt).toLocaleDateString() : '—'}</td>
      </tr>`).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}







// ===================================================================
// FRAUD & AUDIT
// ===================================================================
function wireFraudSubtabs() {
  document.querySelectorAll('#fraudSubtabBar button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#fraudSubtabBar button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      fraudSubtab = btn.dataset.fraudSubtab;
      document.getElementById('fraudPanelEvents').style.display = fraudSubtab === 'events' ? 'block' : 'none';
      document.getElementById('fraudPanelAudit').style.display = fraudSubtab === 'audit' ? 'block' : 'none';
      if (fraudSubtab === 'audit') loadAuditLogs();
    });
  });
}

function loadFraudTab() {
  if (fraudSubtab === 'events') loadFraudEvents();
  else loadAuditLogs();
}

async function loadFraudEvents() {
  const tbody = document.getElementById('fraudEventsBody');
  tbody.innerHTML = `<tr><td colspan="7"><div class="spinner"></div></td></tr>`;
  try {
    const params = new URLSearchParams();
    if (fraudFilters.status) params.set('status', fraudFilters.status);
    if (fraudFilters.severity) params.set('severity', fraudFilters.severity);
    const { events } = await apiGet(`/fraud/events?${params.toString()}`);

    if (!events.length) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="dash-empty"><i class="fa-solid fa-shield-halved"></i><p>No fraud events match these filters.</p></div></td></tr>`;
      return;
    }

    const severityPill = { low: 'pill-draft', medium: 'pill-pending_review', high: 'pill-rejected' };
    tbody.innerHTML = events.map((ev) => `
      <tr>
        <td>${escapeHtml(ev.agent?.name || '-')} <span class="agent-code">${escapeHtml(ev.agent?.code || '')}</span></td>
        <td class="text-muted">${ev.type.replace(/_/g, ' ')}</td>
        <td><span class="pill ${severityPill[ev.severity] || ''}">${ev.severity}</span></td>
        <td class="wrap-cell">${escapeHtml(ev.description)}</td>
        <td><span class="pill pill-${ev.status === 'open' ? 'pending_review' : ev.status === 'dismissed' ? 'draft' : 'active'}">${ev.status}</span></td>
        <td class="text-muted">${new Date(ev.createdAt).toLocaleDateString()}</td>
        <td>${ev.status === 'open' ? `<button class="act-edit" data-review-fraud="${ev._id}">Review</button>` : ''}</td>
      </tr>`).join('');

    tbody.querySelectorAll('[data-review-fraud]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const ev = events.find((e) => e._id === btn.dataset.reviewFraud);
        document.getElementById('fraudReviewModal').dataset.fraudId = ev._id;
        document.getElementById('fraudReviewDescription').textContent = ev.description;
        openModal('fraudReviewModal');
      })
    );
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

async function reviewFraudEvent(decision) {
  const id = document.getElementById('fraudReviewModal').dataset.fraudId;
  try {
    await apiPatch(`/fraud/events/${id}/review`, { decision });
    showToast(`Marked as ${decision}`);
    closeModal('fraudReviewModal');
    loadFraudEvents();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadAuditLogs() {
  const tbody = document.getElementById('auditLogsBody');
  tbody.innerHTML = `<tr><td colspan="5"><div class="spinner"></div></td></tr>`;
  try {
    const params = new URLSearchParams();
    if (auditFilters.search) params.set('action', auditFilters.search);
    params.set('page', auditFilters.page);
    params.set('limit', 20);
    const { logs, page, pages } = await apiGet(`/fraud/audit-logs?${params.toString()}`);
    auditLogsCache = logs;

    if (!logs.length) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="dash-empty"><i class="fa-solid fa-clipboard-list"></i><p>No matching audit entries.</p></div></td></tr>`;
      document.getElementById('auditPagination').innerHTML = '';
      return;
    }

    tbody.innerHTML = logs.map((l) => `
      <tr>
        <td>${escapeHtml(l.actor?.name || 'System')}</td>
        <td><span class="agent-code">${escapeHtml(l.action)}</span></td>
        <td class="text-muted">${escapeHtml(l.targetType || '-')}</td>
        <td class="wrap-cell text-muted">${escapeHtml(l.description || '')}</td>
        <td class="text-muted">${new Date(l.createdAt).toLocaleString()}</td>
      </tr>`).join('');

    renderAuditPagination(page, pages);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

function renderAuditPagination(page, pages) {
  const el = document.getElementById('auditPagination');
  if (pages <= 1) { el.innerHTML = ''; return; }
  let html = '';
  for (let i = 1; i <= pages; i++) html += `<button class="${i === page ? 'active' : ''}" data-page="${i}">${i}</button>`;
  el.innerHTML = html;
  el.querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => { auditFilters.page = Number(btn.dataset.page); loadAuditLogs(); }));
}











// ===================================================================
// TRANSACTION FEE TIERS (NEW — seller-side payment-processing fee ladder)
// ===================================================================
async function loadTransactionFeeTiers() {
  const tbody = document.getElementById('feeTiersBody');
  tbody.innerHTML = `<tr><td colspan="5"><div class="spinner"></div></td></tr>`;
  try {
    const { tiers } = await apiGet('/admin/transaction-fees');
    feeTiersCache = [...tiers].sort((a, b) => a.amountFrom - b.amountFrom);
    renderFeeTiersTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

function renderFeeTiersTable() {
  const tbody = document.getElementById('feeTiersBody');

  if (feeTiersCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="dash-empty"><i class="fa-solid fa-sack-dollar"></i><p>No fee tiers yet — sellers won't be charged any transaction fee until you add some.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = feeTiersCache
    .map(
      (t) => `
    <tr>
      <td>KSh ${t.amountFrom.toLocaleString()} – ${t.amountTo != null ? 'KSh ' + t.amountTo.toLocaleString() : 'and above'}</td>
      <td>KSh ${t.fee.toLocaleString()}</td>
      <td class="wrap-cell text-muted">${escapeHtml(t.label || '—')}</td>
      <td>
        <label class="switch">
          <input type="checkbox" ${t.isActive ? 'checked' : ''} data-toggle-fee-tier="${t._id}">
          <span class="track"></span>
        </label>
      </td>
      <td>
        <div class="row-actions">
          <button class="act-edit" data-edit-fee-tier="${t._id}">Edit</button>
          <button class="act-reject" data-delete-fee-tier="${t._id}">Delete</button>
        </div>
      </td>
    </tr>`
    )
    .join('');

  tbody.querySelectorAll('[data-edit-fee-tier]').forEach((btn) =>
    btn.addEventListener('click', () => openFeeTierModal(feeTiersCache.find((t) => t._id === btn.dataset.editFeeTier)))
  );
  tbody.querySelectorAll('[data-delete-fee-tier]').forEach((btn) =>
    btn.addEventListener('click', () => deleteFeeTierRow(btn.dataset.deleteFeeTier))
  );
  tbody.querySelectorAll('[data-toggle-fee-tier]').forEach((toggle) =>
    toggle.addEventListener('change', async () => {
      try {
        await apiPatch(`/admin/transaction-fees/${toggle.dataset.toggleFeeTier}`, { isActive: toggle.checked });
        showToast(`Tier ${toggle.checked ? 'activated' : 'deactivated'}`);
        loadTransactionFeeTiers();
      } catch (err) {
        showToast(err.message, 'error');
        toggle.checked = !toggle.checked;
      }
    })
  );
}

function openFeeTierModal(tier) {
  const modal = document.getElementById('feeTierModal');
  modal.dataset.tierId = tier?._id || '';
  document.getElementById('feeTierModalTitle').textContent = tier ? 'Edit Fee Tier' : 'Add Fee Tier';
  document.getElementById('feeTierFrom').value = tier?.amountFrom ?? '';
  document.getElementById('feeTierTo').value = tier?.amountTo ?? '';
  document.getElementById('feeTierFee').value = tier?.fee ?? '';
  document.getElementById('feeTierLabel').value = tier?.label || '';
  document.getElementById('feeTierActive').checked = tier ? tier.isActive : true;
  openModal('feeTierModal');
}

async function submitFeeTierForm(e) {
  e.preventDefault();
  const modal = document.getElementById('feeTierModal');
  const id = modal.dataset.tierId;

  const toRaw = document.getElementById('feeTierTo').value.trim();
  const payload = {
    amountFrom: Number(document.getElementById('feeTierFrom').value),
    amountTo: toRaw === '' ? null : Number(toRaw),
    fee: Number(document.getElementById('feeTierFee').value),
    label: document.getElementById('feeTierLabel').value.trim(),
    isActive: document.getElementById('feeTierActive').checked,
  };

  try {
    if (id) {
      await apiPatch(`/admin/transaction-fees/${id}`, payload);
      showToast('Fee tier updated');
    } else {
      await apiPost('/admin/transaction-fees', payload);
      showToast('Fee tier created');
    }
    closeModal('feeTierModal');
    loadTransactionFeeTiers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteFeeTierRow(id) {
  if (!confirm('Delete this fee tier permanently?')) return;
  try {
    await apiDelete(`/admin/transaction-fees/${id}`);
    showToast('Fee tier deleted');
    loadTransactionFeeTiers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===================================================================
// EARNINGS (marketplace commission + agent payouts + transaction fees)
// ===================================================================
async function loadEarnings() {
  await Promise.all([loadTransactionFeeTiers(), loadEarningsSummary(), loadEarningsOrders()]);
}

async function loadEarningsSummary() {
  const grid = document.getElementById('earningsStatGrid');
  grid.innerHTML = `<div class="stat-card"><div class="spinner"></div></div>`.repeat(5);
  try {
    const params = new URLSearchParams();
    params.set('paymentStatus', earningsFilters.paymentStatus);
    if (earningsFilters.from) params.set('from', earningsFilters.from);
    if (earningsFilters.to) params.set('to', earningsFilters.to);

    const data = await apiGet(`/admin/earnings/summary?${params.toString()}`);
    const t = data.totals;

    grid.innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Marketplace Commission</div>
        <div class="stat-value">KSh ${(t.totalMarketplaceCommission || 0).toLocaleString()}</div>
        <div class="stat-sub">Gross earnings from product sales</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Transaction Fees Charged</div>
        <div class="stat-value">KSh ${(t.totalTransactionFees || 0).toLocaleString()}</div>
        <div class="stat-sub">Tiered fee charged to sellers per order</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Agent Commission Paid</div>
        <div class="stat-value">KSh ${(t.totalAgentCommission || 0).toLocaleString()}</div>
        <div class="stat-sub">${t.ordersWithAgent || 0} orders used an agent code</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Net Marketplace Earnings</div>
        <div class="stat-value">KSh ${(data.netMarketplaceEarnings || 0).toLocaleString()}</div>
        <div class="stat-sub">Commission minus agent payouts</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Order Revenue</div>
        <div class="stat-value">KSh ${(t.totalRevenue || 0).toLocaleString()}</div>
        <div class="stat-sub">${t.totalOrders || 0} orders · KSh ${(t.totalSellerPayout || 0).toLocaleString()} to sellers</div>
      </div>
    `;

    const roleBody = document.getElementById('earningsRoleBody');
    roleBody.innerHTML = (data.roleBreakdown || []).length
      ? data.roleBreakdown
          .map(
            (r) => `
      <tr>
        <td><span class="pill pill-${r._id}">${r._id}</span></td>
        <td>${r.itemsSold}</td>
        <td>KSh ${(r.commission || 0).toLocaleString()}</td>
        <td>KSh ${(r.payout || 0).toLocaleString()}</td>
      </tr>`
          )
          .join('')
      : `<tr><td colspan="4"><div class="dash-empty"><p>No data for this range.</p></div></td></tr>`;

    const topSellersBody = document.getElementById('earningsTopSellersBody');
    topSellersBody.innerHTML = (data.topSellers || []).length
      ? data.topSellers
          .map(
            (s) => `
      <tr>
        <td>${escapeHtml(s.name || '-')}</td>
        <td><span class="pill pill-${s.role}">${s.role}</span></td>
        <td>${s.itemsSold}</td>
        <td>KSh ${(s.commission || 0).toLocaleString()}</td>
      </tr>`
          )
          .join('')
      : `<tr><td colspan="4"><div class="dash-empty"><p>No sellers yet.</p></div></td></tr>`;

    const topAgentsBody = document.getElementById('earningsTopAgentsBody');
    topAgentsBody.innerHTML = (data.topAgents || []).length
      ? data.topAgents
          .map(
            (a) => `
      <tr>
        <td>${escapeHtml(a.name || '-')}</td>
        <td><span class="agent-code">${escapeHtml(a.code || '')}</span></td>
        <td>${a.orders}</td>
        <td>KSh ${(a.commission || 0).toLocaleString()}</td>
      </tr>`
          )
          .join('')
      : `<tr><td colspan="4"><div class="dash-empty"><p>No agent-attributed orders yet.</p></div></td></tr>`;
  } catch (err) {
    grid.innerHTML = `<div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div>`;
  }
}

async function loadEarningsOrders() {
  const tbody = document.getElementById('earningsOrdersBody');
  tbody.innerHTML = `<tr><td colspan="9"><div class="spinner"></div></td></tr>`;
  try {
    const params = new URLSearchParams();
    params.set('paymentStatus', earningsFilters.paymentStatus);
    if (earningsFilters.from) params.set('from', earningsFilters.from);
    if (earningsFilters.to) params.set('to', earningsFilters.to);
    if (earningsFilters.search) params.set('search', earningsFilters.search);
    params.set('page', earningsFilters.page);
    params.set('limit', 15);

    const { orders, page, pages } = await apiGet(`/admin/earnings/orders?${params.toString()}`);
    earningsOrdersCache = orders;

    if (orders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9"><div class="dash-empty"><i class="fa-solid fa-sack-dollar"></i><p>No orders match these filters.</p></div></td></tr>`;
      document.getElementById('earningsPagination').innerHTML = '';
      return;
    }

    tbody.innerHTML = orders.map(earningsRowPairHtml).join('');

    tbody.querySelectorAll('[data-earn-toggle]').forEach((btn) =>
      btn.addEventListener('click', () => toggleEarningsDetail(btn.dataset.earnToggle))
    );

    renderEarningsPagination(page, pages);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

function earningsRowPairHtml(o) {
  return `
    <tr>
      <td><button type="button" class="row-toggle-btn" data-earn-toggle="${o._id}" aria-label="Expand"><i class="fa-solid fa-chevron-right"></i></button></td>
      <td><span class="agent-code">${escapeHtml(o.orderNumber || ('#' + o._id.slice(-8).toUpperCase()))}</span></td>
      <td>${new Date(o.createdAt).toLocaleDateString()}</td>
      <td><span class="pill pill-${o.paymentStatus}">${o.paymentStatus.replace(/_/g, ' ')}</span></td>
      <td>KSh ${(o.totalAmount || 0).toLocaleString()}</td>
      <td>KSh ${(o.marketplaceCommission || 0).toLocaleString()}</td>
      <td>KSh ${(o.transactionFeesTotal || 0).toLocaleString()}</td>
      <td>${o.agent ? 'KSh ' + (o.agentCommission || 0).toLocaleString() : '<span class="text-muted">—</span>'}</td>
      <td>KSh ${(o.netMarketplaceEarning || 0).toLocaleString()}</td>
    </tr>
    <tr class="order-detail-row" id="earn-detail-${o._id}" style="display:none;">
      <td colspan="9">${earningsDetailHtml(o)}</td>
    </tr>`;
}

function earningsDetailHtml(o) {
  const sellerNameMap = {};
  o.items.forEach((i) => {
    const sid = i.seller?._id || i.seller;
    if (sid) sellerNameMap[String(sid)] = i.seller?.businessName || i.seller?.shopName || i.seller?.name || 'Seller';
  });

  const feesHtml = (o.sellerFees || [])
    .map((f) => {
      const sid = f.seller?._id || f.seller;
      const label = sellerNameMap[String(sid)] || 'Seller';
      return `
      <tr>
        <td>${escapeHtml(label)}</td>
        <td>KSh ${(f.subtotal || 0).toLocaleString()}</td>
        <td class="text-muted">${escapeHtml(f.tier?.label || '—')}</td>
        <td>KSh ${(f.transactionFee || 0).toLocaleString()}</td>
      </tr>`;
    })
    .join('');

  const itemsHtml = o.items
    .map(
      (i) => `
    <tr>
      <td class="wrap-cell">${escapeHtml(i.name || '-')}</td>
      <td>${escapeHtml(i.seller?.businessName || i.seller?.shopName || i.seller?.name || '-')}</td>
      <td>${i.quantity}</td>
      <td>KSh ${(i.priceAtPurchase || 0).toLocaleString()}</td>
      <td>${i.commissionRate ?? 0}%</td>
      <td>KSh ${(i.commissionAmount || 0).toLocaleString()}</td>
      <td>KSh ${(i.sellerPayout || 0).toLocaleString()}</td>
    </tr>`
    )
    .join('');

  return `
    <div class="order-detail-panel-v2">
      <div class="od-stats">
        <div class="od-stat"><span class="od-stat-label">Buyer</span><span class="od-stat-value">${escapeHtml(o.buyer?.name || '-')}</span></div>
        <div class="od-stat tone-commission"><span class="od-stat-label">Marketplace Commission</span><span class="od-stat-value">KSh ${(o.marketplaceCommission || 0).toLocaleString()}</span></div>
        ${o.agent ? `<div class="od-stat"><span class="od-stat-label">Agent</span><span class="od-stat-value">${escapeHtml(o.agent.name)} (${escapeHtml(o.agent.code)})</span></div>` : ''}
        <div class="od-stat tone-payout"><span class="od-stat-label">Seller Payout</span><span class="od-stat-value">KSh ${(o.sellerPayout || 0).toLocaleString()}</span></div>
        <div class="od-stat"><span class="od-stat-label">Transaction Fees</span><span class="od-stat-value">KSh ${(o.transactionFeesTotal || 0).toLocaleString()}</span></div>
      </div>

      ${(o.sellerFees || []).length ? `
      <div class="od-items-wrap" style="margin-bottom:16px;">
        <h5><i class="fa-solid fa-sack-dollar"></i> Seller Transaction Fees</h5>
        <table class="dtable">
          <thead><tr><th>Seller</th><th>Subtotal</th><th>Tier</th><th>Fee</th></tr></thead>
          <tbody>${feesHtml}</tbody>
        </table>
      </div>` : ''}

      <div class="od-items-wrap">
        <h5><i class="fa-solid fa-boxes-stacked"></i> Item Commission Breakdown</h5>
        <table class="dtable">
          <thead><tr><th>Item</th><th>Seller</th><th>Qty</th><th>Price</th><th>Rate</th><th>Commission</th><th>Payout</th></tr></thead>
          <tbody>${itemsHtml}</tbody>
        </table>
      </div>
    </div>`;
}

function toggleEarningsDetail(id) {
  const row = document.getElementById(`earn-detail-${id}`);
  if (!row) return;
  const btn = document.querySelector(`[data-earn-toggle="${id}"] i`);
  const isOpen = row.style.display !== 'none';
  row.style.display = isOpen ? 'none' : 'table-row';
  if (btn) btn.className = isOpen ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down';
}

function renderEarningsPagination(page, pages) {
  const el = document.getElementById('earningsPagination');
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
      earningsFilters.page = Number(btn.dataset.page);
      loadEarningsOrders();
    })
  );
}

// ===================================================================
// MODAL HELPERS
// ===================================================================
function openModal(id) {
  document.getElementById(id).classList.add('show');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('show');
}
function wireModalCloseButtons() {
  document.querySelectorAll('[data-close-modal]').forEach((btn) =>
    btn.addEventListener('click', () => closeModal(btn.dataset.closeModal))
  );
  document.querySelectorAll('.modal-overlay').forEach((overlay) =>
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('show');
    })
  );
}

// ===================================================================
// UTIL
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