/* ============================================================
   SIX STAR SUPPLIERS — seller dashboard logic
   Works for both wholesalers and retailers (same page, same script).

   Fixes from the previous version:
   - loadCategories() now actually fills the <select id="pCategory">
     (this was the bug stopping sellers from seeing categories)
   - form now sends "sellerPrice" to match the backend field name
     (it was sending "price", which the backend silently ignored)
   - status keys now match the real backend enum:
     draft / pending_review / active / rejected / suspended
     (the old code used "approved", which never matched anything)
   - added Edit for draft/rejected products (backend already
     supports this via PUT /products/:id, the UI just didn't expose it)

   Routes used:
     GET    /api/products/my-products      (wholesaler/retailer)
     POST   /api/products                  (multipart, up to 8 images)
     PUT    /api/products/:id              (multipart, edit draft/rejected)
     PATCH  /api/products/:id/submit       (draft -> pending_review)
     GET    /api/categories
   ============================================================ */

(async () => {
  console.log("SELLER DASHBOARD SCRIPT STARTED");

  const user = await SS_AUTH.requireRole(["wholesaler", "retailer"]);

  if (!user) {
    console.log("Authentication failed");
    return;
  }

  console.log("User authenticated:", user.email, "Role:", user.role);

  const MAX_IMAGES = 8;

  const STATUS_LABEL = {
    draft: "Draft",
    pending_review: "Pending review",
    active: "Live",
    rejected: "Rejected",
    suspended: "Suspended",
  };

  const STATUS_ICON = {
    draft: "fa-file-pen",
    pending_review: "fa-hourglass-half",
    active: "fa-circle-check",
    rejected: "fa-circle-xmark",
    suspended: "fa-ban",
  };

  let allProducts = [];
  let allCategories = [];
  let activeStatus = "all";
  let searchTerm = "";
  let selectedFiles = []; // newly chosen files (create, or replacing images on edit)
  let pendingSubmitId = null;
  let editingProduct = null; // null = creating a new product, otherwise editing this one

  const els = {
    greeting: document.getElementById("greeting"),
    businessLine: document.getElementById("businessLine"),
    rolePill: document.getElementById("rolePill"),

    loadingGrid: document.getElementById("loadingGrid"),
    productGrid: document.getElementById("productGrid"),
    emptyState: document.getElementById("emptyState"),
    emptyMsg: document.getElementById("emptyMsg"),
    emptyAddBtn: document.getElementById("emptyAddBtn"),

    statusTabs: document.getElementById("statusTabs"),

    searchInput: document.getElementById("searchInput"),
    searchClear: document.getElementById("searchClear"),

    logoutBtn: document.getElementById("logoutBtn"),

    countDraft: document.getElementById("countDraft"),
    countPending: document.getElementById("countPending"),
    countActive: document.getElementById("countActive"),
    countRejected: document.getElementById("countRejected"),

    tabCountAll: document.getElementById("tabCountAll"),
    tabCountDraft: document.getElementById("tabCountDraft"),
    tabCountPending: document.getElementById("tabCountPending"),
    tabCountActive: document.getElementById("tabCountActive"),
    tabCountRejected: document.getElementById("tabCountRejected"),
    tabCountSuspended: document.getElementById("tabCountSuspended"),

    openAddProduct: document.getElementById("openAddProduct"),

    productModal: document.getElementById("productModal"),
    productModalTitle: document.getElementById("productModalTitle"),
    closeProductModal: document.getElementById("closeProductModal"),
    cancelProductForm: document.getElementById("cancelProductForm"),

    productForm: document.getElementById("productForm"),
    productFormError: document.getElementById("productFormError"),

    saveProductBtn: document.getElementById("saveProductBtn"),

    pCategory: document.getElementById("pCategory"),
    pDiscount: document.getElementById("pDiscount"),
    dropzone: document.getElementById("dropzone"),
    pImages: document.getElementById("pImages"),
    thumbRow: document.getElementById("thumbRow"),
    currentImagesRow: document.getElementById("currentImagesRow"),
    currentImagesHint: document.getElementById("currentImagesHint"),

    submitConfirm: document.getElementById("submitConfirm"),
    submitConfirmText: document.getElementById("submitConfirmText"),
    submitConfirmCancel: document.getElementById("submitConfirmCancel"),
    submitConfirmOk: document.getElementById("submitConfirmOk"),
  };

  function hideLoader() {
    const loader = document.getElementById("pageLoader");
    if (loader) {
      loader.classList.add("hide");
      loader.style.display = "none";
    }
  }

  hideLoader();

  if (els.greeting) {
    els.greeting.textContent = `Welcome back, ${user.name || "there"}`;
  }

  if (els.rolePill) {
    els.rolePill.innerHTML =
      user.role === "wholesaler"
        ? '<i class="fa-solid fa-warehouse"></i> Wholesaler'
        : '<i class="fa-solid fa-store"></i> Retailer';
  }

  const bizName = user.businessName || user.shopName;

  if (els.businessLine && (bizName || user.location)) {
    els.businessLine.innerHTML = [
      bizName ? `<strong>${escapeHtml(bizName)}</strong>` : null,
      user.location ? `<i class="fa-solid fa-location-dot"></i> ${escapeHtml(user.location)}` : null,
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (els.logoutBtn) {
    els.logoutBtn.onclick = async () => {
      await SS_API.logout();
      SS_AUTH.clear();
      location.href = "login.html";
    };
  }

  console.log("Starting data load");

  loadCategories();
  loadMyProducts();

  // ---------- products ----------
  async function loadMyProducts() {
    try {
      const res = await SS_API.getMyProducts();

      if (Array.isArray(res)) allProducts = res;
      else if (res.products) allProducts = res.products;
      else if (res.data) allProducts = res.data;
      else allProducts = [];

      updateCounts();
      renderGrid();
    } catch (err) {
      console.error("PRODUCT LOAD FAILED:", err);
      if (els.emptyState) {
        els.emptyState.style.display = "block";
        els.emptyMsg.textContent = err.message || "Couldn't load your products. Please refresh.";
      }
    } finally {
      hideLoader();
    }
  }

  // ---------- categories (fixes the "seller can't see categories" bug) ----------
  async function loadCategories() {
    try {
      const res = await SS_API.getCategories();
      allCategories = res.categories || res.data || (Array.isArray(res) ? res : []);

      if (els.pCategory) {
        if (allCategories.length === 0) {
          els.pCategory.innerHTML = `<option value="">No categories available yet</option>`;
        } else {
          els.pCategory.innerHTML =
            `<option value="" disabled selected>Select a category</option>` +
            allCategories.map((c) => `<option value="${c.id || c._id}">${escapeHtml(c.name)}</option>`).join("");
        }
      }
    } catch (err) {
      console.error("Category error:", err);
      if (els.pCategory) {
        els.pCategory.innerHTML = `<option value="">Couldn't load categories</option>`;
      }
      ssToast("Couldn't load categories. Refresh and try again.", "fa-triangle-exclamation");
    }
  }

  // ---------- counts + tabs ----------
  function updateCounts() {
    const counts = { draft: 0, pending_review: 0, active: 0, rejected: 0, suspended: 0 };
    allProducts.forEach((p) => {
      if (counts[p.status] !== undefined) counts[p.status]++;
    });

    if (els.countDraft) els.countDraft.textContent = counts.draft;
    if (els.countPending) els.countPending.textContent = counts.pending_review;
    if (els.countActive) els.countActive.textContent = counts.active;
    if (els.countRejected) els.countRejected.textContent = counts.rejected;

    if (els.tabCountAll) els.tabCountAll.textContent = allProducts.length;
    if (els.tabCountDraft) els.tabCountDraft.textContent = counts.draft;
    if (els.tabCountPending) els.tabCountPending.textContent = counts.pending_review;
    if (els.tabCountActive) els.tabCountActive.textContent = counts.active;
    if (els.tabCountRejected) els.tabCountRejected.textContent = counts.rejected;
    if (els.tabCountSuspended) els.tabCountSuspended.textContent = counts.suspended;
  }

  if (els.statusTabs) {
    els.statusTabs.addEventListener("click", (e) => {
      const btn = e.target.closest(".status-tab");
      if (!btn) return;
      document.querySelectorAll(".status-tab").forEach((t) => t.classList.remove("active"));
      btn.classList.add("active");
      activeStatus = btn.dataset.status;
      renderGrid();
    });
  }

  let searchDebounce;
  if (els.searchInput) {
    els.searchInput.addEventListener("input", () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        searchTerm = els.searchInput.value.trim().toLowerCase();
        renderGrid();
      }, 200);
    });
  }

  if (els.searchClear) {
    els.searchClear.addEventListener("click", () => {
      if (els.searchInput) els.searchInput.value = "";
      searchTerm = "";
      renderGrid();
    });
  }

  // ---------- render ----------
  function renderGrid() {
    if (els.loadingGrid) els.loadingGrid.style.display = "none";

    let list = allProducts;
    if (activeStatus !== "all") list = list.filter((p) => p.status === activeStatus);
    if (searchTerm) list = list.filter((p) => (p.name || "").toLowerCase().includes(searchTerm));

    if (!list.length) {
      if (els.productGrid) els.productGrid.style.display = "none";
      if (els.emptyState) {
        els.emptyState.style.display = "block";
        if (els.emptyAddBtn) els.emptyAddBtn.style.display = "inline-flex";
        els.emptyMsg.textContent = searchTerm
          ? `No products match "${searchTerm}".`
          : activeStatus === "all"
          ? "Add your first product to start selling on Six Star Suppliers."
          : `You don't have any ${STATUS_LABEL[activeStatus]?.toLowerCase() || ""} products right now.`;
      }
      return;
    }

    if (els.emptyState) els.emptyState.style.display = "none";
    if (els.productGrid) {
      els.productGrid.style.display = "grid";
      els.productGrid.innerHTML = list.map(cardHtml).join("");

      els.productGrid.querySelectorAll("[data-submit-id]").forEach((btn) => {
        btn.addEventListener("click", () => openSubmitConfirm(btn.dataset.submitId, btn.dataset.submitName));
      });
      els.productGrid.querySelectorAll("[data-edit-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const product = allProducts.find((p) => (p._id || p.id) === btn.dataset.editId);
          if (product) openProductModal(product);
        });
      });
    }
  }

  function cardHtml(p) {
    const id = p._id || p.id;
    const status = p.status || "draft";
    const cover = (p.images && p.images[0]) || "https://placehold.co/400x260/E4D6BD/5B564C?text=No+photo";
    const price = Number(p.sellerPrice ?? p.finalPrice ?? 0).toLocaleString();
    const canEdit = status === "draft" || status === "rejected";

    let actionHtml;
    if (status === "draft") {
      actionHtml = `
        <button class="btn btn-outline btn-sm" data-edit-id="${id}"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn btn-primary btn-sm" data-submit-id="${id}" data-submit-name="${escapeHtml(p.name)}"><i class="fa-solid fa-paper-plane"></i> Submit</button>`;
    } else if (status === "rejected") {
      actionHtml = `<button class="btn btn-primary btn-sm" data-edit-id="${id}"><i class="fa-solid fa-pen"></i> Edit &amp; Resubmit</button>`;
    } else if (status === "pending_review") {
      actionHtml = `<button class="btn btn-outline btn-sm" disabled><i class="fa-solid fa-hourglass-half"></i> Awaiting admin</button>`;
    } else if (status === "active") {
      actionHtml = `<button class="btn btn-outline btn-sm" disabled><i class="fa-solid fa-circle-check"></i> Live on storefront</button>`;
    } else {
      actionHtml = `<button class="btn btn-outline btn-sm" disabled><i class="fa-solid fa-ban"></i> Suspended by admin</button>`;
    }

    return `
      <div class="sp-card">
        <div class="sp-card__img">
          <img src="${cover}" alt="${escapeHtml(p.name)}" loading="lazy" />
          <span class="status-badge ${status} sp-card__badge"><i class="fa-solid ${STATUS_ICON[status] || "fa-circle"}"></i> ${STATUS_LABEL[status] || status}</span>
          ${p.isHotDeal ? '<span class="sp-card__hot">Hot deal</span>' : ""}
        </div>
        <div class="sp-card__body">
          <div class="sp-card__cat">${escapeHtml(p.category?.name || "Uncategorised")}</div>
          <div class="sp-card__name">${escapeHtml(p.name)}</div>
          <div class="sp-card__meta">
            <span class="price-tag">KES ${price}</span>
            <small>${p.stock ?? 0} in stock</small>
          </div>
          ${
            status === "rejected" && p.rejectionReason
              ? `<div class="sp-card__reject"><i class="fa-solid fa-circle-info"></i> ${escapeHtml(p.rejectionReason)}</div>`
              : ""
          }
          <div class="sp-card__foot">${actionHtml}</div>
        </div>
      </div>`;
  }

  if (els.emptyAddBtn) {
    els.emptyAddBtn.addEventListener("click", () => openProductModal(null));
  }

  // ---------- add / edit product modal ----------
  function openProductModal(product) {
    editingProduct = product || null;
    selectedFiles = [];

    if (els.productForm) els.productForm.reset();
    if (els.productFormError) els.productFormError.classList.remove("show");

    if (els.productModalTitle) {
      els.productModalTitle.textContent = editingProduct ? "Edit Product" : "Add New Product";
    }
    if (els.saveProductBtn) {
      els.saveProductBtn.textContent = editingProduct ? "Save changes" : "Save as draft";
    }

    if (editingProduct) {
      const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val ?? "";
      };
      setVal("pName", editingProduct.name);
      setVal("pStock", editingProduct.stock);
      setVal("pPrice", editingProduct.sellerPrice);
      setVal("pDesc", editingProduct.description);
      if (els.pDiscount) els.pDiscount.value = editingProduct.discountPercent || 0;
      if (els.pCategory) els.pCategory.value = editingProduct.category?._id || editingProduct.category?.id || editingProduct.category || "";

      if (els.currentImagesRow) {
        const imgs = editingProduct.images || [];
        els.currentImagesRow.innerHTML = imgs.map((src) => `<div class="thumb"><img src="${src}" alt=""></div>`).join("");
      }
      if (els.currentImagesHint) els.currentImagesHint.style.display = "block";
    } else {
      if (els.currentImagesRow) els.currentImagesRow.innerHTML = "";
      if (els.currentImagesHint) els.currentImagesHint.style.display = "none";
    }

    renderThumbs();
    if (els.productModal) els.productModal.classList.add("active");
  }

  function closeProductModal() {
    if (els.productModal) els.productModal.classList.remove("active");
    editingProduct = null;
  }

  if (els.openAddProduct) els.openAddProduct.addEventListener("click", () => openProductModal(null));
  if (els.closeProductModal) els.closeProductModal.addEventListener("click", closeProductModal);
  if (els.cancelProductForm) els.cancelProductForm.addEventListener("click", closeProductModal);
  if (els.productModal) {
    els.productModal.addEventListener("click", (e) => {
      if (e.target === els.productModal) closeProductModal();
    });
  }

  // ---------- image dropzone ----------
  if (els.dropzone) {
    els.dropzone.addEventListener("click", () => {
      if (els.pImages) els.pImages.click();
    });
  }

  if (els.pImages) {
    els.pImages.addEventListener("change", (e) => addFiles(e.target.files));
  }

  ["dragover", "dragleave", "drop"].forEach((evt) => {
    if (els.dropzone) {
      els.dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        els.dropzone.classList.toggle("drag", evt === "dragover");
        if (evt === "drop") addFiles(e.dataTransfer.files);
      });
    }
  });

  function addFiles(fileList) {
    const incoming = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    const room = MAX_IMAGES - selectedFiles.length;
    if (room <= 0) {
      ssToast(`You can upload up to ${MAX_IMAGES} photos`, "fa-triangle-exclamation");
      return;
    }
    selectedFiles = selectedFiles.concat(incoming.slice(0, room));
    if (incoming.length > room) ssToast(`Only added ${room} more — ${MAX_IMAGES} photo limit`, "fa-triangle-exclamation");
    renderThumbs();
  }

  function renderThumbs() {
    if (!els.thumbRow) return;

    els.thumbRow.innerHTML = selectedFiles
      .map((file, i) => {
        const url = URL.createObjectURL(file);
        return `<div class="thumb ${i === 0 && !editingProduct ? "cover" : ""}">
          <img src="${url}" alt="Photo ${i + 1}" />
          <button type="button" data-remove="${i}" aria-label="Remove photo"><i class="fa-solid fa-xmark"></i></button>
        </div>`;
      })
      .join("");

    els.thumbRow.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedFiles.splice(Number(btn.dataset.remove), 1);
        renderThumbs();
      });
    });
  }

  // ---------- submit add/edit product form ----------
  if (els.productForm) {
    els.productForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (els.productFormError) els.productFormError.classList.remove("show");

      const name = document.getElementById("pName")?.value.trim();
      const category = els.pCategory?.value;
      const stock = document.getElementById("pStock")?.value;
      const sellerPrice = document.getElementById("pPrice")?.value;
      const description = document.getElementById("pDesc")?.value.trim();
      const discountPercent = els.pDiscount?.value || 0;

      if (!category) {
        showFormError("Please choose a category.");
        return;
      }

      // A brand-new product needs at least one photo. When editing, the
      // product already has photos on the backend, so new ones are optional.
      if (!editingProduct && !selectedFiles.length) {
        showFormError("Add at least one product photo.");
        return;
      }

      const fd = new FormData();
      fd.append("name", name);
      fd.append("category", category);
      fd.append("stock", stock);
      fd.append("sellerPrice", sellerPrice);
      fd.append("discountPercent", discountPercent);
      fd.append("description", description);
      selectedFiles.forEach((file) => fd.append("images", file));

      if (els.saveProductBtn) {
        els.saveProductBtn.disabled = true;
        els.saveProductBtn.textContent = editingProduct ? "Saving…" : "Saving…";
      }

      try {
        if (editingProduct) {
          await SS_API.updateProduct(editingProduct._id || editingProduct.id, fd);
          ssToast("Product updated", "fa-circle-check");
        } else {
          await SS_API.createProduct(fd);
          ssToast("Product saved as draft", "fa-circle-check");
        }
        closeProductModal();
        loadMyProducts();
      } catch (err) {
        showFormError(err.message || "Couldn't save this product. Please try again.");
      } finally {
        if (els.saveProductBtn) {
          els.saveProductBtn.disabled = false;
          els.saveProductBtn.textContent = editingProduct ? "Save changes" : "Save as draft";
        }
      }
    });
  }

  function showFormError(msg) {
    if (els.productFormError) {
      els.productFormError.textContent = msg;
      els.productFormError.classList.add("show");
    }
  }

  // ---------- submit-for-review confirm ----------
  function openSubmitConfirm(id, name) {
    pendingSubmitId = id;
    if (els.submitConfirmText) {
      els.submitConfirmText.textContent = `Send "${name}" to the admin team for review? You won't be able to edit it while it's pending.`;
    }
    if (els.submitConfirm) els.submitConfirm.classList.add("active");
  }

  function closeSubmitConfirm() {
    if (els.submitConfirm) els.submitConfirm.classList.remove("active");
    pendingSubmitId = null;
  }

  if (els.submitConfirmCancel) els.submitConfirmCancel.addEventListener("click", closeSubmitConfirm);
  if (els.submitConfirm) {
    els.submitConfirm.addEventListener("click", (e) => {
      if (e.target === els.submitConfirm) closeSubmitConfirm();
    });
  }

  if (els.submitConfirmOk) {
    els.submitConfirmOk.addEventListener("click", async () => {
      if (!pendingSubmitId) return;
      els.submitConfirmOk.disabled = true;
      els.submitConfirmOk.textContent = "Submitting…";
      try {
        await SS_API.submitProduct(pendingSubmitId);
        ssToast("Submitted for review", "fa-paper-plane");
        closeSubmitConfirm();
        loadMyProducts();
      } catch (err) {
        ssToast(err.message || "Couldn't submit this product", "fa-triangle-exclamation");
      } finally {
        els.submitConfirmOk.disabled = false;
        els.submitConfirmOk.textContent = "Submit";
      }
    });
  }

  // ---------- utils ----------
  function escapeHtml(str = "") {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();
