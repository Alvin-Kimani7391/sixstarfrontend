import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from './api.js';
import { showToast } from './toast.js';

// ===================================================================
// STATE
// ===================================================================
let currentUser = null;
let categoriesCache = []; // used to populate <select> dropdowns everywhere
let productFilters = { status: '', search: '', category: '', page: 1 };
let userFilters = { role: '' };
let orderSubTab = 'pending-payment';

// ===================================================================
// BOOT
// ===================================================================
document.addEventListener('DOMContentLoaded', init);

async function init() {
  wireLoginForm();
  wireSidebar();
  wireModalCloseButtons();
  wireStaticButtons();
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
  if (tab === 'ads') loadAds();
  if (tab === 'orders') loadOrdersTab();
  if (tab === 'users') loadUsers();
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
        <td class="wrap-cell"><strong>${escapeHtml(p.name)}</strong></td>
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
  modal.querySelector('#approveFinalPrice').value = product.sellerPrice || '';
  modal.querySelector('#approveDiscount').value = 0;
  modal.querySelector('#approveHotDeal').checked = false;
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
  document.getElementById('adForm').addEventListener('submit', submitAdForm);

  document.getElementById('addCategoryBtn').addEventListener('click', () => openCategoryModal(null));
  document.getElementById('addAdBtn').addEventListener('click', () => openAdModal(null));

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
  document.getElementById('editCategory').innerHTML = categoryOptionsHtml(product.category?._id);
  document.getElementById('editStock').value = product.stock ?? 0;
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
  formData.append('category', document.getElementById('editCategory').value);
  formData.append('stock', document.getElementById('editStock').value);
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
  tbody.innerHTML = `<tr><td colspan="4"><div class="spinner"></div></td></tr>`;
  try {
    const { categories } = await apiGet('/admin/categories');
    categoriesCache = categories;

    if (categories.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4"><div class="dash-empty"><i class="fa-solid fa-tags"></i><p>No categories yet. Add your first one.</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = categories
      .map(
        (c) => `
      <tr>
        <td>${c.image ? `<img class="thumb" src="${c.image}" alt="">` : ''}</td>
        <td><strong>${escapeHtml(c.name)}</strong><div class="text-muted">${c.slug}</div></td>
        <td>
          <label class="switch">
            <input type="checkbox" ${c.isActive ? 'checked' : ''} data-toggle-cat="${c._id}">
            <span class="track"></span>
          </label>
        </td>
        <td>
          <div class="row-actions">
            <button class="act-edit" data-edit-cat="${c._id}">Edit</button>
          </div>
        </td>
      </tr>`
      )
      .join('');

    tbody.querySelectorAll('[data-edit-cat]').forEach((btn) =>
      btn.addEventListener('click', () => openCategoryModal(categories.find((c) => c._id === btn.dataset.editCat)))
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
    tbody.innerHTML = `<tr><td colspan="4"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
}

function openCategoryModal(category) {
  const modal = document.getElementById('categoryModal');
  modal.dataset.categoryId = category?._id || '';
  document.getElementById('categoryModalTitle').textContent = category ? 'Edit Category' : 'Add Category';
  document.getElementById('categoryName').value = category?.name || '';
  document.getElementById('categoryImageInput').value = '';
  document.getElementById('categoryActive').checked = category ? category.isActive : true;
  openModal('categoryModal');
}

async function submitCategoryForm(e) {
  e.preventDefault();
  const modal = document.getElementById('categoryModal');
  const id = modal.dataset.categoryId;

  const formData = new FormData();
  formData.append('name', document.getElementById('categoryName').value.trim());
  formData.append('isActive', document.getElementById('categoryActive').checked);
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
// ORDERS (payment verification + full oversight)
// ===================================================================
function loadOrdersTab() {
  document.getElementById('panel-pending-payment').style.display = orderSubTab === 'pending-payment' ? 'block' : 'none';
  document.getElementById('panel-all-orders').style.display = orderSubTab === 'all-orders' ? 'block' : 'none';
  if (orderSubTab === 'pending-payment') loadPendingPayments();
  else loadAllOrders();
}

async function loadPendingPayments() {
  const tbody = document.getElementById('pendingPaymentsBody');
  tbody.innerHTML = `<tr><td colspan="6"><div class="spinner"></div></td></tr>`;
  try {
    const { orders } = await apiGet('/admin/orders/pending-payment');
    if (orders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="dash-empty"><i class="fa-solid fa-money-bill-wave"></i><p>No payments waiting for verification.</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = orders
      .map(
        (o) => `
      <tr>
        <td>${escapeHtml(o.buyer?.name || '-')}<div class="text-muted">${escapeHtml(o.buyer?.phone || '')}</div></td>
        <td>KSh ${o.totalAmount?.toLocaleString()}</td>
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
    tbody.innerHTML = `<tr><td colspan="6"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
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
  tbody.innerHTML = `<tr><td colspan="6"><div class="spinner"></div></td></tr>`;
  try {
    const { orders } = await apiGet('/admin/orders?limit=50');
    if (orders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="dash-empty"><i class="fa-solid fa-receipt"></i><p>No orders yet.</p></div></td></tr>`;
      return;
    }

    const statusOptions = ['processing', 'shipped', 'delivered', 'cancelled'];

    tbody.innerHTML = orders
      .map(
        (o) => `
      <tr>
        <td>${escapeHtml(o.buyer?.name || '-')}</td>
        <td>KSh ${o.totalAmount?.toLocaleString()}</td>
        <td><span class="pill pill-${o.paymentStatus}">${o.paymentStatus.replace(/_/g, ' ')}</span></td>
        <td>
          <select class="order-status-select" data-order="${o._id}">
            ${statusOptions.map((s) => `<option value="${s}" ${s === o.orderStatus ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </td>
        <td>${o.items.length} item(s)</td>
        <td>${new Date(o.createdAt).toLocaleDateString()}</td>
      </tr>`
      )
      .join('');

    tbody.querySelectorAll('.order-status-select').forEach((sel) =>
      sel.addEventListener('change', async () => {
        try {
          await apiPatch(`/orders/${sel.dataset.order}/status`, { orderStatus: sel.value });
          showToast('Order status updated');
        } catch (err) {
          showToast(err.message, 'error');
        }
      })
    );
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="dash-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.message}</p></div></td></tr>`;
  }
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
