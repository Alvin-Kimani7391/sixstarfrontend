/* ============================================================
   SIX STAR SUPPLIERS — Seller Profile (post-approval, safe-fields only)
   Personal / location / warehouse / returns / store / categories /
   social / payout. Identity, business docs and tax stay locked here —
   this page never touches them, so saving never triggers re-review.
   ============================================================ */

(async () => {
  const user = await SS_AUTH.requireRole(["wholesaler", "retailer"]);
  if (!user) return;

  const els = {
    logoutBtn: document.getElementById("logoutBtn"),
    loadingState: document.getElementById("loadingState"),
    lockedOutState: document.getElementById("lockedOutState"),
    lockedOutMsg: document.getElementById("lockedOutMsg"),
    lockedBanner: document.getElementById("lockedBanner"),
    lockedSummary: document.getElementById("lockedSummary"),
    profileForm: document.getElementById("profileForm"),
    formError: document.getElementById("formError"),
    pfSaveBtn: document.getElementById("pfSaveBtn"),

    pfName: document.getElementById("pfName"),
    pfPhone: document.getElementById("pfPhone"),

    pfCounty: document.getElementById("pfCounty"),
    pfCity: document.getElementById("pfCity"),
    pfStreet: document.getElementById("pfStreet"),
    pfBuilding: document.getElementById("pfBuilding"),
    pfPostalCode: document.getElementById("pfPostalCode"),

    pfWarehouseSame: document.getElementById("pfWarehouseSame"),
    pfWarehouseFields: document.getElementById("pfWarehouseFields"),
    pfWarehouseName: document.getElementById("pfWarehouseName"),
    pfWarehouseCounty: document.getElementById("pfWarehouseCounty"),
    pfWarehouseCity: document.getElementById("pfWarehouseCity"),
    pfWarehouseStreet: document.getElementById("pfWarehouseStreet"),
    pfWarehouseBuilding: document.getElementById("pfWarehouseBuilding"),
    pfWarehouseMapLink: document.getElementById("pfWarehouseMapLink"),

    pfReturnRecipient: document.getElementById("pfReturnRecipient"),
    pfReturnCounty: document.getElementById("pfReturnCounty"),
    pfReturnCity: document.getElementById("pfReturnCity"),
    pfReturnStreet: document.getElementById("pfReturnStreet"),
    pfReturnPostalCode: document.getElementById("pfReturnPostalCode"),

    pfStoreName: document.getElementById("pfStoreName"),
    pfStoreDescription: document.getElementById("pfStoreDescription"),
    pfStoreDescCount: document.getElementById("pfStoreDescCount"),
    pfStoreLogo: document.getElementById("pfStoreLogo"),
    pfStoreBanner: document.getElementById("pfStoreBanner"),
    pfStoreLogoPreview: document.getElementById("pfStoreLogoPreview"),
    pfStoreBannerPreview: document.getElementById("pfStoreBannerPreview"),

    pfCategoryGrid: document.getElementById("pfCategoryGrid"),

    pfWebsite: document.getElementById("pfWebsite"),
    pfFacebook: document.getElementById("pfFacebook"),
    pfInstagram: document.getElementById("pfInstagram"),
    pfTiktok: document.getElementById("pfTiktok"),

    pfPayoutMethodGroup: document.getElementById("pfPayoutMethodGroup"),
    pfMpesaFields: document.getElementById("pfMpesaFields"),
    pfBankFields: document.getElementById("pfBankFields"),
    pfMpesaNumber: document.getElementById("pfMpesaNumber"),
    pfMpesaName: document.getElementById("pfMpesaName"),
    pfBankName: document.getElementById("pfBankName"),
    pfBranchName: document.getElementById("pfBranchName"),
    pfAccountName: document.getElementById("pfAccountName"),
    pfAccountNumber: document.getElementById("pfAccountNumber"),
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

  const selectedCategories = new Set();
  let storeLogoFile = null;
  let storeBannerFile = null;

  function escapeHtml(str = "") {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function humanize(v) {
    return String(v).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // ---------- load ----------
  try {
    const res = await SS_API.getMySellerProfile();
    renderLockedSummary(res.locked);
    renderCategoryGrid(res.categoryOptions || [], res.profile.categories || []);
    populateForm(res.profile);

    els.loadingState.style.display = "none";
    els.lockedBanner.style.display = "flex";
    els.profileForm.style.display = "block";
  } catch (err) {
    els.loadingState.style.display = "none";
    els.lockedOutState.style.display = "block";
    if (err.status === 403) {
      els.lockedOutMsg.textContent = err.message || "Your seller profile unlocks once your verification is approved.";
    } else {
      els.lockedOutMsg.textContent = err.message || "Couldn't load your profile. Please try again shortly.";
    }
  } finally {
    hideLoader();
  }

  function renderLockedSummary(locked) {
    if (!locked || !els.lockedSummary) return;
    const rows = [
      ["Tier", locked.tier === "business" ? "Registered business" : "Basic — Individual"],
      ["Full name", locked.identity?.fullName],
      ["ID number", locked.identity?.idNumber],
      locked.business?.businessName ? ["Business name", locked.business.businessName] : null,
      ["KRA PIN", locked.tax?.kraPinNumber],
    ].filter(Boolean);

    els.lockedSummary.innerHTML = rows
      .map(
        ([label, val]) => `<div class="locked-summary__item">
          <span class="lbl">${escapeHtml(label)}</span>
          <span class="val">${escapeHtml(val || "—")}</span>
        </div>`
      )
      .join("");
  }

  function renderCategoryGrid(options, current) {
    current.forEach((c) => selectedCategories.add(c));
    els.pfCategoryGrid.innerHTML = options
      .map((c) => {
        const value = typeof c === "string" ? c : c.value;
        const label = typeof c === "string" ? humanize(c) : c.label;
        return `<label class="category-chip" data-category-chip="${value}">
          <input type="checkbox" value="${value}" ${selectedCategories.has(value) ? "checked" : ""} />
          <span>${escapeHtml(label)}</span>
        </label>`;
      })
      .join("");

    els.pfCategoryGrid.querySelectorAll("[data-category-chip]").forEach((chip) => {
      const cb = chip.querySelector("input");
      chip.classList.toggle("active", cb.checked);
      cb.addEventListener("change", () => {
        cb.checked ? selectedCategories.add(cb.value) : selectedCategories.delete(cb.value);
        chip.classList.toggle("active", cb.checked);
      });
    });
  }

  function populateForm(p) {
    els.pfName.value = p.name || "";
    els.pfPhone.value = p.phone || "";

    const ba = p.businessAddress || {};
    els.pfCounty.value = ba.county || "";
    els.pfCity.value = ba.city || "";
    els.pfStreet.value = ba.street || "";
    els.pfBuilding.value = ba.building || "";
    els.pfPostalCode.value = ba.postalCode || "";

    const wa = p.warehouseAddress || {};
    const warehouseSame = wa.sameAsBusiness !== false;
    els.pfWarehouseSame.checked = warehouseSame;
    els.pfWarehouseName.value = wa.warehouseName || "";
    els.pfWarehouseCounty.value = wa.county || "";
    els.pfWarehouseCity.value = wa.city || "";
    els.pfWarehouseStreet.value = wa.street || "";
    els.pfWarehouseBuilding.value = wa.building || "";
    els.pfWarehouseMapLink.value = wa.mapLink || "";
    syncWarehouseUI();

    const ra = p.returnAddress || {};
    els.pfReturnRecipient.value = ra.recipientName || "";
    els.pfReturnCounty.value = ra.county || "";
    els.pfReturnCity.value = ra.city || "";
    els.pfReturnStreet.value = ra.street || "";
    els.pfReturnPostalCode.value = ra.postalCode || "";

    const store = p.store || {};
    els.pfStoreName.value = store.storeName || "";
    els.pfStoreDescription.value = store.storeDescription || "";
    els.pfStoreDescCount.textContent = String(els.pfStoreDescription.value.length);
    if (store.storeLogo) setImagePreview(els.pfStoreLogoPreview, store.storeLogo);
    if (store.storeBanner) setImagePreview(els.pfStoreBannerPreview, store.storeBanner);

    const social = p.social || {};
    els.pfWebsite.value = social.website || "";
    els.pfFacebook.value = social.facebook || "";
    els.pfInstagram.value = social.instagram || "";
    els.pfTiktok.value = social.tiktok || "";

    const payout = p.payout || {};
    const method = payout.method || "mpesa";
    document.querySelectorAll('input[name="pfPayoutMethod"]').forEach((r) => (r.checked = r.value === method));
    els.pfMpesaNumber.value = payout.mpesaNumber || "";
    els.pfMpesaName.value = payout.mpesaName || "";
    els.pfBankName.value = payout.bankName || "";
    els.pfBranchName.value = payout.branchName || "";
    els.pfAccountName.value = payout.accountName || "";
    els.pfAccountNumber.value = payout.accountNumber || "";
    syncPayoutUI();
    syncTierCardActive();
  }

  // ---------- warehouse same-as-business toggle ----------
  function syncWarehouseUI() {
    els.pfWarehouseFields.style.display = els.pfWarehouseSame.checked ? "none" : "block";
  }
  els.pfWarehouseSame.addEventListener("change", syncWarehouseUI);

  // ---------- store description char counter ----------
  els.pfStoreDescription.addEventListener("input", () => {
    els.pfStoreDescCount.textContent = String(els.pfStoreDescription.value.length);
  });

  // ---------- store image upload previews ----------
  function setImagePreview(container, url) {
    if (!container) return;
    if (!url) { container.innerHTML = ""; return; }
    container.innerHTML = `
      <div class="image-preview-item">
        <img src="${url}" alt="Preview" />
        <button type="button" class="image-preview-remove" title="Remove"><i class="fa-solid fa-xmark"></i></button>
      </div>`;
  }

  function handleImagePicked(file, kind) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      ssToast("Please choose a JPG or PNG image", "fa-triangle-exclamation");
      return;
    }
    const url = URL.createObjectURL(file);
    if (kind === "logo") {
      storeLogoFile = file;
      setImagePreview(els.pfStoreLogoPreview, url);
    } else {
      storeBannerFile = file;
      setImagePreview(els.pfStoreBannerPreview, url);
    }
  }

  els.pfStoreLogo.addEventListener("change", (e) => handleImagePicked(e.target.files?.[0], "logo"));
  els.pfStoreBanner.addEventListener("change", (e) => handleImagePicked(e.target.files?.[0], "banner"));

  // ---------- payout method toggle ----------
  function syncPayoutUI() {
    const method = document.querySelector('input[name="pfPayoutMethod"]:checked')?.value || "mpesa";
    els.pfMpesaFields.style.display = method === "mpesa" ? "block" : "none";
    els.pfBankFields.style.display = method === "bank" ? "block" : "none";
    syncTierCardActive();
  }
  function syncTierCardActive() {
    document.querySelectorAll("#pfPayoutMethodGroup .tier-choice-card").forEach((card) => {
      card.classList.toggle("active", card.querySelector("input").checked);
    });
  }
  document.querySelectorAll('input[name="pfPayoutMethod"]').forEach((radio) => {
    radio.addEventListener("change", syncPayoutUI);
  });

  // ---------- submit ----------
  function showFormError(msg) {
    els.formError.textContent = msg;
    els.formError.classList.add("show");
  }

  els.profileForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    els.formError.classList.remove("show");

    if (!els.pfName.value.trim() || !els.pfPhone.value.trim()) {
      showFormError("Full name and phone number are required.");
      return;
    }
    if (!els.pfCounty.value.trim()) {
      showFormError("Business county is required.");
      return;
    }
    if (!els.pfReturnRecipient.value.trim() || !els.pfReturnCounty.value.trim()) {
      showFormError("Return address needs a recipient name and county.");
      return;
    }
    if (!els.pfStoreName.value.trim()) {
      showFormError("Store name is required.");
      return;
    }
    if (!selectedCategories.size) {
      showFormError("Select at least one product category.");
      return;
    }
    const payoutMethod = document.querySelector('input[name="pfPayoutMethod"]:checked')?.value || "mpesa";
    if (payoutMethod === "mpesa" && !els.pfMpesaNumber.value.trim()) {
      showFormError("Enter your M-Pesa number.");
      return;
    }
    if (payoutMethod === "bank" && (!els.pfBankName.value.trim() || !els.pfAccountNumber.value.trim())) {
      showFormError("Enter your bank name and account number.");
      return;
    }

    const fd = new FormData();
    fd.append("name", els.pfName.value.trim());
    fd.append("phone", els.pfPhone.value.trim());

    fd.append("county", els.pfCounty.value.trim());
    fd.append("city", els.pfCity.value.trim());
    fd.append("street", els.pfStreet.value.trim());
    fd.append("building", els.pfBuilding.value.trim());
    fd.append("postalCode", els.pfPostalCode.value.trim());

    const warehouseSame = els.pfWarehouseSame.checked;
    fd.append("warehouseSameAsBusiness", warehouseSame ? "true" : "false");
    if (!warehouseSame) {
      fd.append("warehouseName", els.pfWarehouseName.value.trim());
      fd.append("warehouseCounty", els.pfWarehouseCounty.value.trim());
      fd.append("warehouseCity", els.pfWarehouseCity.value.trim());
      fd.append("warehouseStreet", els.pfWarehouseStreet.value.trim());
      fd.append("warehouseBuilding", els.pfWarehouseBuilding.value.trim());
      fd.append("warehouseMapLink", els.pfWarehouseMapLink.value.trim());
    }

    fd.append("returnRecipientName", els.pfReturnRecipient.value.trim());
    fd.append("returnCounty", els.pfReturnCounty.value.trim());
    fd.append("returnCity", els.pfReturnCity.value.trim());
    fd.append("returnPostalCode", els.pfReturnPostalCode.value.trim());
    fd.append("returnStreet", els.pfReturnStreet.value.trim());

    fd.append("storeName", els.pfStoreName.value.trim());
    fd.append("storeDescription", els.pfStoreDescription.value.trim());
    if (storeLogoFile) fd.append("storeLogo", storeLogoFile);
    if (storeBannerFile) fd.append("storeBanner", storeBannerFile);

    fd.append("categories", JSON.stringify([...selectedCategories]));

    fd.append("website", els.pfWebsite.value.trim());
    fd.append("facebook", els.pfFacebook.value.trim());
    fd.append("instagram", els.pfInstagram.value.trim());
    fd.append("tiktok", els.pfTiktok.value.trim());

    fd.append("payoutMethod", payoutMethod);
    fd.append("mpesaNumber", els.pfMpesaNumber.value.trim());
    fd.append("mpesaName", els.pfMpesaName.value.trim());
    fd.append("bankName", els.pfBankName.value.trim());
    fd.append("branchName", els.pfBranchName.value.trim());
    fd.append("accountName", els.pfAccountName.value.trim());
    fd.append("accountNumber", els.pfAccountNumber.value.trim());

    els.pfSaveBtn.disabled = true;
    els.pfSaveBtn.textContent = "Saving…";

    try {
      const res = await SS_API.updateMySellerProfile(fd);
      storeLogoFile = null;
      storeBannerFile = null;
      ssToast("Profile updated", "fa-circle-check");

      // Refresh cached user (name/phone may have changed) without a full reload
      const cachedUser = SS_AUTH.get();
      if (cachedUser) {
        SS_AUTH.set({ ...cachedUser, name: res.profile.name, phone: res.profile.phone });
      }
    } catch (err) {
      showFormError(err.message || "Couldn't save your profile. Please try again.");
    } finally {
      els.pfSaveBtn.disabled = false;
      els.pfSaveBtn.textContent = "Save changes";
      els.pfSaveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save changes';
    }
  });
})();