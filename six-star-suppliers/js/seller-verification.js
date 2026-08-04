/* ============================================================
   SIX STAR SUPPLIERS — seller verification wizard
   Flow: email OTP gate -> multi-step wizard -> review & submit.
   Retailers choose Basic (ID + KRA only) or Business tier.
   Wholesalers are always forced onto the Business tier.
   ============================================================ */

(async () => {
  const user = await SS_AUTH.requireRole(["wholesaler", "retailer"]);
  if (!user) return;

  const IS_WHOLESALER = user.role === "wholesaler";

  const DEFAULT_CATEGORY_OPTIONS = [
    { value: "phones", label: "Phones" },
    { value: "electronics", label: "Electronics" },
    { value: "fashion", label: "Fashion" },
    { value: "beauty", label: "Beauty" },
    { value: "groceries", label: "Groceries" },
    { value: "home_living", label: "Home & Living" },
    { value: "industrial", label: "Industrial" },
    { value: "automotive", label: "Automotive" },
    { value: "agriculture", label: "Agriculture" },
  ];

  const els = {
    statusScreen: document.getElementById("statusScreen"),
    otpGate: document.getElementById("otpGate"),
    otpGateEmail: document.getElementById("otpGateEmail"),
    otpForm: document.getElementById("otpForm"),
    otpInputRow: document.getElementById("otpInputRow"),
    otpError: document.getElementById("otpError"),
    otpSubmitBtn: document.getElementById("otpSubmitBtn"),
    otpResendBtn: document.getElementById("otpResendBtn"),
    otpCooldown: document.getElementById("otpCooldown"),
    wizardWrap: document.getElementById("wizardWrap"),
    wizardSteps: document.getElementById("wizardSteps"),
    formError: document.getElementById("formError"),
    verifyForm: document.getElementById("verifyForm"),
    wizardBackBtn: document.getElementById("wizardBackBtn"),
    wizardNextBtn: document.getElementById("wizardNextBtn"),
    submitVerifyBtn: document.getElementById("submitVerifyBtn"),
    logoutBtn: document.getElementById("logoutBtn"),
    reviewSummary: document.getElementById("reviewSummary"),
    rejectedBanner: document.getElementById("rejectedBanner"),
    legalDocsList: document.getElementById("legalDocsList"),
    categoryGrid: document.getElementById("categoryGrid"),
    storeDescription: document.getElementById("storeDescription"),
    storeDescCount: document.getElementById("storeDescCount"),
  };

  function hideLoader() {
    const loader = document.getElementById("pageLoader");
    if (loader) { loader.classList.add("hide"); loader.style.display = "none"; }
  }

  if (els.logoutBtn) {
    els.logoutBtn.onclick = async () => {
      await SS_API.logout();
      SS_AUTH.clear();
      location.href = "login.html";
    };
  }

  let tier = IS_WHOLESALER ? "business" : "basic";
  const files = {}; // fieldName -> File
  const selectedCategories = new Set();

  let legalDocs = [];
  let legalAcceptedLocal = new Set();

  const STEP_META = {
    tier: { label: "Path", icon: "fa-route" },
    identity: { label: "Identity", icon: "fa-id-badge" },
    business: { label: "Business", icon: "fa-building" },
    tax: { label: "Tax", icon: "fa-receipt" },
    address: { label: "Address", icon: "fa-location-dot" },
    warehouse: { label: "Warehouse", icon: "fa-warehouse" },
    returns: { label: "Returns", icon: "fa-rotate-left" },
    store: { label: "Store", icon: "fa-store" },
    categories: { label: "Categories", icon: "fa-tags" },
    social: { label: "Social", icon: "fa-share-nodes" },
    payout: { label: "Payout", icon: "fa-money-bill-transfer" },
    review: { label: "Review", icon: "fa-clipboard-check" },
  };

  function getActiveSteps() {
    const steps = [];
    if (!IS_WHOLESALER) steps.push("tier");
    steps.push("identity");
    if (tier === "business") steps.push("business");
    steps.push("tax", "address", "warehouse", "returns", "store", "categories", "social", "payout", "review");
    return steps;
  }

  let currentStepIdx = 0;

  // ---------- 1. load status + email-verification state ----------
  let emailVerified = false;
  let categoryOptions = DEFAULT_CATEGORY_OPTIONS;

  try {
    const res = await SS_API.getMyVerification();
    const verification = res.verification;
    emailVerified = !!res.emailVerified;
    if (Array.isArray(res.categoryOptions) && res.categoryOptions.length) {
      categoryOptions = res.categoryOptions.map((v) =>
        typeof v === "string" ? { value: v, label: humanizeCategory(v) } : v
      );
    }

    if (verification && verification.status === "pending") {
      showStatusScreen("pending");
      hideLoader();
      return;
    }
    if (verification && verification.status === "approved") {
      location.href = "seller-dashboard.html";
      return;
    }

    if (!emailVerified) {
      startOtpGate(user.email);
      hideLoader();
      return;
    }

    if (verification && verification.status === "rejected") {
      showRejectedBanner(verification);
    }
  } catch (err) {
    console.error("Couldn't load verification status:", err);
  }

  els.wizardWrap.style.display = "block";
  renderCategoryGrid();
  await loadLegalDocs();
  renderWizard();
  hideLoader();

  function humanizeCategory(v) {
    return String(v).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // ---------- status screens ----------
  function showStatusScreen(kind) {
    els.wizardWrap.style.display = "none";
    els.statusScreen.style.display = "block";
    els.statusScreen.className = `status-screen ${kind}`;

    if (kind === "pending") {
      els.statusScreen.innerHTML = `
        <i class="fa-solid fa-hourglass-half"></i>
        <h2>Your verification is under review</h2>
        <p>Our team is checking your documents. This usually takes 1–2 business days. You'll be able to access your seller dashboard as soon as you're approved.</p>
        <button class="btn btn-outline" id="statusLogout"><i class="fa-solid fa-arrow-right-from-bracket"></i> Log out</button>`;
      document.getElementById("statusLogout").onclick = async () => {
        await SS_API.logout();
        SS_AUTH.clear();
        location.href = "login.html";
      };
    }
  }

  function showRejectedBanner(verification) {
    els.rejectedBanner.innerHTML = `
      <div class="status-reject-box">
        <i class="fa-solid fa-circle-info"></i>
        Your last submission was rejected: ${escapeHtml(verification.rejectionReason || "Please review and resubmit.")}
      </div>`;

    if (!IS_WHOLESALER && verification.tier) tier = verification.tier;
    prefillFromRecord(verification);
  }

  // ============================================================
  // EMAIL OTP GATE
  // ============================================================
  let resendCooldownTimer = null;

  function startOtpGate(email) {
    els.otpGate.style.display = "block";
    els.otpGateEmail.textContent = email || "your email";
    sendOtp(true);

    const digitInputs = Array.from(els.otpInputRow.querySelectorAll("[data-otp-digit]"));
    digitInputs.forEach((input, idx) => {
      input.addEventListener("input", () => {
        input.value = input.value.replace(/\D/g, "").slice(0, 1);
        if (input.value && digitInputs[idx + 1]) digitInputs[idx + 1].focus();
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Backspace" && !input.value && digitInputs[idx - 1]) digitInputs[idx - 1].focus();
      });
      input.addEventListener("paste", (e) => {
        const text = (e.clipboardData || window.clipboardData).getData("text").replace(/\D/g, "");
        if (!text) return;
        e.preventDefault();
        text.split("").slice(0, digitInputs.length).forEach((ch, i) => {
          if (digitInputs[i]) digitInputs[i].value = ch;
        });
        const next = digitInputs[Math.min(text.length, digitInputs.length - 1)];
        if (next) next.focus();
      });
    });

    els.otpForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const code = digitInputs.map((i) => i.value).join("");
      if (code.length < 6) {
        showOtpError("Enter all 6 digits.");
        return;
      }
      clearOtpError();
      els.otpSubmitBtn.disabled = true;
      els.otpSubmitBtn.textContent = "Verifying…";
      try {
        await SS_API.verifyEmailOtp(code);
        ssToast("Email verified!", "fa-circle-check");
        location.reload();
      } catch (err) {
        showOtpError(err.message || "Incorrect code. Please try again.");
        digitInputs.forEach((i) => (i.value = ""));
        digitInputs[0].focus();
        els.otpSubmitBtn.disabled = false;
        els.otpSubmitBtn.textContent = "Verify email";
      }
    });

    els.otpResendBtn.addEventListener("click", () => sendOtp(false));
  }

  async function sendOtp(isInitial) {
    clearOtpError();
    try {
      const res = await SS_API.sendEmailOtp();
      if (res.alreadyVerified) {
        location.reload();
        return;
      }
      if (!isInitial) ssToast("Code resent — check your inbox", "fa-paper-plane");
      startResendCooldown(60);
    } catch (err) {
      showOtpError(err.message || "Couldn't send the code. Try again shortly.");
    }
  }

  function startResendCooldown(seconds) {
    let remaining = seconds;
    els.otpResendBtn.disabled = true;
    if (resendCooldownTimer) clearInterval(resendCooldownTimer);
    const tick = () => {
      els.otpCooldown.textContent = remaining > 0 ? `(${remaining}s)` : "";
      if (remaining <= 0) {
        clearInterval(resendCooldownTimer);
        els.otpResendBtn.disabled = false;
      }
      remaining--;
    };
    tick();
    resendCooldownTimer = setInterval(tick, 1000);
  }

  function showOtpError(msg) {
    els.otpError.textContent = msg;
    els.otpError.classList.add("show");
  }
  function clearOtpError() {
    els.otpError.classList.remove("show");
  }

  function prefillFromRecord(v) {
    const setVal = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
    setVal("idType", v.identity?.idType);
    setVal("fullName", v.identity?.fullName);
    setVal("idNumber", v.identity?.idNumber);
    setVal("dateOfBirth", v.identity?.dateOfBirth ? String(v.identity.dateOfBirth).slice(0, 10) : "");
    setVal("nationality", v.identity?.nationality);
    setVal("businessClassification", v.business?.classification);
    setVal("businessName", v.business?.businessName);
    setVal("registrationNumber", v.business?.registrationNumber);
    setVal("businessAge", v.business?.businessAge);
    setVal("kraPinNumber", v.tax?.kraPinNumber);
    setVal("county", v.businessAddress?.county);
    setVal("city", v.businessAddress?.city);
    setVal("street", v.businessAddress?.street);
    setVal("building", v.businessAddress?.building);
    setVal("postalCode", v.businessAddress?.postalCode);

    const warehouseSame = v.warehouseAddress?.sameAsBusiness !== false;
    document.getElementById("warehouseSameAsBusiness").checked = warehouseSame;
    setVal("warehouseName", v.warehouseAddress?.warehouseName);
    setVal("warehouseCounty", v.warehouseAddress?.county);
    setVal("warehouseCity", v.warehouseAddress?.city);
    setVal("warehouseStreet", v.warehouseAddress?.street);
    setVal("warehouseBuilding", v.warehouseAddress?.building);
    setVal("warehouseMapLink", v.warehouseAddress?.mapLink);

    setVal("returnRecipientName", v.returnAddress?.recipientName);
    setVal("returnCounty", v.returnAddress?.county);
    setVal("returnCity", v.returnAddress?.city);
    setVal("returnStreet", v.returnAddress?.street);
    setVal("returnPostalCode", v.returnAddress?.postalCode);

    setVal("storeName", v.store?.storeName);
    if (v.store?.storeDescription) {
      els.storeDescription.value = v.store.storeDescription;
      syncCharCounter();
    }

    if (Array.isArray(v.categories)) {
      v.categories.forEach((c) => selectedCategories.add(c));
    }

    setVal("website", v.social?.website);
    setVal("facebook", v.social?.facebook);
    setVal("instagram", v.social?.instagram);
    setVal("tiktok", v.social?.tiktok);

    setVal("mpesaNumber", v.payout?.mpesaNumber);
    setVal("mpesaName", v.payout?.mpesaName);
    setVal("bankName", v.payout?.bankName);
    setVal("branchName", v.payout?.branchName);
    setVal("accountName", v.payout?.accountName);
    setVal("accountNumber", v.payout?.accountNumber);
    if (v.tax?.vatRegistered) document.getElementById("vatRegistered").checked = true;
    if (v.payout?.method) {
      document.querySelectorAll('input[name="payoutMethod"]').forEach((r) => (r.checked = r.value === v.payout.method));
    }
    if (!IS_WHOLESALER) {
      document.querySelectorAll('input[name="tier"]').forEach((r) => (r.checked = r.value === tier));
    }
    syncTierUI();
    syncPayoutUI();
    syncVatUI();
    syncIdTypeUI();
    syncWarehouseUI();
  }

  // ---------- legal documents ----------
  async function loadLegalDocs() {
    try {
      const res = await SS_API.getRequiredLegalDocuments();
      legalDocs = res.documents || [];
      legalDocs.forEach((d) => { if (d.accepted) legalAcceptedLocal.add(d._id); });
      renderLegalDocs();
    } catch (err) {
      console.error("Couldn't load legal documents:", err);
    }
  }

  function renderLegalDocs() {
    if (!els.legalDocsList) return;
    if (!legalDocs.length) {
      els.legalDocsList.innerHTML = `<p class="form-hint">No agreements are required right now.</p>`;
      return;
    }
    els.legalDocsList.innerHTML = legalDocs.map((d) => `
      <label class="legal-doc-row">
        <input type="checkbox" data-legal-doc="${d._id}" ${legalAcceptedLocal.has(d._id) ? "checked" : ""} />
        <span class="legal-doc-row__body">
          <span class="legal-doc-row__title">
            I have read and accept the <strong>${escapeHtml(d.title)}</strong>
            <span class="doc-version">v${escapeHtml(d.version)}</span>
          </span>
          ${d.fileUrl
            ? `<a class="doc-view-btn" href="${d.fileUrl}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation();">
                 <i class="fa-solid fa-file-pdf"></i> View PDF
               </a>`
            : `<span class="doc-view-btn doc-view-btn--missing"><i class="fa-solid fa-triangle-exclamation"></i> Document unavailable — contact support</span>`}
        </span>
      </label>`).join("");

    els.legalDocsList.querySelectorAll("[data-legal-doc]").forEach((cb) => {
      cb.addEventListener("change", () => {
        cb.checked ? legalAcceptedLocal.add(cb.dataset.legalDoc) : legalAcceptedLocal.delete(cb.dataset.legalDoc);
      });
    });
  }

  function allLegalDocsAccepted() {
    return legalDocs.every((d) => legalAcceptedLocal.has(d._id));
  }

  // ---------- categories ----------
  function renderCategoryGrid() {
    if (!els.categoryGrid) return;
    els.categoryGrid.innerHTML = categoryOptions.map((c) => `
      <label class="category-chip" data-category-chip="${c.value}">
        <input type="checkbox" value="${c.value}" ${selectedCategories.has(c.value) ? "checked" : ""} />
        <span>${escapeHtml(c.label)}</span>
      </label>`).join("");

    els.categoryGrid.querySelectorAll("[data-category-chip]").forEach((chip) => {
      const cb = chip.querySelector("input");
      const sync = () => {
        cb.checked ? selectedCategories.add(cb.value) : selectedCategories.delete(cb.value);
        chip.classList.toggle("active", cb.checked);
      };
      chip.classList.toggle("active", cb.checked);
      cb.addEventListener("change", sync);
    });
  }

  // ---------- store description char counter ----------
  if (els.storeDescription) {
    els.storeDescription.addEventListener("input", syncCharCounter);
  }
  function syncCharCounter() {
    if (els.storeDescCount) els.storeDescCount.textContent = String(els.storeDescription.value.length);
  }

  // ---------- tier choice (retailers only) ----------
  function syncTierUI() {
    document.querySelectorAll("#tierChoiceGroup .tier-choice-card").forEach((card) => {
      card.classList.toggle("active", card.querySelector("input").checked);
    });
    const classification = document.getElementById("businessClassification")?.value;
    document.getElementById("cr12Field").style.display = tier === "business" && classification === "limited_company" ? "block" : "none";
    document.getElementById("partnershipField").style.display = tier === "business" && classification === "partnership" ? "block" : "none";
  }

  document.querySelectorAll('#tierChoiceGroup input[name="tier"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      tier = radio.value;
      syncTierUI();
      renderWizard();
    });
  });
  syncTierUI();

  const businessClassificationSelect = document.getElementById("businessClassification");
  if (businessClassificationSelect) {
    businessClassificationSelect.addEventListener("change", () => {
      document.getElementById("cr12Field").style.display = businessClassificationSelect.value === "limited_company" ? "block" : "none";
      document.getElementById("partnershipField").style.display = businessClassificationSelect.value === "partnership" ? "block" : "none";
    });
  }

  // ---------- ID type toggles the "back" field ----------
  function syncIdTypeUI() {
    const idType = document.getElementById("idType")?.value;
    document.getElementById("idBackField").style.display = idType === "passport" ? "none" : "block";
  }
  const idTypeSelect = document.getElementById("idType");
  if (idTypeSelect) idTypeSelect.addEventListener("change", syncIdTypeUI);
  syncIdTypeUI();

  // ---------- VAT toggle ----------
  function syncVatUI() {
    document.getElementById("vatField").style.display = document.getElementById("vatRegistered")?.checked ? "block" : "none";
  }
  const vatCheckbox = document.getElementById("vatRegistered");
  if (vatCheckbox) vatCheckbox.addEventListener("change", syncVatUI);

  // ---------- warehouse same-as-business toggle ----------
  function syncWarehouseUI() {
    const same = document.getElementById("warehouseSameAsBusiness")?.checked;
    document.getElementById("warehouseFields").style.display = same ? "none" : "block";
  }
  const warehouseToggle = document.getElementById("warehouseSameAsBusiness");
  if (warehouseToggle) warehouseToggle.addEventListener("change", syncWarehouseUI);
  syncWarehouseUI();

  // ---------- return-address same-as-business toggle ----------
  const returnSameCheckbox = document.getElementById("returnSameAsBusiness");
  if (returnSameCheckbox) {
    returnSameCheckbox.addEventListener("change", () => {
      if (!returnSameCheckbox.checked) return;
      document.getElementById("returnCounty").value = document.getElementById("county").value;
      document.getElementById("returnCity").value = document.getElementById("city").value;
      document.getElementById("returnStreet").value = document.getElementById("street").value;
      document.getElementById("returnPostalCode").value = document.getElementById("postalCode").value;
    });
  }

  // ---------- payout method toggle ----------
  function syncPayoutUI() {
    const method = document.querySelector('input[name="payoutMethod"]:checked')?.value || "mpesa";
    document.getElementById("mpesaFields").style.display = method === "mpesa" ? "block" : "none";
    document.getElementById("bankFields").style.display = method === "bank" ? "block" : "none";
    document.querySelectorAll("#payoutMethodGroup .tier-choice-card").forEach((card) => {
      card.classList.toggle("active", card.querySelector("input").checked);
    });
  }
  document.querySelectorAll('#payoutMethodGroup input[name="payoutMethod"]').forEach((radio) => {
    radio.addEventListener("change", syncPayoutUI);
  });
  syncPayoutUI();

  // ---------- file dropzones ----------
  document.querySelectorAll("[data-dropzone]").forEach((zone) => {
    const field = zone.dataset.dropzone;
    const input = zone.querySelector("input[type=file]");
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      files[field] = file;
      const previewContainer = zone.nextElementSibling;
      if (previewContainer && previewContainer.classList.contains("image-preview")) {
        const url = URL.createObjectURL(file);
        const isImage = file.type.startsWith("image/");
        previewContainer.innerHTML = `
          <div class="image-preview-item">
            ${isImage
              ? `<img src="${url}" alt="Preview" />`
              : `<div style="width:80px;height:80px;display:flex;align-items:center;justify-content:center;background:var(--paper-dim,#f1e4ce);border-radius:8px;border:1px solid var(--line,#e4d6bd);"><i class="fa-solid fa-file-pdf" style="font-size:22px;color:var(--brick,#b8442e);"></i></div>`}
            <button type="button" class="image-preview-remove" data-remove-field="${field}"><i class="fa-solid fa-xmark"></i></button>
          </div>`;
        previewContainer.querySelector("[data-remove-field]").addEventListener("click", () => {
          delete files[field];
          input.value = "";
          previewContainer.innerHTML = "";
        });
      }
    });
  });

  // ---------- wizard render / navigate ----------
  function renderWizard() {
    const steps = getActiveSteps();
    if (currentStepIdx > steps.length - 1) currentStepIdx = steps.length - 1;
    if (currentStepIdx < 0) currentStepIdx = 0;

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

    document.querySelectorAll("[data-step-panel]").forEach((panel) => {
      const idx = steps.indexOf(panel.dataset.stepPanel);
      panel.style.display = idx === currentStepIdx ? "block" : "none";
    });

    const isLast = currentStepIdx === steps.length - 1;
    els.wizardBackBtn.style.display = currentStepIdx === 0 ? "none" : "inline-flex";
    els.wizardNextBtn.style.display = isLast ? "none" : "inline-flex";
    els.submitVerifyBtn.style.display = isLast ? "inline-flex" : "none";

    if (isLast) renderReviewSummary();
  }

  function renderReviewSummary() {
    const row = (label, val) => (val ? `<div><strong>${label}:</strong> ${escapeHtml(String(val))}</div>` : "");
    const payoutMethod = document.querySelector('input[name="payoutMethod"]:checked')?.value;
    const categoryLabels = [...selectedCategories]
      .map((v) => categoryOptions.find((c) => c.value === v)?.label || v)
      .join(", ");
    els.reviewSummary.innerHTML = [
      row("Verification path", tier === "basic" ? "Basic — Individual seller" : "Registered business"),
      row("Full name", document.getElementById("fullName")?.value),
      row("ID number", document.getElementById("idNumber")?.value),
      tier === "business" ? row("Business name", document.getElementById("businessName")?.value) : "",
      row("KRA PIN", document.getElementById("kraPinNumber")?.value),
      row("Business county", document.getElementById("county")?.value),
      row("Store name", document.getElementById("storeName")?.value),
      row("Categories", categoryLabels),
      row("Payout method", payoutMethod === "mpesa" ? "M-Pesa" : "Bank transfer"),
    ].join("");
  }

  function showError(msg) {
    els.formError.textContent = msg;
    els.formError.classList.add("show");
  }
  function clearError() {
    els.formError.classList.remove("show");
  }

  function validateStep(key) {
    if (key === "tier") return null;

    if (key === "identity") {
      if (!document.getElementById("fullName").value.trim()) return "Enter your full name as it appears on your ID.";
      if (!document.getElementById("idNumber").value.trim()) return "Enter your ID number.";
      if (!document.getElementById("dateOfBirth").value) return "Enter your date of birth.";
      if (!document.getElementById("nationality").value.trim()) return "Enter your nationality.";
      if (!files.idFrontImage) return "Upload a photo of the front of your ID.";
      const idType = document.getElementById("idType").value;
      if (idType !== "passport" && !files.idBackImage) return "Upload a photo of the back of your ID.";
      if (!files.selfieWithId) return "Upload a selfie holding your ID.";
      return null;
    }

    if (key === "business") {
      const classification = document.getElementById("businessClassification").value;
      if (!classification) return "Select your business classification.";
      if (!document.getElementById("businessName").value.trim()) return "Enter your business name.";
      if (!files.registrationCertificate) return "Upload your business registration certificate.";
      if (classification === "limited_company" && !files.cr12Document) return "Upload your CR12 document.";
      if (classification === "partnership" && !files.partnershipAgreement) return "Upload your partnership agreement.";
      return null;
    }

    if (key === "tax") {
      if (!document.getElementById("kraPinNumber").value.trim()) return "Enter your KRA PIN number.";
      if (!files.kraPinCertificate) return "Upload your KRA PIN certificate.";
      if (document.getElementById("vatRegistered").checked && !files.vatCertificate) return "Upload your VAT registration certificate, or untick VAT registered.";
      return null;
    }

    if (key === "address") {
      if (!document.getElementById("county").value.trim()) return "Enter your business county.";
      return null;
    }

    if (key === "warehouse") {
      const same = document.getElementById("warehouseSameAsBusiness").checked;
      if (!same && !document.getElementById("warehouseCounty").value.trim()) return "Enter your warehouse county, or mark it as same as your business address.";
      return null;
    }

    if (key === "returns") {
      if (!document.getElementById("returnRecipientName").value.trim()) return "Enter a recipient name for returns.";
      if (!document.getElementById("returnCounty").value.trim()) return "Enter a county for returns.";
      return null;
    }

    if (key === "store") {
      if (!document.getElementById("storeName").value.trim()) return "Enter your store name.";
      return null;
    }

    if (key === "categories") {
      if (!selectedCategories.size) return "Select at least one product category.";
      return null;
    }

    if (key === "social") return null;

    if (key === "payout") {
      const method = document.querySelector('input[name="payoutMethod"]:checked')?.value;
      if (method === "mpesa" && !document.getElementById("mpesaNumber").value.trim()) return "Enter your M-Pesa number.";
      if (method === "bank" && (!document.getElementById("bankName").value.trim() || !document.getElementById("accountNumber").value.trim())) {
        return "Enter your bank name and account number.";
      }
      return null;
    }

    if (key === "review") {
      if (!allLegalDocsAccepted()) return "You need to accept all the agreements above to continue.";
      return null;
    }

    return null;
  }

  function handleNext() {
    const steps = getActiveSteps();
    const err = validateStep(steps[currentStepIdx]);
    if (err) { showError(err); return; }
    clearError();
    if (currentStepIdx < steps.length - 1) { currentStepIdx++; renderWizard(); }
  }
  function handleBack() {
    if (currentStepIdx > 0) { currentStepIdx--; renderWizard(); clearError(); }
  }

  els.wizardNextBtn.addEventListener("click", handleNext);
  els.wizardBackBtn.addEventListener("click", handleBack);

  els.verifyForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const steps = getActiveSteps();
    if (currentStepIdx !== steps.length - 1) { handleNext(); return; }

    const err = validateStep("review");
    if (err) { showError(err); return; }
    clearError();

    els.submitVerifyBtn.disabled = true;
    els.submitVerifyBtn.textContent = "Submitting…";

    try {
      // Persist any newly-checked legal-document acceptances first.
      const toAccept = legalDocs.filter((d) => legalAcceptedLocal.has(d._id) && !d.accepted);
      for (const d of toAccept) {
        await SS_API.acceptLegalDocument(d._id);
        d.accepted = true;
      }

      const warehouseSame = document.getElementById("warehouseSameAsBusiness").checked;

      const fd = new FormData();
      fd.append("tier", tier);
      fd.append("idType", document.getElementById("idType").value);
      fd.append("fullName", document.getElementById("fullName").value.trim());
      fd.append("idNumber", document.getElementById("idNumber").value.trim());
      fd.append("dateOfBirth", document.getElementById("dateOfBirth").value);
      fd.append("nationality", document.getElementById("nationality").value.trim());
      fd.append("kraPinNumber", document.getElementById("kraPinNumber").value.trim());
      fd.append("vatRegistered", document.getElementById("vatRegistered").checked ? "true" : "false");

      fd.append("county", document.getElementById("county").value.trim());
      fd.append("city", document.getElementById("city").value.trim());
      fd.append("street", document.getElementById("street").value.trim());
      fd.append("building", document.getElementById("building").value.trim());
      fd.append("postalCode", document.getElementById("postalCode").value.trim());

      fd.append("warehouseSameAsBusiness", warehouseSame ? "true" : "false");
      if (!warehouseSame) {
        fd.append("warehouseName", document.getElementById("warehouseName").value.trim());
        fd.append("warehouseCounty", document.getElementById("warehouseCounty").value.trim());
        fd.append("warehouseCity", document.getElementById("warehouseCity").value.trim());
        fd.append("warehouseStreet", document.getElementById("warehouseStreet").value.trim());
        fd.append("warehouseBuilding", document.getElementById("warehouseBuilding").value.trim());
        fd.append("warehouseMapLink", document.getElementById("warehouseMapLink").value.trim());
      }

      fd.append("returnRecipientName", document.getElementById("returnRecipientName").value.trim());
      fd.append("returnCounty", document.getElementById("returnCounty").value.trim());
      fd.append("returnCity", document.getElementById("returnCity").value.trim());
      fd.append("returnStreet", document.getElementById("returnStreet").value.trim());
      fd.append("returnPostalCode", document.getElementById("returnPostalCode").value.trim());

      fd.append("storeName", document.getElementById("storeName").value.trim());
      fd.append("storeDescription", els.storeDescription.value.trim());

      fd.append("categories", JSON.stringify([...selectedCategories]));

      fd.append("website", document.getElementById("website").value.trim());
      fd.append("facebook", document.getElementById("facebook").value.trim());
      fd.append("instagram", document.getElementById("instagram").value.trim());
      fd.append("tiktok", document.getElementById("tiktok").value.trim());

      fd.append("payoutMethod", document.querySelector('input[name="payoutMethod"]:checked')?.value || "mpesa");
      fd.append("mpesaNumber", document.getElementById("mpesaNumber").value.trim());
      fd.append("mpesaName", document.getElementById("mpesaName").value.trim());
      fd.append("bankName", document.getElementById("bankName").value.trim());
      fd.append("branchName", document.getElementById("branchName").value.trim());
      fd.append("accountName", document.getElementById("accountName").value.trim());
      fd.append("accountNumber", document.getElementById("accountNumber").value.trim());
      fd.append("agreedToTerms", "true");

      if (tier === "business") {
        fd.append("businessClassification", document.getElementById("businessClassification").value);
        fd.append("businessName", document.getElementById("businessName").value.trim());
        fd.append("registrationNumber", document.getElementById("registrationNumber").value.trim());
        fd.append("businessAge", document.getElementById("businessAge").value);
      }

      Object.entries(files).forEach(([field, file]) => fd.append(field, file));

      await SS_API.submitVerification(fd);
      ssToast("Submitted — we'll review it shortly", "fa-circle-check");
      showStatusScreen("pending");
    } catch (err2) {
      showError(err2.message || "Couldn't submit your verification. Please try again.");
      els.submitVerifyBtn.disabled = false;
      els.submitVerifyBtn.textContent = "Submit for review";
    }
  });

  function escapeHtml(str = "") {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }
})();