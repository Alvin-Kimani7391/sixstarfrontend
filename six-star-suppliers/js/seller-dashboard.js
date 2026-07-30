/* ============================================================
   SIX STAR SUPPLIERS — seller dashboard logic
   Works for both wholesalers and retailers (same page, same script).

   Product creation now drives itself off the backend's dynamic
   category system, AND is presented as a step wizard:
     Step 1: Basics (name, category, description)
     Step 2: Pricing & stock (+ dynamic attributes)
     Step 3: Variants (only shown if the category needs them)
     Step 4: Wholesale details (wholesalers only)
     Step 5: Photos

   Category logic:
     - Category is picked as Parent Category -> Category -> Sub Category,
       walking the tree from GET /api/categories/tree until a leaf
       (no-further-children) category is reached.
     - Once a leaf category is picked, GET /api/categories/:id/attributes
       tells us which attribute fields to render. Attributes flagged
       isVariantAttribute (e.g. Size, Color) drive a variant builder
       instead of a plain field, since each combination needs its own
       stock count.
     - Wholesalers additionally get a "Wholesale details" section: MOQ,
       quantity-based pricing tiers, a transport-type toggle, and
       delivery terms. The transport toggle decides:
         'simple' -> ships like a normal retail product; no delivery
                     fields are shown or sent, buyer pays the standard
                     regional fee at checkout.
         'heavy'  -> the classic wholesale delivery panel applies
                     (free delivery, or fixed / per-unit / negotiated
                     charges). Retailers never see any of this section.

   Analytics:
   - A new header button opens a full-page Analytics overlay showing
     total views, a 14-day trend bar chart, and a per-product view
     breakdown, powered by GET /api/products/analytics.

   My Shop:
   - A header button opens a full-page "My Shop" overlay.
   - If the seller has no shop yet, shows an explainer + "Create my
     shop" button, which opens a form (POST /api/shops).
   - If a shop exists, shows a tabbed storefront preview (Overview /
     Products / Analytics / Settings) with an "Edit shop" button that
     opens the same form pre-filled (PUT /api/shops/my-shop).
   - Creating a shop and having it approved doesn't require any change
     to product creation — the backend silently attaches new products
     to an approved shop on its own.

   Orders:
   - Bell button opens a full professional "Orders" page (stat tiles,
     filter tabs, search, skeleton loading, contextual empty states).
   - Tapping an order in that list opens a further "Order detail" page.
   - Polling every 25s refreshes both orders and the product grid.
   - A toast fires the moment a genuinely new order appears.
   - Sellers can mark their own orders processing -> shipped -> delivered.
   - Buyer name/phone are never shown to the seller.
   - Prices shown are the seller's own asking price where available,
     with a one-time console diagnostic to help confirm the exact
     field name if it's still falling back to the admin's final price.

   Routes used:
     GET    /api/products/my-products
     GET    /api/products/analytics
     POST   /api/products
     PUT    /api/products/:id
     PATCH  /api/products/:id/submit
     GET    /api/categories/tree
     GET    /api/categories/:id/attributes
     GET    /api/orders/seller-orders
     PATCH  /api/orders/:id/status
     GET    /api/shops/my-shop
     POST   /api/shops
     PUT    /api/shops/my-shop
     PATCH  /api/shops/my-shop/toggle-active
   ============================================================ */

(async () => {
  console.log("SELLER DASHBOARD SCRIPT STARTED");

  const user = await SS_AUTH.requireRole(["wholesaler", "retailer"]);

  if (!user) {
    console.log("Authentication failed");
    return;
  }

  console.log("User authenticated:", user.email, "Role:", user.role);

  const IS_WHOLESALER = user.role === "wholesaler";

  const MAX_IMAGES = 8;
  const POLL_INTERVAL_MS = 25000;

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

  const ORDER_STATUS_LABEL = {
    processing: "Processing",
    shipped: "Shipped",
    delivered: "Delivered",
    cancelled: "Cancelled",
  };

  const PAYMENT_LABEL = {
    pending_verification: "Payment pending verification",
    confirmed: "Payment confirmed",
    rejected: "Payment rejected",
  };

  const SHOP_STATUS_LABEL = {
    pending_approval: "Pending approval",
    approved: "Approved",
    rejected: "Rejected",
    suspended: "Suspended",
  };

  // ---------- wizard step config ----------
  let currentStepIdx = 0;

  const STEP_META = {
    basic: { label: "Basics", icon: "fa-file-lines" },
    pricing: { label: "Pricing & stock", icon: "fa-tags" },
    variants: { label: "Variants", icon: "fa-layer-group" },
    wholesale: { label: "Wholesale", icon: "fa-warehouse" },
    photos: { label: "Photos", icon: "fa-images" },
  };

  function getActiveSteps() {
    const steps = ["basic", "pricing"];
    if (currentVariantDefs.length) steps.push("variants");
    if (IS_WHOLESALER) steps.push("wholesale");
    steps.push("photos");
    return steps;
  }

  let allProducts = [];
  let activeStatus = "all";
  let searchTerm = "";
  let selectedFiles = [];
  let pendingSubmitId = null;
  let editingProduct = null;

  let sellerOrders = [];
  let knownOrderIds = new Set();
  let firstOrdersLoad = true;
  let loggedSampleOrder = false;

  let ordersFilter = "all";
  let ordersSearchTerm = "";

  // ---------- shop state ----------
  let myShop = null; // null = no shop yet, otherwise the shop object from the API

  // ---------- category / attribute / variant state ----------
  let categoryTree = [];
  let categoryNodeMap = {}; // id -> node (node.children always present, [] if leaf)
  let selectedCategoryId = ""; // leaf category actually being submitted
  let currentSimpleDefs = []; // non-variant attribute definitions for selectedCategoryId
  let currentVariantDefs = []; // variant-defining attribute definitions for selectedCategoryId
  let variantRows = []; // [{ localId, values: { attrId: value }, stock, priceAdjustment, sku }]
  let variantRowSeq = 0;

  // ---------- wholesale-only state ----------
  let pricingTierRows = []; // [{ localId, minQty, price }]
  let tierRowSeq = 0;
  let currentDeliveryType = "heavy"; // 'simple' | 'heavy' — drives which fields show/submit

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

    // wizard controls
    wizardSteps: document.getElementById("wizardSteps"),
    wizardBackBtn: document.getElementById("wizardBackBtn"),
    wizardNextBtn: document.getElementById("wizardNextBtn"),

    // category cascade
    pParentCategory: document.getElementById("pParentCategory"),
    pCategoryLevel1: document.getElementById("pCategoryLevel1"),
    pCategoryLevel2: document.getElementById("pCategoryLevel2"),
    categoryPathHint: document.getElementById("categoryPathHint"),

    // stock
    pStockField: document.getElementById("pStockField"),
    pStock: document.getElementById("pStock"),
    stockVariantNote: document.getElementById("stockVariantNote"),

    pDiscount: document.getElementById("pDiscount"),
    dropzone: document.getElementById("dropzone"),
    pImages: document.getElementById("pImages"),
    thumbRow: document.getElementById("thumbRow"),
    currentImagesRow: document.getElementById("currentImagesRow"),
    currentImagesHint: document.getElementById("currentImagesHint"),

    // dynamic attributes
    attributesSection: document.getElementById("attributesSection"),
    dynamicAttributesGrid: document.getElementById("dynamicAttributesGrid"),
    noAttributesNote: document.getElementById("noAttributesNote"),

    // variants
    variantsSection: document.getElementById("variantsSection"),
    variantRowsWrap: document.getElementById("variantRows"),
    addVariantRow: document.getElementById("addVariantRow"),

    // wholesale
    wholesaleSection: document.getElementById("wholesaleSection"),
    pMOQ: document.getElementById("pMOQ"),
    pricingTierRowsWrap: document.getElementById("pricingTierRows"),
    addTierRow: document.getElementById("addTierRow"),

    // transport / delivery type toggle
    deliveryTypeGroup: document.getElementById("deliveryTypeGroup"),
    heavyDeliveryFields: document.getElementById("heavyDeliveryFields"),
    simpleDeliveryNote: document.getElementById("simpleDeliveryNote"),

    pFreeDelivery: document.getElementById("pFreeDelivery"),
    deliveryChargeFields: document.getElementById("deliveryChargeFields"),
    deliveryFixedFields: document.getElementById("deliveryFixedFields"),
    deliveryQtyFields: document.getElementById("deliveryQtyFields"),
    deliveryNegotiatedFields: document.getElementById("deliveryNegotiatedFields"),
    pDeliveryFixedAmount: document.getElementById("pDeliveryFixedAmount"),
    pDeliveryPerUnit: document.getElementById("pDeliveryPerUnit"),
    pDeliveryNotes: document.getElementById("pDeliveryNotes"),

    submitConfirm: document.getElementById("submitConfirm"),
    submitConfirmText: document.getElementById("submitConfirmText"),
    submitConfirmCancel: document.getElementById("submitConfirmCancel"),
    submitConfirmOk: document.getElementById("submitConfirmOk"),

    // orders bell + badge
    ordersBadge: document.getElementById("ordersBadge"),
    ordersToggleBtn: document.getElementById("ordersToggleBtn"),

    // orders list "page"
    ordersListOverlay: document.getElementById("ordersListOverlay"),
    ordersListBack: document.getElementById("ordersListBack"),
    ordersList: document.getElementById("ordersList"),
    ordersEmpty: document.getElementById("ordersEmpty"),
    ordersLoading: document.getElementById("ordersLoading"),
    ordersSubtitle: document.getElementById("ordersSubtitle"),
    ordersFilterTabs: document.getElementById("ordersFilterTabs"),
    ordersSearchInput: document.getElementById("ordersSearchInput"),
    statAll: document.getElementById("statAll"),
    statProcessing: document.getElementById("statProcessing"),
    statShipped: document.getElementById("statShipped"),
    statDelivered: document.getElementById("statDelivered"),

    // single order detail "page"
    orderDetailOverlay: document.getElementById("orderDetailOverlay"),
    orderDetailBody: document.getElementById("orderDetailBody"),
    orderDetailBack: document.getElementById("orderDetailBack"),

    // analytics "page"
    analyticsToggleBtn: document.getElementById("analyticsToggleBtn"),
    analyticsOverlay: document.getElementById("analyticsOverlay"),
    analyticsBack: document.getElementById("analyticsBack"),
    analyticsLoading: document.getElementById("analyticsLoading"),
    analyticsContent: document.getElementById("analyticsContent"),
    analyticsEmpty: document.getElementById("analyticsEmpty"),
    statTotalViews: document.getElementById("statTotalViews"),
    statViews14: document.getElementById("statViews14"),
    statTopProductViews: document.getElementById("statTopProductViews"),
    statTopProductLabel: document.getElementById("statTopProductLabel"),
    analyticsTrend: document.getElementById("analyticsTrend"),
    analyticsProductList: document.getElementById("analyticsProductList"),

    // My Shop "page"
    myShopToggleBtn: document.getElementById("myShopToggleBtn"),
    myShopOverlay: document.getElementById("myShopOverlay"),
    myShopBack: document.getElementById("myShopBack"),
    myShopLoading: document.getElementById("myShopLoading"),
    myShopEmpty: document.getElementById("myShopEmpty"),
    myShopContent: document.getElementById("myShopContent"),
    myShopErrorState: document.getElementById("myShopErrorState"),
    myShopErrorMsg: document.getElementById("myShopErrorMsg"),
    createShopBtn: document.getElementById("createShopBtn"),

    // create/edit shop modal
    shopFormModal: document.getElementById("shopFormModal"),
    shopFormTitle: document.getElementById("shopFormTitle"),
    shopFormSubtitle: document.getElementById("shopFormSubtitle"),
    closeShopFormModal: document.getElementById("closeShopFormModal"),
    shopForm: document.getElementById("shopForm"),
    shopFormError: document.getElementById("shopFormError"),
    shopNameInput: document.getElementById("shopNameInput"),
    shopCategoryInput: document.getElementById("shopCategoryInput"),
    shopDescInput: document.getElementById("shopDescInput"),
    shopLogoInput: document.getElementById("shopLogoInput"),
    shopBannerInput: document.getElementById("shopBannerInput"),
    shopHoursInput: document.getElementById("shopHoursInput"),
    cancelShopForm: document.getElementById("cancelShopForm"),
    saveShopBtn: document.getElementById("saveShopBtn"),
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

  // Retailers never deal in wholesale transport terms — hide the toggle entirely
  // for them (defensive: the whole wholesale step is already skipped for
  // retailers via getActiveSteps(), this just guards direct DOM access).
  if (!IS_WHOLESALER && els.deliveryTypeGroup) {
    els.deliveryTypeGroup.closest(".wizard-panel")?.setAttribute("hidden", "hidden");
  }

  if (els.logoutBtn) {
    els.logoutBtn.onclick = async () => {
      await SS_API.logout();
      SS_AUTH.clear();
      location.href = "login.html";
    };
  }

  console.log("Starting data load");

  loadCategoryTree();
  loadMyProducts();
  loadSellerOrders();

  setInterval(() => {
    loadSellerOrders();
    loadMyProducts({ silent: true });
  }, POLL_INTERVAL_MS);

  // ---------- products ----------
  async function loadMyProducts({ silent = false } = {}) {
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
      if (!silent && els.emptyState) {
        els.emptyState.style.display = "block";
        els.emptyMsg.textContent = err.message || "Couldn't load your products. Please refresh.";
      }
    } finally {
      hideLoader();
    }
  }

  // =========================================================
  // ---------- dynamic category cascade (Parent -> Category -> Sub Category) ----------
  // =========================================================
  async function loadCategoryTree() {
    try {
      const res = await SS_API.getCategoryTree();
      categoryTree = res.tree || res.categories || (Array.isArray(res) ? res : []);
      categoryNodeMap = {};
      indexCategoryNodes(categoryTree);
      populateCategorySelect(els.pParentCategory, categoryTree, "Select a category");
    } catch (err) {
      console.error("Category tree error:", err);
      if (els.pParentCategory) {
        els.pParentCategory.innerHTML = `<option value="">Couldn't load categories</option>`;
      }
      ssToast("Couldn't load categories. Refresh and try again.", "fa-triangle-exclamation");
    }
  }

  function indexCategoryNodes(nodes) {
    (nodes || []).forEach((n) => {
      const id = n._id || n.id;
      categoryNodeMap[id] = n;
      if (n.children && n.children.length) indexCategoryNodes(n.children);
    });
  }

  function populateCategorySelect(selectEl, nodes, placeholder) {
    if (!selectEl) return;
    if (!nodes || nodes.length === 0) {
      selectEl.innerHTML = `<option value="">${placeholder}</option>`;
      return;
    }
    selectEl.innerHTML =
      `<option value="" disabled selected>${placeholder}</option>` +
      nodes.map((n) => `<option value="${n._id || n.id}">${escapeHtml(n.name)}</option>`).join("");
  }

  function resetCategoryLevel(selectEl, placeholder) {
    if (!selectEl) return;
    selectEl.innerHTML = `<option value="">${placeholder}</option>`;
    selectEl.disabled = true;
  }

  function onCategoryLevelChosen(level, nodeId) {
    const node = categoryNodeMap[nodeId];
    if (!node) return;

    if (level === 0) {
      resetCategoryLevel(els.pCategoryLevel2, "—");
      if (node.children && node.children.length) {
        populateCategorySelect(els.pCategoryLevel1, node.children, "Select a sub-category");
        els.pCategoryLevel1.disabled = false;
        selectedCategoryId = "";
        clearCategoryDrivenUI();
      } else {
        // root itself is a leaf category
        resetCategoryLevel(els.pCategoryLevel1, "—");
        selectCategoryLeaf(nodeId);
      }
    } else if (level === 1) {
      resetCategoryLevel(els.pCategoryLevel2, "—");
      if (node.children && node.children.length) {
        populateCategorySelect(els.pCategoryLevel2, node.children, "Select the actual item");
        els.pCategoryLevel2.disabled = false;
        selectedCategoryId = "";
        clearCategoryDrivenUI();
      } else {
        selectCategoryLeaf(nodeId);
      }
    } else if (level === 2) {
      // level 2 is always the deepest allowed level (Parent -> Category -> Sub Category)
      selectCategoryLeaf(nodeId);
    }
  }

  if (els.pParentCategory) {
    els.pParentCategory.addEventListener("change", (e) => onCategoryLevelChosen(0, e.target.value));
  }
  if (els.pCategoryLevel1) {
    els.pCategoryLevel1.addEventListener("change", (e) => onCategoryLevelChosen(1, e.target.value));
  }
  if (els.pCategoryLevel2) {
    els.pCategoryLevel2.addEventListener("change", (e) => onCategoryLevelChosen(2, e.target.value));
  }

  async function selectCategoryLeaf(categoryId) {
    selectedCategoryId = categoryId;
    if (els.categoryPathHint) {
      els.categoryPathHint.textContent = "Loading the details this category needs…";
    }
    await loadAttributesForCategory(categoryId);
  }

  function clearCategoryDrivenUI() {
    currentSimpleDefs = [];
    currentVariantDefs = [];
    variantRows = [];
    if (els.attributesSection) els.attributesSection.style.display = "none";
    if (els.dynamicAttributesGrid) els.dynamicAttributesGrid.innerHTML = "";
    if (els.variantsSection) els.variantsSection.style.display = "none";
    if (els.variantRowsWrap) els.variantRowsWrap.innerHTML = "";
    setStockMode(false);
    if (els.categoryPathHint) {
      els.categoryPathHint.textContent = "Selecting a category loads its required product details automatically.";
    }
    renderWizard();
  }

  async function loadAttributesForCategory(categoryId) {
    try {
      const res = await SS_API.getCategoryAttributes(categoryId);
      const defs = res.attributes || [];
      currentSimpleDefs = defs.filter((d) => !d.isVariantAttribute);
      currentVariantDefs = defs.filter((d) => d.isVariantAttribute);

      renderAttributeFields(currentSimpleDefs);
      renderVariantSection(currentVariantDefs);
      renderWizard(); // steps change if variants appear/disappear for this category

      if (els.categoryPathHint) {
        els.categoryPathHint.textContent = defs.length
          ? "Fill in the details below for this category."
          : "This category doesn't need any extra details.";
      }
    } catch (err) {
      console.error("Category attributes error:", err);
      ssToast("Couldn't load details for that category", "fa-triangle-exclamation");
    }
  }

  // ---------- dynamic attribute fields ----------
  function renderAttributeFields(defs, prefillValues = {}) {
    if (!els.attributesSection || !els.dynamicAttributesGrid) return;

    if (!defs.length) {
      els.attributesSection.style.display = "block";
      els.dynamicAttributesGrid.innerHTML = "";
      if (els.noAttributesNote) els.noAttributesNote.style.display = "block";
      return;
    }

    if (els.noAttributesNote) els.noAttributesNote.style.display = "none";
    els.attributesSection.style.display = "block";

    els.dynamicAttributesGrid.innerHTML = defs
      .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
      .map((def) => attributeFieldHtml(def, prefillValues[def._id]))
      .join("");
  }

  function attributeFieldHtml(def, prefill) {
    const req = def.isRequired ? '<span class="attr-required-mark">*</span>' : "";
    const unit = def.unit ? ` (${escapeHtml(def.unit)})` : "";
    const label = `<label>${escapeHtml(def.name)}${unit} ${req}</label>`;

    if (def.type === "boolean") {
      const checked = prefill === true || prefill === "true" ? "checked" : "";
      return `<div class="form-field" data-attr-field="${def._id}">
        <div class="toggle-row"><input type="checkbox" id="attr_${def._id}" ${checked} /><label for="attr_${def._id}">${escapeHtml(def.name)}</label></div>
      </div>`;
    }

    if (def.type === "select" && Array.isArray(def.options) && def.options.length) {
      const options = def.options
        .map((o) => `<option value="${escapeHtml(o)}" ${prefill === o ? "selected" : ""}>${escapeHtml(o)}</option>`)
        .join("");
      return `<div class="form-field" data-attr-field="${def._id}">
        ${label}
        <select id="attr_${def._id}" ${def.isRequired ? "required" : ""}>
          <option value="">Select ${escapeHtml(def.name)}</option>${options}
        </select>
      </div>`;
    }

    if (def.type === "multiselect" && Array.isArray(def.options) && def.options.length) {
      const prefillArr = Array.isArray(prefill) ? prefill : [];
      const boxes = def.options
        .map(
          (o) => `<label style="font-weight:400;display:flex;gap:6px;align-items:center;margin:4px 0;">
            <input type="checkbox" value="${escapeHtml(o)}" ${prefillArr.includes(o) ? "checked" : ""} /> ${escapeHtml(o)}
          </label>`
        )
        .join("");
      return `<div class="form-field" data-attr-field="${def._id}" data-attr-multiselect="1">
        ${label}
        <div>${boxes}</div>
      </div>`;
    }

    const inputType = def.type === "number" ? "number" : "text";
    return `<div class="form-field" data-attr-field="${def._id}">
      ${label}
      <input type="${inputType}" id="attr_${def._id}" value="${prefill !== undefined && prefill !== null ? escapeHtml(String(prefill)) : ""}" ${def.isRequired ? "required" : ""} />
    </div>`;
  }

  function collectAttributesFromUI() {
    const result = [];
    currentSimpleDefs.forEach((def) => {
      const wrap = els.dynamicAttributesGrid.querySelector(`[data-attr-field="${def._id}"]`);
      if (!wrap) return;

      if (def.type === "boolean") {
        const checkbox = wrap.querySelector("input[type='checkbox']");
        result.push({ attribute: def._id, value: !!checkbox?.checked });
        return;
      }
      if (wrap.dataset.attrMultiselect) {
        const values = Array.from(wrap.querySelectorAll("input[type='checkbox']:checked")).map((c) => c.value);
        if (values.length) result.push({ attribute: def._id, value: values });
        return;
      }
      const input = wrap.querySelector("input, select");
      if (input && input.value !== "") {
        result.push({ attribute: def._id, value: input.value });
      }
    });
    return result;
  }

  function validateRequiredAttributes() {
    for (const def of currentSimpleDefs) {
      if (!def.isRequired) continue;
      const wrap = els.dynamicAttributesGrid.querySelector(`[data-attr-field="${def._id}"]`);
      if (!wrap) continue;
      if (def.type === "boolean") continue; // a checkbox is always "answered"
      const input = wrap.querySelector("input, select");
      if (!input || input.value === "") {
        return `"${def.name}" is required for this category`;
      }
    }
    return null;
  }

  // ---------- variant builder ----------
 function renderVariantSection(variantDefs) {
  if (!els.variantsSection) return;
  if (!variantDefs.length) {
    variantRows = [];
    setStockMode(false);
    return;
  }
  els.variantsSection.style.display = "block";   // <-- add this line
  setStockMode(true);
  if (variantRows.length === 0) addVariantRow();
  renderVariantRows();
}

  function setStockMode(isVariantMode) {
    if (!els.pStock) return;
    els.pStock.readOnly = isVariantMode;
    els.pStock.required = !isVariantMode;
    if (els.stockVariantNote) els.stockVariantNote.style.display = isVariantMode ? "block" : "none";
    if (isVariantMode) recomputeStockFromVariants();
  }

  function addVariantRow() {
    variantRows.push({ localId: ++variantRowSeq, values: {}, stock: "", priceAdjustment: "", sku: "" });
    renderVariantRows();
  }

  function removeVariantRow(localId) {
    variantRows = variantRows.filter((r) => r.localId !== localId);
    if (variantRows.length === 0) addVariantRow();
    else renderVariantRows();
  }

  function renderVariantRows() {
    if (!els.variantRowsWrap) return;
    els.variantRowsWrap.innerHTML = variantRows.map((row) => variantRowHtml(row)).join("");

    els.variantRowsWrap.querySelectorAll("[data-variant-remove]").forEach((btn) => {
      btn.addEventListener("click", () => removeVariantRow(Number(btn.dataset.variantRemove)));
    });
    els.variantRowsWrap.querySelectorAll("[data-variant-input]").forEach((input) => {
      input.addEventListener("input", () => {
        const localId = Number(input.dataset.variantRow);
        const row = variantRows.find((r) => r.localId === localId);
        if (!row) return;
        const field = input.dataset.variantInput;
        if (field === "stock" || field === "priceAdjustment" || field === "sku") {
          row[field] = input.value;
        } else {
          row.values[field] = input.value;
        }
        if (field === "stock") recomputeStockFromVariants();
      });
    });
  }

  function variantRowHtml(row) {
    const attrFields = currentVariantDefs
      .map((def) => {
        const val = row.values[def._id] || "";
        if (Array.isArray(def.options) && def.options.length) {
          const options = def.options
            .map((o) => `<option value="${escapeHtml(o)}" ${val === o ? "selected" : ""}>${escapeHtml(o)}</option>`)
            .join("");
          return `<div class="form-field">
            <label>${escapeHtml(def.name)}</label>
            <select data-variant-row="${row.localId}" data-variant-input="${def._id}">
              <option value="">Select ${escapeHtml(def.name)}</option>${options}
            </select>
          </div>`;
        }
        return `<div class="form-field">
          <label>${escapeHtml(def.name)}</label>
          <input type="text" data-variant-row="${row.localId}" data-variant-input="${def._id}" value="${escapeHtml(val)}" placeholder="${escapeHtml(def.name)}" />
        </div>`;
      })
      .join("");

    return `<div class="repeater-row">
      ${attrFields}
      <div class="form-field">
        <label>Stock</label>
        <input type="number" min="0" step="1" data-variant-row="${row.localId}" data-variant-input="stock" value="${escapeHtml(row.stock)}" placeholder="e.g. 20" />
      </div>
      <button type="button" class="btn-rm" data-variant-remove="${row.localId}" title="Remove variant"><i class="fa-solid fa-trash"></i></button>
    </div>`;
  }

  function recomputeStockFromVariants() {
    const total = variantRows.reduce((sum, r) => sum + (Number(r.stock) || 0), 0);
    if (els.pStock) els.pStock.value = total;
  }

  function collectVariantsFromUI() {
    return variantRows.map((row) => ({
      combination: currentVariantDefs.map((def) => ({ attribute: def._id, value: row.values[def._id] || "" })),
      stock: Number(row.stock) || 0,
      priceAdjustment: Number(row.priceAdjustment) || 0,
      sku: row.sku || "",
    }));
  }

  function validateVariantsBeforeSubmit() {
    if (!currentVariantDefs.length) return null;
    if (!variantRows.length) return "Add at least one variant for this category";
    for (const row of variantRows) {
      for (const def of currentVariantDefs) {
        if (!row.values[def._id]) return `Each variant needs a value for "${def.name}"`;
      }
      if (row.stock === "" || Number.isNaN(Number(row.stock)) || Number(row.stock) < 0) {
        return "Each variant needs a valid, non-negative stock number";
      }
    }
    return null;
  }

  if (els.addVariantRow) els.addVariantRow.addEventListener("click", addVariantRow);

  // =========================================================
  // ---------- wholesaler-only: transport type, MOQ, pricing tiers, delivery ----------
  // =========================================================

  function addTierRow(prefill) {
    pricingTierRows.push({
      localId: ++tierRowSeq,
      minQty: prefill?.minQty ?? "",
      price: prefill?.price ?? "",
    });
    renderTierRows();
  }

  function removeTierRow(localId) {
    pricingTierRows = pricingTierRows.filter((r) => r.localId !== localId);
    renderTierRows();
  }

  function renderTierRows() {
    if (!els.pricingTierRowsWrap) return;
    if (!pricingTierRows.length) {
      els.pricingTierRowsWrap.innerHTML = `<p class="form-hint">No pricing tiers added yet — your asking price applies to every quantity.</p>`;
      return;
    }
    els.pricingTierRowsWrap.innerHTML = pricingTierRows
      .map(
        (row) => `<div class="repeater-row">
        <div class="form-field">
          <label>Minimum quantity</label>
          <input type="number" min="1" step="1" data-tier-row="${row.localId}" data-tier-input="minQty" value="${escapeHtml(String(row.minQty))}" placeholder="e.g. 50" />
        </div>
        <div class="form-field">
          <label>Price per unit (KES)</label>
          <input type="number" min="0" step="0.01" data-tier-row="${row.localId}" data-tier-input="price" value="${escapeHtml(String(row.price))}" placeholder="e.g. 470" />
        </div>
        <div></div>
        <button type="button" class="btn-rm" data-tier-remove="${row.localId}" title="Remove tier"><i class="fa-solid fa-trash"></i></button>
      </div>`
      )
      .join("");

    els.pricingTierRowsWrap.querySelectorAll("[data-tier-remove]").forEach((btn) => {
      btn.addEventListener("click", () => removeTierRow(Number(btn.dataset.tierRemove)));
    });
    els.pricingTierRowsWrap.querySelectorAll("[data-tier-input]").forEach((input) => {
      input.addEventListener("input", () => {
        const row = pricingTierRows.find((r) => r.localId === Number(input.dataset.tierRow));
        if (row) row[input.dataset.tierInput] = input.value;
      });
    });
  }

  if (els.addTierRow) els.addTierRow.addEventListener("click", () => addTierRow());

  function collectPricingTiers() {
    return pricingTierRows
      .filter((r) => r.minQty !== "" && r.price !== "")
      .map((r) => ({ minQty: Number(r.minQty), price: Number(r.price) }));
  }

  // ---- transport type toggle (Simple vs Heavy) ----
  function setDeliveryTypeUI(type) {
    currentDeliveryType = type === "simple" ? "simple" : "heavy";

    if (els.deliveryTypeGroup) {
      els.deliveryTypeGroup.querySelectorAll(".delivery-type-card").forEach((card) => {
        card.classList.toggle("active", card.dataset.deliveryCard === currentDeliveryType);
      });
    }

    const isHeavy = currentDeliveryType === "heavy";
    if (els.heavyDeliveryFields) els.heavyDeliveryFields.style.display = isHeavy ? "block" : "none";
    if (els.simpleDeliveryNote) els.simpleDeliveryNote.style.display = isHeavy ? "none" : "block";
  }

  if (els.deliveryTypeGroup) {
    els.deliveryTypeGroup.querySelectorAll("input[name='deliveryType']").forEach((radio) => {
      radio.addEventListener("change", () => setDeliveryTypeUI(radio.value));
    });
  }

  // free delivery toggle hides/shows the delivery-charge fields (heavy only)
  if (els.pFreeDelivery) {
    els.pFreeDelivery.addEventListener("change", () => {
      if (els.deliveryChargeFields) {
        els.deliveryChargeFields.style.display = els.pFreeDelivery.checked ? "none" : "block";
      }
    });
  }

  // delivery charge type radios switch which field group is visible
  document.querySelectorAll("input[name='deliveryChargeType']").forEach((radio) => {
    radio.addEventListener("change", () => updateDeliveryChargeVisibility(radio.value));
  });

  function updateDeliveryChargeVisibility(type) {
    if (els.deliveryFixedFields) els.deliveryFixedFields.style.display = type === "fixed" ? "grid" : "none";
    if (els.deliveryQtyFields) els.deliveryQtyFields.style.display = type === "quantity_based" ? "grid" : "none";
    if (els.deliveryNegotiatedFields) els.deliveryNegotiatedFields.style.display = type === "negotiated" ? "block" : "none";
  }

  function collectDeliveryCharge() {
    const type = document.querySelector("input[name='deliveryChargeType']:checked")?.value || "fixed";
    if (type === "fixed") {
      return { chargeType: "fixed", amount: Number(els.pDeliveryFixedAmount?.value) || 0 };
    }
    if (type === "quantity_based") {
      return { chargeType: "quantity_based", perUnitAmount: Number(els.pDeliveryPerUnit?.value) || 0 };
    }
    return { chargeType: "negotiated", notes: els.pDeliveryNotes?.value || "" };
  }

  function resetWholesaleForm() {
    if (els.pMOQ) els.pMOQ.value = "";
    pricingTierRows = [];
    renderTierRows();

    setDeliveryTypeUI("heavy");
    if (els.deliveryTypeGroup) {
      els.deliveryTypeGroup.querySelectorAll("input[name='deliveryType']").forEach((r) => (r.checked = r.value === "heavy"));
    }

    if (els.pFreeDelivery) els.pFreeDelivery.checked = false;
    if (els.deliveryChargeFields) els.deliveryChargeFields.style.display = "block";
    document.querySelectorAll("input[name='deliveryChargeType']").forEach((r) => (r.checked = r.value === "fixed"));
    updateDeliveryChargeVisibility("fixed");
    if (els.pDeliveryFixedAmount) els.pDeliveryFixedAmount.value = "";
    if (els.pDeliveryPerUnit) els.pDeliveryPerUnit.value = "";
    if (els.pDeliveryNotes) els.pDeliveryNotes.value = "";
  }

  function prefillWholesaleForm(product) {
    if (!IS_WHOLESALER) return;
    if (els.pMOQ) els.pMOQ.value = product.minOrderQuantity || "";

    pricingTierRows = (product.pricingTiers || []).map((t) => ({ localId: ++tierRowSeq, minQty: t.minQty, price: t.price }));
    renderTierRows();

    const deliveryType = product.deliveryType === "simple" ? "simple" : "heavy";
    setDeliveryTypeUI(deliveryType);
    if (els.deliveryTypeGroup) {
      els.deliveryTypeGroup.querySelectorAll("input[name='deliveryType']").forEach((r) => (r.checked = r.value === deliveryType));
    }

    const free = !!product.freeDelivery;
    if (els.pFreeDelivery) els.pFreeDelivery.checked = free;
    if (els.deliveryChargeFields) els.deliveryChargeFields.style.display = free ? "none" : "block";

    const dc = product.deliveryCharge || {};
    const type = dc.chargeType || "fixed";
    document.querySelectorAll("input[name='deliveryChargeType']").forEach((r) => (r.checked = r.value === type));
    updateDeliveryChargeVisibility(type);
    if (els.pDeliveryFixedAmount) els.pDeliveryFixedAmount.value = dc.amount || "";
    if (els.pDeliveryPerUnit) els.pDeliveryPerUnit.value = dc.perUnitAmount || "";
    if (els.pDeliveryNotes) els.pDeliveryNotes.value = dc.notes || "";
  }

  // =========================================================
  // ---------- WIZARD: render / validate / navigate ----------
  // =========================================================
  function renderWizard() {
    const steps = getActiveSteps();
    if (currentStepIdx > steps.length - 1) currentStepIdx = steps.length - 1;
    if (currentStepIdx < 0) currentStepIdx = 0;

    if (els.wizardSteps) {
      els.wizardSteps.innerHTML = steps
        .map((key, i) => {
          const meta = STEP_META[key];
          const state = i < currentStepIdx ? "done" : i === currentStepIdx ? "active" : "";
          const pill = `<div class="wizard-step-pill ${state}">
            <span class="wizard-step-pill__num"><i class="fa-solid ${i < currentStepIdx ? "fa-check" : meta.icon}"></i></span>
            <span class="wizard-step-pill__label">${meta.label}</span>
          </div>`;
          const line = i < steps.length - 1 ? `<div class="wizard-step-line ${i < currentStepIdx ? "done" : ""}"></div>` : "";
          return pill + line;
        })
        .join("");
    }

    document.querySelectorAll("[data-step-panel]").forEach((panel) => {
      const idx = steps.indexOf(panel.dataset.stepPanel);
      panel.style.display = idx === currentStepIdx ? "flex" : "none";
    });

    const isLast = currentStepIdx === steps.length - 1;
    if (els.wizardBackBtn) els.wizardBackBtn.style.display = currentStepIdx === 0 ? "none" : "inline-flex";
    if (els.wizardNextBtn) els.wizardNextBtn.style.display = isLast ? "none" : "inline-flex";
    if (els.saveProductBtn) els.saveProductBtn.style.display = isLast ? "inline-flex" : "none";
  }

  function validateStep(key) {
    if (key === "basic") {
      const name = document.getElementById("pName")?.value.trim();
      if (!name) return "Please enter a product name.";
      if (!selectedCategoryId) return "Please choose the most specific category (down to the last level available).";
      const desc = document.getElementById("pDesc")?.value.trim();
      if (!desc) return "Please add a description.";
      return null;
    }
    if (key === "pricing") {
      if (!currentVariantDefs.length) {
        const stock = document.getElementById("pStock")?.value;
        if (stock === "" || Number(stock) < 1) return "Please enter a valid stock quantity.";
      }
      const price = document.getElementById("pPrice")?.value;
      if (!price || Number(price) <= 0) return "Please enter your asking price.";
      return validateRequiredAttributes();
    }
    if (key === "variants") return validateVariantsBeforeSubmit();
    if (key === "wholesale") return null;
    if (key === "photos") {
      if (!editingProduct && !selectedFiles.length) return "Add at least one product photo.";
      return null;
    }
    return null;
  }

  function handleWizardNext() {
    const steps = getActiveSteps();
    const err = validateStep(steps[currentStepIdx]);
    if (err) {
      showFormError(err);
      return;
    }
    if (els.productFormError) els.productFormError.classList.remove("show");
    if (currentStepIdx < steps.length - 1) {
      currentStepIdx++;
      renderWizard();
    }
  }

  function handleWizardBack() {
    if (currentStepIdx > 0) {
      currentStepIdx--;
      renderWizard();
      if (els.productFormError) els.productFormError.classList.remove("show");
    }
  }

  if (els.wizardNextBtn) els.wizardNextBtn.addEventListener("click", handleWizardNext);
  if (els.wizardBackBtn) els.wizardBackBtn.addEventListener("click", handleWizardBack);

  // ---------- orders ----------
  async function loadSellerOrders() {
    try {
      const res = await SS_API.getSellerOrders();
      const orders = res.orders || [];
      sellerOrders = orders;

      if (!loggedSampleOrder && orders.length && orders[0].items?.length) {
        console.log("SAMPLE ORDER ITEM (for seller-price field check):", orders[0].items[0]);
        loggedSampleOrder = true;
      }

      if (!firstOrdersLoad) {
        const newOnes = orders.filter((o) => !knownOrderIds.has(o._id));
        if (newOnes.length === 1) {
          const o = newOnes[0];
          const itemNames = o.items.map((i) => i.name).join(", ");
          ssToast(`New order ${o.orderNumber || ""}: ${itemNames}`, "fa-cart-shopping");
        } else if (newOnes.length > 1) {
          ssToast(`${newOnes.length} new orders came in`, "fa-cart-shopping");
        }
      }

      knownOrderIds = new Set(orders.map((o) => o._id));
      firstOrdersLoad = false;

      renderOrdersList(orders);
    } catch (err) {
      console.error("SELLER ORDERS LOAD FAILED:", err);
      if (els.ordersLoading) els.ordersLoading.style.display = "none";
      if (els.ordersEmpty) {
        els.ordersEmpty.style.display = "flex";
        els.ordersEmpty.innerHTML = `
          <i class="fa-solid fa-triangle-exclamation"></i>
          <h3>Couldn't load orders</h3>
          <p>${escapeHtml(err.message || "Will retry shortly.")}</p>`;
      }
    }
  }

  function renderOrdersList(orders) {
    if (els.ordersLoading) els.ordersLoading.style.display = "none";

    // live stat counts (always reflect the full unfiltered set)
    const counts = { processing: 0, shipped: 0, delivered: 0, cancelled: 0 };
    orders.forEach((o) => { if (counts[o.orderStatus] !== undefined) counts[o.orderStatus]++; });

    if (els.statAll) els.statAll.textContent = orders.length;
    if (els.statProcessing) els.statProcessing.textContent = counts.processing;
    if (els.statShipped) els.statShipped.textContent = counts.shipped;
    if (els.statDelivered) els.statDelivered.textContent = counts.delivered;

    if (els.ordersBadge) {
      if (counts.processing > 0) {
        els.ordersBadge.textContent = counts.processing;
        els.ordersBadge.style.display = "inline-flex";
      } else {
        els.ordersBadge.style.display = "none";
      }
    }

    if (!els.ordersList) return;

    // apply filter tab
    let filtered = orders;
    if (ordersFilter !== "all") {
      filtered = filtered.filter((o) => o.orderStatus === ordersFilter);
    }

    // apply search on order number
    if (ordersSearchTerm) {
      filtered = filtered.filter((o) => (o.orderNumber || "").toLowerCase().includes(ordersSearchTerm));
    }

    if (els.ordersSubtitle) {
      els.ordersSubtitle.textContent =
        orders.length === 0
          ? "All orders containing your products"
          : `${filtered.length} of ${orders.length} order${orders.length === 1 ? "" : "s"}`;
    }

    if (!orders.length) {
      els.ordersList.innerHTML = "";
      if (els.ordersEmpty) {
        els.ordersEmpty.style.display = "flex";
        els.ordersEmpty.innerHTML = `
          <i class="fa-solid fa-inbox"></i>
          <h3>No orders yet</h3>
          <p>New orders for your products will show up here the moment a buyer checks out.</p>`;
      }
      return;
    }

    if (!filtered.length) {
      els.ordersList.innerHTML = "";
      if (els.ordersEmpty) {
        els.ordersEmpty.style.display = "flex";
        els.ordersEmpty.innerHTML = `
          <i class="fa-solid fa-filter-circle-xmark"></i>
          <h3>No matching orders</h3>
          <p>Try a different filter or search term.</p>`;
      }
      return;
    }

    if (els.ordersEmpty) els.ordersEmpty.style.display = "none";

    els.ordersList.innerHTML = filtered
      .map((o) => `<div class="order-card-tap" data-order-id="${o._id}">${orderCardHtml(o)}</div>`)
      .join("");

    els.ordersList.querySelectorAll(".order-card-tap").forEach((wrapper) => {
      wrapper.addEventListener("click", (e) => {
        if (e.target.closest("[data-order-status-btn]")) return;
        const order = filtered.find((o) => o._id === wrapper.dataset.orderId);
        if (order) openOrderDetail(order);
      });
    });

    els.ordersList.querySelectorAll("[data-order-status-btn]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        advanceOrderStatus(btn.dataset.orderStatusBtn, btn.dataset.nextStatus);
      });
    });
  }

  // Resolve the price to display for an order item: prefer the seller's own
  // asking price over the admin's final buyer-facing price.
  function resolveSellerPrice(item) {
    return (
      item.sellerPrice ??
      item.sellerPriceAtPurchase ??
      item.originalSellerPrice ??
      item.product?.sellerPrice ??
      item.priceAtPurchase ??
      0
    );
  }

  function orderCardHtml(o) {
    const itemsHtml = o.items
      .map((i) => {
        const price = resolveSellerPrice(i);
        return `
        <div class="order-item-row">
          <img src="${i.image || 'https://placehold.co/60x60/E4D6BD/5B564C?text=%20'}" alt="" />
          <div class="order-item-info">
            <div class="order-item-name">${escapeHtml(i.name)}</div>
            <div class="order-item-meta">Qty ${i.quantity} · KES ${price.toLocaleString()} each</div>
          </div>
          <div class="order-item-total">KES ${(price * i.quantity).toLocaleString()}</div>
        </div>`;
      })
      .join("");

    const orderTotal = o.items.reduce((sum, i) => sum + resolveSellerPrice(i) * i.quantity, 0);

    const nextStatusMap = { processing: "shipped", shipped: "delivered" };
    const nextStatus = nextStatusMap[o.orderStatus];
    const isCancelled = o.orderStatus === "cancelled";

    const STEPS = ["processing", "shipped", "delivered"];
    const currentStepIndex = STEPS.indexOf(o.orderStatus);

    const stepperHtml = isCancelled
      ? `<div class="order-tracker order-tracker--cancelled"><i class="fa-solid fa-ban"></i> Order cancelled</div>`
      : `
      <div class="order-tracker">
        ${STEPS.map((step, i) => `
          <div class="tracker-step ${i <= currentStepIndex ? "done" : ""} ${i === currentStepIndex ? "current" : ""}">
            <div class="tracker-dot"><i class="fa-solid ${i < currentStepIndex ? "fa-check" : "fa-circle"}"></i></div>
            <span class="tracker-label">${ORDER_STATUS_LABEL[step]}</span>
          </div>
          ${i < STEPS.length - 1 ? `<div class="tracker-line ${i < currentStepIndex ? "done" : ""}"></div>` : ""}
        `).join("")}
      </div>`;

    return `
      <div class="order-card">
        <div class="order-card__head">
          <div class="order-card__id">
            <span class="order-card__number">${escapeHtml(o.orderNumber || "Order")}</span>
            <span class="order-card__time">${timeAgo(o.createdAt)}</span>
          </div>
          <span class="payment-pill ${o.paymentStatus}">
            <i class="fa-solid ${o.paymentStatus === "confirmed" ? "fa-circle-check" : o.paymentStatus === "rejected" ? "fa-circle-xmark" : "fa-clock"}"></i>
            ${PAYMENT_LABEL[o.paymentStatus] || o.paymentStatus}
          </span>
        </div>

        ${stepperHtml}

        <div class="order-card__items">${itemsHtml}</div>

        <div class="order-card__foot">
          <div class="order-card__total">
            <span>Total</span>
            <strong>KES ${orderTotal.toLocaleString()}</strong>
          </div>
          ${
            nextStatus && !isCancelled
              ? `<button type="button" class="btn btn-primary btn-sm" data-order-status-btn="${o._id}" data-next-status="${nextStatus}">
                   Mark as ${ORDER_STATUS_LABEL[nextStatus]} <i class="fa-solid fa-arrow-right"></i>
                 </button>`
              : isCancelled
              ? ""
              : `<span class="order-complete-tag"><i class="fa-solid fa-circle-check"></i> Delivered</span>`
          }
        </div>
      </div>`;
  }

  function timeAgo(dateStr) {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  }

  // ---------- orders list "page" (opened by the bell) ----------
  function openOrdersList() {
    if (!els.ordersListOverlay) return;
    els.ordersListOverlay.classList.add("active");
    document.body.style.overflow = "hidden";
    loadSellerOrders();
  }

  function closeOrdersList() {
    if (els.ordersListOverlay) els.ordersListOverlay.classList.remove("active");
    if (
      !els.orderDetailOverlay?.classList.contains("active") &&
      !els.analyticsOverlay?.classList.contains("active") &&
      !els.myShopOverlay?.classList.contains("active")
    ) {
      document.body.style.overflow = "";
    }
  }

  if (els.ordersToggleBtn) {
    els.ordersToggleBtn.addEventListener("click", openOrdersList);
  }
  if (els.ordersListBack) {
    els.ordersListBack.addEventListener("click", closeOrdersList);
  }

  if (els.ordersFilterTabs) {
    els.ordersFilterTabs.addEventListener("click", (e) => {
      const btn = e.target.closest(".orders-filter-tab");
      if (!btn) return;
      els.ordersFilterTabs.querySelectorAll(".orders-filter-tab").forEach((t) => t.classList.remove("active"));
      btn.classList.add("active");
      ordersFilter = btn.dataset.filter;
      renderOrdersList(sellerOrders);
    });
  }

  let ordersSearchDebounce;
  if (els.ordersSearchInput) {
    els.ordersSearchInput.addEventListener("input", () => {
      clearTimeout(ordersSearchDebounce);
      ordersSearchDebounce = setTimeout(() => {
        ordersSearchTerm = els.ordersSearchInput.value.trim().toLowerCase();
        renderOrdersList(sellerOrders);
      }, 200);
    });
  }

  // ---------- single order detail "page" (opened by tapping a card) ----------
  function openOrderDetail(order) {
    if (!els.orderDetailOverlay || !els.orderDetailBody) return;
    els.orderDetailBody.innerHTML = orderCardHtml(order);

    els.orderDetailBody.querySelectorAll("[data-order-status-btn]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await advanceOrderStatus(btn.dataset.orderStatusBtn, btn.dataset.nextStatus);
        closeOrderDetail();
      });
    });

    els.orderDetailOverlay.classList.add("active");
  }

  function closeOrderDetail() {
    if (els.orderDetailOverlay) els.orderDetailOverlay.classList.remove("active");
  }

  if (els.orderDetailBack) {
    els.orderDetailBack.addEventListener("click", closeOrderDetail);
  }

  async function advanceOrderStatus(orderId, nextStatus) {
    try {
      await SS_API.updateOrderStatus(orderId, nextStatus);
      ssToast(`Order marked as ${ORDER_STATUS_LABEL[nextStatus]}`, "fa-circle-check");
      loadSellerOrders();
    } catch (err) {
      ssToast(err.message || "Couldn't update order status", "fa-triangle-exclamation");
    }
  }

  // =========================================================
  // ---------- ANALYTICS "page" (opened by the header icon) ----------
  // =========================================================
  function openAnalytics() {
    if (!els.analyticsOverlay) return;
    els.analyticsOverlay.classList.add("active");
    document.body.style.overflow = "hidden";
    loadAnalytics();
  }

  function closeAnalytics() {
    if (els.analyticsOverlay) els.analyticsOverlay.classList.remove("active");
    if (
      !els.ordersListOverlay?.classList.contains("active") &&
      !els.orderDetailOverlay?.classList.contains("active") &&
      !els.myShopOverlay?.classList.contains("active")
    ) {
      document.body.style.overflow = "";
    }
  }

  if (els.analyticsToggleBtn) els.analyticsToggleBtn.addEventListener("click", openAnalytics);
  if (els.analyticsBack) els.analyticsBack.addEventListener("click", closeAnalytics);

  async function loadAnalytics() {
    if (els.analyticsLoading) els.analyticsLoading.style.display = "block";
    if (els.analyticsContent) els.analyticsContent.style.display = "none";
    if (els.analyticsEmpty) els.analyticsEmpty.style.display = "none";

    try {
      const res = await SS_API.getMyProductAnalytics();
      renderAnalytics(res);
    } catch (err) {
      console.error("ANALYTICS LOAD FAILED:", err);
      if (els.analyticsLoading) els.analyticsLoading.style.display = "none";
      if (els.analyticsEmpty) {
        els.analyticsEmpty.style.display = "block";
        els.analyticsEmpty.innerHTML = `
          <i class="fa-solid fa-triangle-exclamation"></i>
          <h3>Couldn't load analytics</h3>
          <p>${escapeHtml(err.message || "Please try again shortly.")}</p>`;
      }
    }
  }

  function renderAnalytics(data) {
    if (els.analyticsLoading) els.analyticsLoading.style.display = "none";

    const products = data.products || [];

    if (!products.length) {
      if (els.analyticsEmpty) els.analyticsEmpty.style.display = "block";
      return;
    }

    if (els.analyticsContent) els.analyticsContent.style.display = "block";

    if (els.statTotalViews) els.statTotalViews.textContent = (data.totalViews || 0).toLocaleString();
    if (els.statViews14) els.statViews14.textContent = (data.viewsLast14Days || 0).toLocaleString();

    const top = products[0]; // already sorted by viewCount desc from the backend
    if (els.statTopProductViews) els.statTopProductViews.textContent = (top?.viewCount || 0).toLocaleString();
    if (els.statTopProductLabel) {
      els.statTopProductLabel.textContent = top && top.viewCount > 0 ? `Top: ${top.name}` : "Top product";
    }

    // ---- 14-day trend bar chart ----
    if (els.analyticsTrend) {
      const trend = data.dailyTrend || [];
      const maxCount = Math.max(1, ...trend.map((d) => d.count));
      els.analyticsTrend.innerHTML = trend
        .map((d) => {
          const heightPct = Math.max(4, Math.round((d.count / maxCount) * 100));
          const label = new Date(d.date).toLocaleDateString("en-KE", { day: "numeric", month: "short" });
          return `<div class="analytics-trend-bar-wrap" title="${label}: ${d.count} view${d.count === 1 ? "" : "s"}">
            <div class="analytics-trend-bar" style="height:${heightPct}%"></div>
            <span class="analytics-trend-label">${new Date(d.date).getDate()}</span>
          </div>`;
        })
        .join("");
    }

    // ---- per-product breakdown ----
    if (els.analyticsProductList) {
      const maxViews = Math.max(1, ...products.map((p) => p.viewCount || 0));
      els.analyticsProductList.innerHTML = products
        .map((p) => {
          const pct = Math.max(2, Math.round(((p.viewCount || 0) / maxViews) * 100));
          const cover = p.image || "https://placehold.co/60x60/E4D6BD/5B564C?text=%20";
          return `<div class="analytics-product-row">
            <img src="${cover}" alt="" />
            <div class="analytics-product-info">
              <div class="analytics-product-name">${escapeHtml(p.name)}</div>
              <div class="analytics-product-bar-track"><div class="analytics-product-bar-fill" style="width:${pct}%"></div></div>
            </div>
            <div class="analytics-product-views">${(p.viewCount || 0).toLocaleString()}</div>
          </div>`;
        })
        .join("");
    }
  }

  // =========================================================
  // ---------- MY SHOP "page" (opened by the header icon) ----------
  // =========================================================
  function openMyShop() {
    if (!els.myShopOverlay) return;
    els.myShopOverlay.classList.add("active");
    document.body.style.overflow = "hidden";
    loadMyShop();
  }

  function closeMyShop() {
    if (els.myShopOverlay) els.myShopOverlay.classList.remove("active");
    if (
      !els.ordersListOverlay?.classList.contains("active") &&
      !els.orderDetailOverlay?.classList.contains("active") &&
      !els.analyticsOverlay?.classList.contains("active")
    ) {
      document.body.style.overflow = "";
    }
  }

  if (els.myShopToggleBtn) els.myShopToggleBtn.addEventListener("click", openMyShop);
  if (els.myShopBack) els.myShopBack.addEventListener("click", closeMyShop);

  async function loadMyShop() {
    if (els.myShopLoading) els.myShopLoading.style.display = "block";
    if (els.myShopEmpty) els.myShopEmpty.style.display = "none";
    if (els.myShopContent) els.myShopContent.style.display = "none";
    if (els.myShopErrorState) els.myShopErrorState.style.display = "none";

    try {
      const res = await SS_API.getMyShop();
      myShop = res.shop || null;
      renderMyShop();
    } catch (err) {
      console.error("MY SHOP LOAD FAILED:", err);
      if (els.myShopLoading) els.myShopLoading.style.display = "none";
      if (els.myShopErrorState) {
        els.myShopErrorState.style.display = "block";
        if (els.myShopErrorMsg) els.myShopErrorMsg.textContent = err.message || "Please try again shortly.";
      }
    }
  }

  function renderMyShop() {
    if (els.myShopLoading) els.myShopLoading.style.display = "none";

    if (!myShop) {
      if (els.myShopEmpty) els.myShopEmpty.style.display = "block";
      if (els.myShopContent) els.myShopContent.style.display = "none";
      return;
    }

    if (els.myShopEmpty) els.myShopEmpty.style.display = "none";
    if (els.myShopContent) els.myShopContent.style.display = "block";

    const overviewTab = document.getElementById("shopOverviewTab");
    if (overviewTab) overviewTab.innerHTML = renderShopStorefront(myShop);

    const shareBtn = document.getElementById("shareShopBtn");
    if (shareBtn) shareBtn.onclick = shareShop;

    const qrBtn = document.getElementById("qrShopBtn");
    if (qrBtn) qrBtn.onclick = generateShopQRCode;

    // Refresh whichever secondary tab is currently open so it doesn't go stale
    const activeTabBtn = document.querySelector(".shop-tab.active");
    const activeTab = activeTabBtn?.dataset.tab;
    if (activeTab === "products") loadShopProducts();
    else if (activeTab === "analytics") loadShopAnalytics();
    else if (activeTab === "settings") renderShopSettings();
  }

  // ---------- Shop tab switching ----------
  window.switchShopTab = function (tab) {
    document.querySelectorAll(".shop-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });
    document.querySelectorAll(".shop-tab-content").forEach((panel) => {
      panel.classList.toggle("active", panel.id === `shop${tab.charAt(0).toUpperCase() + tab.slice(1)}Tab`);
    });

    if (tab === "products") loadShopProducts();
    else if (tab === "analytics") loadShopAnalytics();
    else if (tab === "settings") renderShopSettings();
  };

  // ---------- Render Shop Storefront (Overview tab) ----------
  function renderShopStorefront(shop) {
    if (!shop) return "";

    const shopProducts = allProducts.filter((p) => p.shop?._id === shop._id);
    const isActive = shop.isActive !== false;

    const rejection =
      shop.status === "rejected" && shop.rejectionReason
        ? `<div class="shop-rejection-box"><i class="fa-solid fa-circle-info"></i> ${escapeHtml(shop.rejectionReason)}</div>`
        : "";
    const pendingNote =
      shop.status === "pending_approval"
        ? `<div class="shop-pending-note"><i class="fa-solid fa-hourglass-half"></i> Your shop is waiting on admin approval. You can still edit it while you wait.</div>`
        : "";
    const suspendedNote =
      shop.status === "suspended"
        ? `<div class="shop-paused-note"><i class="fa-solid fa-ban"></i> This shop has been suspended by an admin.</div>`
        : "";
    const pausedNote =
      shop.status === "approved" && !isActive
        ? `<div class="shop-paused-note"><i class="fa-solid fa-circle-pause"></i> Your shop is paused and hidden from buyers. Reactivate it any time.</div>`
        : "";

    return `
      <div class="shop-storefront-preview">
        <div class="shop-banner-preview" style="background-image:url('${shop.banner || ""}')">
          <div class="shop-header-content">
            <div class="shop-logo-container">
              ${shop.logo ? `<img src="${shop.logo}" alt="${escapeHtml(shop.shopName)}">` : `<div class="shop-logo-placeholder"><i class="fa-solid fa-store"></i></div>`}
            </div>
            <div class="shop-header-info">
              <div class="shop-name-display">${escapeHtml(shop.shopName)}</div>
              <div class="shop-badges">
                <span class="shop-status-badge ${shop.status}">${SHOP_STATUS_LABEL[shop.status] || shop.status}</span>
                ${shop.verificationStatus === "verified" ? `<span class="shop-mini-badge verified"><i class="fa-solid fa-circle-check"></i> Verified</span>` : ""}
                ${shop.isFeatured ? `<span class="shop-mini-badge featured"><i class="fa-solid fa-star"></i> Featured</span>` : ""}
                ${!isActive ? `<span class="shop-mini-badge paused"><i class="fa-solid fa-circle-pause"></i> Paused</span>` : shop.status === "approved" ? `<span class="shop-mini-badge live"><i class="fa-solid fa-circle"></i> Live</span>` : ""}
              </div>
            </div>
          </div>
        </div>

        ${rejection}${pendingNote}${suspendedNote}${pausedNote}

        <div class="shop-details-grid">
          <div class="shop-detail-item">
            <i class="fa-solid fa-tag"></i>
            <div><div class="detail-label">Category</div><div class="detail-value">${escapeHtml(shop.businessCategory || "Not set")}</div></div>
          </div>
          <div class="shop-detail-item">
            <i class="fa-solid fa-clock"></i>
            <div><div class="detail-label">Business hours</div><div class="detail-value">${escapeHtml(shop.businessHours || "Not set")}</div></div>
          </div>
          <div class="shop-detail-item">
            <i class="fa-solid fa-file-lines"></i>
            <div><div class="detail-label">Description</div><div class="detail-value">${escapeHtml(shop.description || "No description yet")}</div></div>
          </div>
          <div class="shop-detail-item">
            <i class="fa-solid fa-cube"></i>
            <div><div class="detail-label">Products</div><div class="detail-value">${shopProducts.length} product${shopProducts.length === 1 ? "" : "s"}</div></div>
          </div>
        </div>

        <div class="shop-actions">
          <button class="btn btn-primary btn-sm" onclick="openShopForm()"><i class="fa-solid fa-pen"></i> Edit shop</button>
          ${
            shop.status === "approved"
              ? `<button class="btn ${isActive ? "btn-outline" : "btn-primary"} btn-sm" onclick="toggleShopActive()">
                   <i class="fa-solid ${isActive ? "fa-pause" : "fa-play"}"></i> ${isActive ? "Pause shop" : "Activate shop"}
                 </button>`
              : ""
          }
          ${shop.slug ? `<button class="btn btn-outline btn-sm" onclick="viewShopStorefront('${shop.slug}')"><i class="fa-solid fa-eye"></i> View storefront</button>` : ""}
        </div>
      </div>`;
  }

  window.toggleShopActive = async function () {
    if (!myShop) return;
    const isActive = myShop.isActive !== false;
    const confirmMsg = isActive
      ? "Pausing your shop hides it from buyers. Your products stay saved and reappear the moment you reactivate. Continue?"
      : "Activating your shop makes it visible to buyers again. Continue?";
    if (!confirm(confirmMsg)) return;

    try {
      const result = await SS_API.toggleShopActive();
      myShop.isActive = result.shop.isActive;
      renderMyShop();
      ssToast(`Shop ${result.shop.isActive ? "activated" : "paused"}`, "fa-circle-check");
    } catch (err) {
      ssToast(err.message || "Couldn't update shop status", "fa-triangle-exclamation");
    }
  };

  window.viewShopStorefront = function (slug) {
    window.open(`/shop/${slug}`, "_blank");
  };

  // ---------- Products tab ----------
  async function loadShopProducts() {
    const container = document.getElementById("shopProductsContainer");
    if (!container || !myShop) return;

    const shopProducts = allProducts.filter((p) => p.shop?._id === myShop._id);

    if (!shopProducts.length) {
      container.innerHTML = `
        <div class="empty-state" style="padding:40px 20px;">
          <i class="fa-solid fa-box-open"></i>
          <h3>No products in this shop yet</h3>
          <p>Products you add while your shop is approved show up here automatically.</p>
          <button class="btn btn-primary" onclick="document.getElementById('openAddProduct').click()">
            <i class="fa-solid fa-plus"></i> Add product
          </button>
        </div>`;
      return;
    }

    container.innerHTML = shopProducts
      .map(
        (p) => `
      <div class="shop-product-card">
        <img src="${p.images?.[0] || "https://placehold.co/80x80/E4D6BD/5B564C?text=%20"}" alt="${escapeHtml(p.name)}">
        <div class="shop-product-info">
          <div class="shop-product-name">${escapeHtml(p.name)}</div>
          <div class="shop-product-price">KES ${(p.sellerPrice || 0).toLocaleString()}</div>
          <div class="shop-product-stock">${p.stock || 0} in stock</div>
        </div>
        <div class="shop-product-actions">
          <button class="btn btn-sm btn-outline" onclick="editProduct('${p._id}')"><i class="fa-solid fa-pen"></i></button>
          <span class="status-badge ${p.status}">${STATUS_LABEL[p.status] || p.status}</span>
        </div>
      </div>`
      )
      .join("");
  }

  // ---------- Analytics tab ----------
  async function loadShopAnalytics() {
    const container = document.getElementById("shopAnalyticsContainer");
    if (!container || !myShop) return;

    const shopProducts = allProducts.filter((p) => p.shop?._id === myShop._id);
    const totalViews = shopProducts.reduce((s, p) => s + (p.viewCount || 0), 0);
    const totalStock = shopProducts.reduce((s, p) => s + (p.stock || 0), 0);
    const totalProducts = shopProducts.length;
    const avgPrice = totalProducts ? shopProducts.reduce((s, p) => s + (p.sellerPrice || 0), 0) / totalProducts : 0;

    container.innerHTML = `
      <div class="shop-analytics-grid">
        <div class="stat-card"><div class="stat-icon"><i class="fa-solid fa-eye"></i></div>
          <div class="stat-info"><div class="stat-label">Total views</div><div class="stat-value">${totalViews.toLocaleString()}</div></div></div>
        <div class="stat-card"><div class="stat-icon"><i class="fa-solid fa-cube"></i></div>
          <div class="stat-info"><div class="stat-label">Products</div><div class="stat-value">${totalProducts}</div></div></div>
        <div class="stat-card"><div class="stat-icon"><i class="fa-solid fa-boxes"></i></div>
          <div class="stat-info"><div class="stat-label">Total stock</div><div class="stat-value">${totalStock.toLocaleString()}</div></div></div>
        <div class="stat-card"><div class="stat-icon"><i class="fa-solid fa-tag"></i></div>
          <div class="stat-info"><div class="stat-label">Avg. price</div><div class="stat-value">KES ${avgPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div></div></div>
      </div>`;
  }

  // ---------- Settings tab ----------
  function renderShopSettings() {
    const settingsTab = document.getElementById("shopSettingsTab");
    if (!settingsTab || !myShop) return;

    const layouts = { default: "Default", "banner-focus": "Banner focus", "grid-focus": "Grid focus" };
    const layoutIcon = { default: "fa-grip", "banner-focus": "fa-image", "grid-focus": "fa-table-cells-large" };

    settingsTab.innerHTML = `
      <div class="shop-settings-section">
        <h3 style="margin-bottom:14px;">Storefront layout</h3>
        <div style="display:flex; gap:12px; margin-bottom:24px; flex-wrap:wrap;">
          ${Object.keys(layouts)
            .map(
              (key) => `
            <div class="layout-select-card ${myShop.homepageLayout === key ? "active" : ""}"
                 style="flex:1; min-width:140px; text-align:center;" onclick="updateShopLayout('${key}')">
              <div><i class="fa-solid ${layoutIcon[key]}" style="font-size:20px; margin-bottom:6px; display:block;"></i>
              <span class="layout-select-card__title">${layouts[key]}</span></div>
            </div>`
            )
            .join("")}
        </div>

        <h3 style="margin-bottom:14px;">Theme colours</h3>
        <div class="theme-color-row" style="margin-bottom:20px;">
          <div class="theme-color-field">
            <label>Primary</label>
            <input type="color" id="themePrimaryColor" value="${myShop.themeConfiguration?.primaryColor || "#f2a93b"}" onchange="updateTheme('primaryColor', this.value)" />
          </div>
          <div class="theme-color-field">
            <label>Accent</label>
            <input type="color" id="themeAccentColor" value="${myShop.themeConfiguration?.accentColor || "#d98c1f"}" onchange="updateTheme('accentColor', this.value)" />
          </div>
        </div>

        <button class="btn btn-primary btn-sm" onclick="saveShopSettings()"><i class="fa-solid fa-floppy-disk"></i> Save settings</button>
      </div>`;
  }

  window.updateShopLayout = async function (layout) {
    try {
      await SS_API.updateMyShop({ homepageLayout: layout });
      myShop.homepageLayout = layout;
      renderShopSettings();
      ssToast("Layout updated", "fa-circle-check");
    } catch (err) {
      ssToast(err.message || "Couldn't update layout", "fa-triangle-exclamation");
    }
  };

  let pendingThemeUpdates = {};
  window.updateTheme = function (key, value) {
    pendingThemeUpdates[key] = value;
  };

  window.saveShopSettings = async function () {
    try {
      const themeConfiguration = { ...myShop.themeConfiguration, ...pendingThemeUpdates };
      await SS_API.updateMyShop({ themeConfiguration });
      myShop.themeConfiguration = themeConfiguration;
      pendingThemeUpdates = {};
      ssToast("Settings saved", "fa-circle-check");
    } catch (err) {
      ssToast(err.message || "Couldn't save settings", "fa-triangle-exclamation");
    }
  };

  // ---------- Share / QR ----------
  window.shareShop = function () {
    if (!myShop?.slug) return;
    const url = `${window.location.origin}/shop/${myShop.slug}`;
    if (navigator.share) {
      navigator.share({ title: myShop.shopName, text: `Check out ${myShop.shopName} on Six Star Suppliers!`, url }).catch(() => {});
    } else {
      navigator.clipboard
        .writeText(url)
        .then(() => ssToast("Shop link copied to clipboard!", "fa-copy"))
        .catch(() => ssToast("Couldn't copy link", "fa-triangle-exclamation"));
    }
  };
  function shareShop() { window.shareShop(); }

  window.generateShopQRCode = function () {
    if (!myShop?.slug) return;
    const url = `${window.location.origin}/shop/${myShop.slug}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
    document.getElementById("qrCodeImage").src = qrUrl;
    document.getElementById("qrShopName").textContent = myShop.shopName;
    document.getElementById("qrModal").style.display = "flex";
  };
  function generateShopQRCode() { window.generateShopQRCode(); }

  window.closeQRModal = function () {
    document.getElementById("qrModal").style.display = "none";
  };

  // ---------- Edit product (used from the Products tab) ----------
  window.editProduct = function (productId) {
    const product = allProducts.find((p) => (p._id || p.id) === productId);
    if (product) openProductModal(product);
  };

  // =========================================================
  // ---------- create / edit shop modal ----------
  // =========================================================
  function syncLayoutCardActive() {
    document.querySelectorAll("#homepageLayoutGroup .layout-select-card").forEach((card) => {
      card.classList.toggle("active", card.querySelector("input")?.checked);
    });
  }
  document.querySelectorAll('#homepageLayoutGroup input[name="homepageLayout"]').forEach((radio) => {
    radio.addEventListener("change", syncLayoutCardActive);
  });

  function openShopForm() {
    if (els.shopFormError) els.shopFormError.classList.remove("show");
    if (els.shopForm) els.shopForm.reset();

    const isEdit = !!myShop;

    if (els.shopFormTitle) els.shopFormTitle.textContent = isEdit ? "Edit your shop" : "Create your shop";
    if (els.shopFormSubtitle) {
      els.shopFormSubtitle.textContent = isEdit
        ? "Changing anything on an already-approved shop sends it back to admin for re-approval."
        : "Sellers who don't create a shop keep selling exactly as they do today.";
    }
    if (els.saveShopBtn) els.saveShopBtn.textContent = isEdit ? "Save changes" : "Create shop";

    if (isEdit) {
      if (els.shopNameInput) els.shopNameInput.value = myShop.shopName || "";
      if (els.shopCategoryInput) els.shopCategoryInput.value = myShop.businessCategory || "";
      if (els.shopDescInput) els.shopDescInput.value = myShop.description || "";
      if (els.shopLogoInput) els.shopLogoInput.value = myShop.logo || "";
      if (els.shopBannerInput) els.shopBannerInput.value = myShop.banner || "";
      if (els.shopHoursInput) els.shopHoursInput.value = myShop.businessHours || "";

      const layout = myShop.homepageLayout || "default";
      document.querySelectorAll('input[name="homepageLayout"]').forEach((r) => (r.checked = r.value === layout));

      const primary = document.getElementById("shopPrimaryColorInput");
      const accent = document.getElementById("shopAccentColorInput");
      if (primary) primary.value = myShop.themeConfiguration?.primaryColor || "#f2a93b";
      if (accent) accent.value = myShop.themeConfiguration?.accentColor || "#d98c1f";
    }

    syncLayoutCardActive();
    if (els.shopFormModal) els.shopFormModal.classList.add("active");
  }
  window.openShopForm = openShopForm;

  function closeShopForm() {
    if (els.shopFormModal) els.shopFormModal.classList.remove("active");
  }

  if (els.createShopBtn) els.createShopBtn.addEventListener("click", openShopForm);
  if (els.closeShopFormModal) els.closeShopFormModal.addEventListener("click", closeShopForm);
  if (els.cancelShopForm) els.cancelShopForm.addEventListener("click", closeShopForm);
  if (els.shopFormModal) {
    els.shopFormModal.addEventListener("click", (e) => {
      if (e.target === els.shopFormModal) closeShopForm();
    });
  }

  function showShopFormError(msg) {
    if (els.shopFormError) {
      els.shopFormError.textContent = msg;
      els.shopFormError.classList.add("show");
    }
  }

  if (els.shopForm) {
    els.shopForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (els.shopFormError) els.shopFormError.classList.remove("show");

      const shopName = els.shopNameInput?.value.trim();
      if (!shopName) {
        showShopFormError("Please enter a shop name.");
        return;
      }

      const homepageLayout = document.querySelector('input[name="homepageLayout"]:checked')?.value || "default";
      const primaryColor = document.getElementById("shopPrimaryColorInput")?.value || "#f2a93b";
      const accentColor = document.getElementById("shopAccentColorInput")?.value || "#d98c1f";

      const payload = {
        shopName,
        businessCategory: els.shopCategoryInput?.value.trim() || "",
        description: els.shopDescInput?.value.trim() || "",
        logo: els.shopLogoInput?.value.trim() || "",
        banner: els.shopBannerInput?.value.trim() || "",
        businessHours: els.shopHoursInput?.value.trim() || "",
        homepageLayout,
        themeConfiguration: { primaryColor, accentColor },
      };

      const isEdit = !!myShop;

      if (els.saveShopBtn) {
        els.saveShopBtn.disabled = true;
        els.saveShopBtn.textContent = "Saving…";
      }

      try {
        if (isEdit) {
          await SS_API.updateMyShop(payload);
          ssToast("Shop updated — sent to admin for re-approval", "fa-circle-check");
        } else {
          await SS_API.createShop(payload);
          ssToast("Shop submitted for admin approval", "fa-circle-check");
        }
        closeShopForm();
        loadMyShop();
      } catch (err) {
        showShopFormError(err.message || "Couldn't save your shop. Please try again.");
      } finally {
        if (els.saveShopBtn) {
          els.saveShopBtn.disabled = false;
          els.saveShopBtn.textContent = isEdit ? "Save changes" : "Create shop";
        }
      }
    });
  }

  // ---------- counts + tabs (products) ----------
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

  // ---------- render products ----------
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
      actionHtml = `<button class="btn btn-outline btn-sm" data-edit-id="${id}"><i class="fa-solid fa-pen"></i> Edit Live Product</button>`;
    } else {
      actionHtml = `<button class="btn btn-outline btn-sm" disabled><i class="fa-solid fa-ban"></i> Suspended by admin</button>`;
    }

    const wholesaleMeta =
      p.sellerRole === "wholesaler"
        ? `<div class="sp-card__wholesale">
            ${p.minOrderQuantity ? `<small>MOQ: ${p.minOrderQuantity}</small>` : ""}
            <small>${p.deliveryType === "simple" ? "Simple transport" : "Heavy transport"}</small>
            ${p.deliveryType === "heavy" && p.freeDelivery ? '<span class="wholesale-badge"><i class="fa-solid fa-truck"></i> Free delivery</span>' : ""}
            ${p.pricingTiers && p.pricingTiers.length ? `<small>${p.pricingTiers.length} price tier${p.pricingTiers.length > 1 ? "s" : ""}</small>` : ""}
          </div>`
        : "";

    const shopMeta = p.shop?.shopName
      ? `<div class="sp-card__meta"><small><i class="fa-solid fa-shop"></i> ${escapeHtml(p.shop.shopName)}</small></div>`
      : "";

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
          <div class="sp-card__meta">
            <small><i class="fa-solid fa-eye"></i> ${(p.viewCount || 0).toLocaleString()} views</small>
          </div>
          ${shopMeta}
          ${wholesaleMeta}
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
  async function openProductModal(product) {
    editingProduct = product || null;
    currentStepIdx = 0;
    selectedFiles = [];
    selectedCategoryId = "";
    variantRows = [];
    pricingTierRows = [];

    if (els.productForm) els.productForm.reset();
    if (els.productFormError) els.productFormError.classList.remove("show");

    resetCategoryLevel(els.pCategoryLevel1, "Select a category above first");
    resetCategoryLevel(els.pCategoryLevel2, "—");
    if (els.pParentCategory) els.pParentCategory.value = "";
    clearCategoryDrivenUI();
    resetWholesaleForm();

    if (els.productModalTitle) {
      els.productModalTitle.textContent = editingProduct
        ? editingProduct.status === "active"
          ? "Edit Live Product"
          : "Edit Product"
        : "Add New Product";
    }
    if (els.saveProductBtn) {
      els.saveProductBtn.textContent = editingProduct ? "Save changes" : "Save as draft";
    }
    if (els.liveEditNotice) {
      els.liveEditNotice.style.display = editingProduct?.status === "active" ? "flex" : "none";
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

      prefillWholesaleForm(editingProduct);

      if (els.currentImagesRow) {
        const imgs = editingProduct.images || [];
        els.currentImagesRow.innerHTML = imgs.map((src) => `<div class="thumb"><img src="${src}" alt=""></div>`).join("");
      }
      if (els.currentImagesHint) els.currentImagesHint.style.display = "block";

      const catId = editingProduct.category?._id || editingProduct.category?.id || editingProduct.category;
      if (catId) await restoreCategoryPath(catId, editingProduct);
    } else {
      if (els.currentImagesRow) els.currentImagesRow.innerHTML = "";
      if (els.currentImagesHint) els.currentImagesHint.style.display = "none";
    }

    renderThumbs();
    renderWizard();
    if (els.productModal) els.productModal.classList.add("active");
  }

  // Walks a leaf category id back up to its ancestors (using the already-loaded
  // tree) so the three cascading selects land on the right path when editing.
  async function restoreCategoryPath(leafId, product) {
    const chain = [];
    let node = categoryNodeMap[leafId];
    while (node) {
      chain.unshift(node);
      const parentId = node.parentCategory?._id || node.parentCategory;
      node = parentId ? categoryNodeMap[parentId] : null;
    }

    if (!chain.length) {
      // Tree hasn't loaded yet, or this category isn't in it — just select the leaf directly.
      selectedCategoryId = leafId;
      await loadAttributesForCategory(leafId);
      restoreAttributeAndVariantValues(product);
      return;
    }

    const selectsInOrder = [els.pParentCategory, els.pCategoryLevel1, els.pCategoryLevel2];
    let siblings = categoryTree;

    for (let i = 0; i < chain.length; i++) {
      const levelSelect = selectsInOrder[i];
      if (!levelSelect) break;
      populateCategorySelect(levelSelect, siblings, "Select a category");
      levelSelect.disabled = false;
      levelSelect.value = chain[i]._id || chain[i].id;
      siblings = chain[i].children || [];
    }

    selectedCategoryId = leafId;
    await loadAttributesForCategory(leafId);
    restoreAttributeAndVariantValues(product);
  }

  function restoreAttributeAndVariantValues(product) {
    // product-level attributes
    const prefillMap = {};
    (product.attributes || []).forEach((a) => {
      const attrId = a.attribute?._id || a.attribute;
      if (attrId) prefillMap[attrId] = a.value;
    });
    renderAttributeFields(currentSimpleDefs, prefillMap);

    // variants
    if (currentVariantDefs.length) {
      const existingVariants = product.variants || [];
      if (existingVariants.length) {
        variantRows = existingVariants.map((v) => {
          const values = {};
          (v.combination || []).forEach((c) => {
            const attrId = c.attribute?._id || c.attribute;
            if (attrId) values[attrId] = c.value;
          });
          return {
            localId: ++variantRowSeq,
            values,
            stock: v.stock,
            priceAdjustment: v.priceAdjustment || "",
            sku: v.sku || "",
          };
        });
      } else {
        variantRows = [];
      }
      renderVariantSection(currentVariantDefs);
    }
    renderWizard();
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

      // If we're not on the last wizard step yet, treat submit (Enter key, etc.)
      // as "advance to the next step" instead of saving.
      const steps = getActiveSteps();
      if (currentStepIdx !== steps.length - 1) {
        handleWizardNext();
        return;
      }

      const name = document.getElementById("pName")?.value.trim();
      const stock = document.getElementById("pStock")?.value;
      const sellerPrice = document.getElementById("pPrice")?.value;
      const description = document.getElementById("pDesc")?.value.trim();
      const discountPercent = els.pDiscount?.value || 0;

      if (!selectedCategoryId) {
        showFormError("Please choose the most specific category (down to the last level available).");
        return;
      }

      const attrError = validateRequiredAttributes();
      if (attrError) {
        showFormError(attrError);
        return;
      }

      const variantError = validateVariantsBeforeSubmit();
      if (variantError) {
        showFormError(variantError);
        return;
      }

      if (!editingProduct && !selectedFiles.length) {
        showFormError("Add at least one product photo.");
        return;
      }

      const fd = new FormData();
      fd.append("name", name);
      fd.append("category", selectedCategoryId);
      if (!currentVariantDefs.length) fd.append("stock", stock);
      fd.append("sellerPrice", sellerPrice);
      fd.append("discountPercent", discountPercent);
      fd.append("description", description);
      fd.append("attributes", JSON.stringify(collectAttributesFromUI()));
      fd.append("variants", JSON.stringify(collectVariantsFromUI()));

      if (IS_WHOLESALER) {
        fd.append("deliveryType", currentDeliveryType);
        fd.append("minOrderQuantity", els.pMOQ?.value || 1);
        fd.append("pricingTiers", JSON.stringify(collectPricingTiers()));
        // Free delivery / delivery charge only matter for 'heavy' products — still
        // sent either way, the backend simply ignores them when deliveryType is 'simple'.
        fd.append("freeDelivery", els.pFreeDelivery?.checked ? "true" : "false");
        fd.append("deliveryCharge", JSON.stringify(collectDeliveryCharge()));
      }

      selectedFiles.forEach((file) => fd.append("images", file));

      if (els.saveProductBtn) {
        els.saveProductBtn.disabled = true;
        els.saveProductBtn.textContent = "Saving…";
      }

      const wasLiveEdit = editingProduct?.status === "active";

      if (wasLiveEdit && !confirm(
        "This product is currently live. Saving will remove it from the storefront until admin reviews and re-approves your changes. Continue?"
      )) {
        return;
      }

      if (els.saveProductBtn) {
        els.saveProductBtn.disabled = true;
        els.saveProductBtn.textContent = "Saving…";
      }

      try {
        if (editingProduct) {
          await SS_API.updateProduct(editingProduct._id || editingProduct.id, fd);
          ssToast(
            wasLiveEdit
              ? "Saved — sent back to admin for re-approval and removed from the storefront for now"
              : "Product updated",
            "fa-circle-check"
          );
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