import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from './api.js';
import { showToast } from './toast.js';

// ===================================================================
// STATE
// ===================================================================
let currentUser = null;
let categoriesCache = []; // used to populate <select> dropdowns everywhere
let attributesCache = []; // all attribute definitions (admin management + assignment picker)
let productFilters = { status: '', search: '', category: '', page: 1 };
let userFilters = { role: '' };
let orderSubTab = 'pending-payment';

// caches backing the expandable rows
let allOrdersCache = [];      // last fetched "all orders" list, keyed by lookup below
let agentOrdersCache = {};    // agentId -> orders[] (lazy-loaded on first expand)

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
  if (tab === 'shops') loadShops();
  if (tab === 'verification') loadVerifications();
  if (tab === 'legal') loadLegalDocuments();
  if (tab === 'ads') loadAds();
  if (tab === 'orders') loadOrdersTab();
  if (tab === 'users') loadUsers();
  if (tab === 'agents') loadAgents();
}

// ===================================================================
// OVERVIEW
// ===================================================================
async function loadOverview() {
  const grid = document.getElementById('statGrid');
  grid.innerHTML = `<div class="stat-card"><div class="spinner"></div></div>`.repeat(4);

  try {
    const [pending, payments, products, users] = await Promise.all([
      apiGet('/admin/products/pending'),
      apiGet('/admin/orders/pending-payment'),
      apiGet('/admin/products?limit=1'),
      apiGet('/admin/users'),
    ]);

    const wholesalers = users.users.filter((u) => u.role === 'wholesaler').length;
    const retailers = users.users.filter((u) => u.role === 'retailer').length;
    const buyers = users.users.filter((u) => u.role === 'buyer').length;

    grid.innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Pending Products</div>
        <div class="stat-value">${pending.count}</div>
        <div class="stat-sub">Awaiting price approval</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Pending Payments</div>
        <div class="stat-value">${payments.count}</div>
        <div class="stat-sub">M-Pesa needs verification</div>
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
// CATEGORIES
// ===================================================================
async function loadCategoriesTable() {
  const tbody = document.getElementById('categoriesBody');
  tbody.innerHTML = `<tr><td colspan="5"><div class="spinner"></div></td></tr>`;
  try {
    const { categories } = await apiGet('/admin/categories');
    categoriesCache = categories;

    if (categories.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="dash-empty"><i class="fa-solid fa-tags"></i><p>No categories yet. Add your first one.</p></div></td></tr>`;
      return;
    }

    const ordered = orderCategoriesAsTree(categories);

    tbody.innerHTML = ordered
      .map(({ c, depth }) => {
        const leaf = isLeafCategoryLocal(c._id);
        return `
      <tr>
        <td>${c.image ? `<img class="thumb" src="${c.image}" alt="">` : ''}</td>
        <td><strong>${'— '.repeat(depth)}${escapeHtml(c.name)}</strong><div class="text-muted">${c.slug}</div></td>
        <td>
          <label class="switch">
            <input type="checkbox" ${c.isActive ? 'checked' : ''} data-toggle-cat="${c._id}">
            <span class="track"></span>
          </label>
        </td>
        <td>
          ${leaf
            ? `<button class="act-edit" data-manage-attrs="${c._id}">Manage Attributes</button>`
            : `<span class="text-muted">Has subcategories</span>`}
        </td>
        <td>
          <div class="row-actions">
            <button class="act-edit" data-edit-cat="${c._id}">Edit</button>
          </div>
        </td>
      </tr>`;
      })
      .join('');

    tbody.querySelectorAll('[data-edit-cat]').forEach((btn) =>
      btn.addEventListener('click', () => openCategoryModal(categories.find((c) => c._id === btn.dataset.editCat)))
    );
    tbody.querySelectorAll('[data-manage-attrs]').forEach((btn) =>
      btn.addEventListener('click', () => openCategoryAttributesModal(categories.find((c) => c._id === btn.dataset.manageAttrs)))
    );
    tbody.querySelectorAll('[data-toggle-cat]').forEach((toggle) =>
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
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

// Walks the flat category list into parent-then-children order with a depth for indentation
function orderCategoriesAsTree(categories) {
  const byParent = {};
  categories.forEach((c) => {
    const parentId = c.parentCategory?._id || c.parentCategory || 'root';
    if (!byParent[parentId]) byParent[parentId] = [];
    byParent[parentId].push(c);
  });

  const result = [];
  function walk(parentId, depth) {
    const kids = byParent[parentId] || [];
    kids.forEach((c) => {
      result.push({ c, depth });
      walk(c._id, depth + 1);
    });
  }
  walk('root', 0);

  // safety net: any category whose parent got filtered out (e.g. inactive parent) still shows up
  const seenIds = new Set(result.map((r) => r.c._id));
  categories.forEach((c) => {
    if (!seenIds.has(c._id)) result.push({ c, depth: 0 });
  });

  return result;
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
// Shows this seller's pickup location once at the top, then every order
// that contains at least one of their items (backend already supports
// ?sellerId= on /admin/orders).
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
// LEGAL DOCUMENTS (Terms, Seller Agreement, policies — draft → published → archived)
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
// ORDERS (payment verification + full oversight, with expandable detail rows)
// ===================================================================
function loadOrdersTab() {
  document.getElementById('panel-pending-payment').style.display = orderSubTab === 'pending-payment' ? 'block' : 'none';
  document.getElementById('panel-all-orders').style.display = orderSubTab === 'all-orders' ? 'block' : 'none';
  if (orderSubTab === 'pending-payment') loadPendingPayments();
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
          sel.value = previousValue; // roll back the dropdown if the save failed
        } finally {
          sel.disabled = false;
        }
      })
    );
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

// Renders a normal summary row plus a hidden detail row right below it.
// Clicking the chevron toggles the detail row instead of navigating anywhere else.
// `scope` namespaces the toggle id/data-attribute so the same order can appear
// (and be independently expanded) in both the All Orders table and the
// per-seller Orders modal without id collisions.
function orderRowPairHtml(o, statusOptions, scope) {
  const id = o._id;
  return `
    <tr data-order-row="${id}">
      <td><button type="button" class="row-toggle-btn" data-order-toggle-${scope}="${id}" aria-label="Expand order"><i class="fa-solid fa-chevron-right"></i></button></td>
      <td><span class="agent-code">${escapeHtml(o.orderNumber || ('#' + id.slice(-8).toUpperCase()))}</span></td>
      <td>${escapeHtml(o.buyer?.name || '-')}</td>
      <td>KSh ${o.totalAmount?.toLocaleString()}</td>
      <td>${o.agentCode ? `<span class="pill-agent">${escapeHtml(o.agentCode)}</span>` : '<span class="text-muted">—</span>'}</td>
      <td><span class="pill pill-${o.paymentStatus}">${o.paymentStatus.replace(/_/g, ' ')}</span></td>
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

// Modern expand panel. Deliberately does NOT repeat buyer name, total, agent
// code, payment-status pill, or date — those are already visible in the
// collapsed row directly above. This surfaces what the row can't show:
// contact info, shipping address, seller pickup/warehouse location(s),
// payment verification trail, delivery-fee breakdown, agent commission,
// and the per-item table.
function orderDetailHtml(o) {
  const dd = o.deliveryDetails || {};
  const subtotal = (o.totalAmount || 0) - (o.deliveryFee || 0);

  const statsHtml = `
    <div class="od-stats">
      <div class="od-stat"><span class="od-stat-label">Subtotal</span><span class="od-stat-value">KSh ${subtotal.toLocaleString()}</span></div>
      <div class="od-stat"><span class="od-stat-label">Delivery Fee</span><span class="od-stat-value">KSh ${(o.deliveryFee || 0).toLocaleString()}</span></div>
      ${o.agent ? `<div class="od-stat"><span class="od-stat-label">Commission</span><span class="od-stat-value">KSh ${(o.commissionAmount || 0).toLocaleString()}</span></div>` : ''}
    </div>`;

  const contactCard = `
    <div class="od-card">
      <h5><i class="fa-solid fa-user"></i> Contact &amp; Shipping</h5>
      <div class="od-row"><span>Phone</span><span>${escapeHtml(o.buyer?.phone || '—')}</span></div>
      <div class="od-row"><span>Email</span><span>${escapeHtml(o.buyer?.email || '—')}</span></div>
      <div class="od-row"><span>Recipient</span><span>${escapeHtml(o.shippingAddress?.fullName || '—')}</span></div>
      <div class="od-row"><span>Address</span><span>${escapeHtml(o.shippingAddress?.address || '-')}${o.shippingAddress?.city ? ', ' + escapeHtml(o.shippingAddress.city) : ''}</span></div>
      ${o.shippingAddress?.notes ? `<div class="od-note">${escapeHtml(o.shippingAddress.notes)}</div>` : ''}
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

  // ---- Pickup Locations: one card per distinct seller in this order ----
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
      <div class="od-items-wrap">
        <h5><i class="fa-solid fa-boxes-stacked"></i> Items</h5>
        <table class="dtable">
          <thead><tr><th></th><th>Item</th><th>Seller</th><th>Qty</th><th>Price</th><th>Subtotal</th><th>Delivery</th></tr></thead>
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
// USERS (view + suspend/reactivate wholesalers, retailers, buyers)
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
// AGENTS (create, edit, activate/deactivate, delete + expandable order history)
// ===================================================================
async function loadAgents() {
  const tbody = document.getElementById('agentsBody');
  tbody.innerHTML = `<tr><td colspan="9"><div class="spinner"></div></td></tr>`;
  agentOrdersCache = {}; // reset lazy cache on every reload so numbers stay fresh
  try {
    const { agents } = await apiGet('/agents/admin/all');

    if (agents.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9"><div class="dash-empty"><i class="fa-solid fa-user-tie"></i><p>No agents yet. Add your first one.</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = agents.map((a) => agentRowPairHtml(a)).join('');

    tbody.querySelectorAll('[data-edit-agent]').forEach((btn) =>
      btn.addEventListener('click', () => openAgentModal(agents.find((a) => a._id === btn.dataset.editAgent)))
    );
    tbody.querySelectorAll('[data-delete-agent]').forEach((btn) =>
      btn.addEventListener('click', () => deleteAgentRow(btn.dataset.deleteAgent))
    );
    tbody.querySelectorAll('[data-toggle-agent]').forEach((toggle) =>
      toggle.addEventListener('change', async () => {
        try {
          await apiPut(`/agents/${toggle.dataset.toggleAgent}`, { isActive: toggle.checked });
          showToast(`Agent ${toggle.checked ? 'activated' : 'deactivated'}`);
        } catch (err) {
          showToast(err.message, 'error');
          loadAgents();
        }
      })
    );
    tbody.querySelectorAll('[data-agent-toggle]').forEach((btn) =>
      btn.addEventListener('click', () => toggleAgentDetail(btn.dataset.agentToggle))
    );
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

function agentRowPairHtml(a) {
  const id = a._id;
  return `
    <tr>
      <td><button type="button" class="row-toggle-btn" data-agent-toggle="${id}" aria-label="Expand agent"><i class="fa-solid fa-chevron-right"></i></button></td>
      <td><strong>${escapeHtml(a.name)}</strong></td>
      <td><span class="agent-code">${escapeHtml(a.code)}</span></td>
      <td>${escapeHtml(a.phone)}${a.email ? `<div class="text-muted">${escapeHtml(a.email)}</div>` : ''}</td>
      <td>${a.commissionRate}%</td>
      <td>${a.totalOrders}</td>
      <td>KSh ${(a.totalCommission || 0).toLocaleString()}</td>
      <td>
        <label class="switch">
          <input type="checkbox" ${a.isActive ? 'checked' : ''} data-toggle-agent="${id}">
          <span class="track"></span>
        </label>
      </td>
      <td>
        <div class="row-actions">
          <button class="act-edit" data-edit-agent="${id}">Edit</button>
          <button class="act-reject" data-delete-agent="${id}">Delete</button>
        </div>
      </td>
    </tr>
    <tr class="agent-detail-row" id="agent-detail-${id}" style="display:none;">
      <td colspan="9"><div id="agent-orders-${id}"><div class="spinner"></div></div></td>
    </tr>`;
}

async function toggleAgentDetail(id) {
  const row = document.getElementById(`agent-detail-${id}`);
  if (!row) return;
  const btn = document.querySelector(`[data-agent-toggle="${id}"] i`);
  const isOpen = row.style.display !== 'none';
  row.style.display = isOpen ? 'none' : 'table-row';
  if (btn) btn.className = isOpen ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down';

  if (!isOpen && !agentOrdersCache[id]) {
    try {
      const { orders } = await apiGet(`/agents/admin/${id}/orders`);
      agentOrdersCache[id] = orders;
      renderAgentOrders(id, orders);
    } catch (err) {
      const container = document.getElementById(`agent-orders-${id}`);
      if (container) container.innerHTML = `<div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div>`;
    }
  }
}

function renderAgentOrders(id, orders) {
  const container = document.getElementById(`agent-orders-${id}`);
  if (!container) return;

  if (!orders.length) {
    container.innerHTML = `<div class="dash-empty"><i class="fa-solid fa-receipt"></i><p>No orders have used this agent's code yet.</p></div>`;
    return;
  }

  container.innerHTML = `
    <table class="dtable">
      <thead>
        <tr><th>Order</th><th>Buyer</th><th>Date</th><th>Amount</th><th>Commission</th><th>Payment</th></tr>
      </thead>
      <tbody>
        ${orders
          .map(
            (o) => `
          <tr>
            <td><span class="agent-code">${escapeHtml(o.orderNumber || ('#' + o._id.slice(-8).toUpperCase()))}</span></td>
            <td>${escapeHtml(o.buyer?.name || '-')}<div class="text-muted">${escapeHtml(o.buyer?.phone || '')}</div></td>
            <td>${new Date(o.createdAt).toLocaleDateString()}</td>
            <td>KSh ${(o.totalAmount || 0).toLocaleString()}</td>
            <td>KSh ${(o.commissionAmount || 0).toLocaleString()}</td>
            <td><span class="pill pill-${o.paymentStatus}">${o.paymentStatus.replace(/_/g, ' ')}</span></td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
}

function openAgentModal(agent) {
  const modal = document.getElementById('agentModal');
  modal.dataset.agentId = agent?._id || '';
  document.getElementById('agentModalTitle').textContent = agent ? 'Edit Agent' : 'Add Agent';
  document.getElementById('agentName').value = agent?.name || '';
  document.getElementById('agentPhone').value = agent?.phone || '';
  document.getElementById('agentEmail').value = agent?.email || '';
  document.getElementById('agentCommission').value = agent?.commissionRate ?? 5;
  document.getElementById('agentActive').checked = agent ? agent.isActive : true;

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
    isActive: document.getElementById('agentActive').checked,
  };

  try {
    if (id) {
      await apiPut(`/agents/${id}`, payload);
      showToast('Agent updated');
    } else {
      await apiPost('/agents', payload);
      showToast('Agent created');
    }
    closeModal('agentModal');
    loadAgents();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteAgentRow(id) {
  if (!confirm('Delete this agent? Past orders keep their agent code regardless.')) return;
  try {
    await apiDelete(`/agents/${id}`);
    showToast('Agent deleted');
    loadAgents();
  } catch (err) {
    showToast(err.message, 'error');
  }
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