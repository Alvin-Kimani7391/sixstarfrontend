/* ============================================================
   RFQ.JS — reusable "Request a Quote" form controller
   ============================================================
   Exposes window.SS_RFQ_FORM.init(options) so the exact same
   logic (image preview, description counter, date guard,
   validation, submit) can drive BOTH:
     - the full-page form on rfq.html
     - the "Quick Quote" bottom-sheet form embedded in chat.html
   because both markups share the same field ids (#rfqForm,
   #productName, #quantity, #minBudget ... see chat.html's
   rfq-sheet markup and rfq.html's rfq-form-card markup).

   On rfq.html the whole page is buyer-gated up front (see the
   bootRfqPage() block at the bottom of this file). On chat.html
   the board itself stays public — chat.js opens the sheet for
   anyone to browse/compose, and this controller only checks the
   buyer session at submit time, redirecting to login if needed.
   ============================================================ */
(function (global) {
  'use strict';

  function esc(str) { return ssEscapeHtml(String(str ?? '')); }
  function money(n) { return ssFmtPrice(n); }
  function toast(msg, icon) { ssToast(msg, icon); }

  const STATUS_LABEL = {
    OPEN: 'Open', BIDDING: 'Receiving Offers', SELLER_SELECTED: 'Seller Selected',
    CLOSED: 'Closed', EXPIRED: 'Expired', CANCELLED: 'Cancelled',
  };

  function statusPill(status) {
    return `<span class="rfq-status rfq-status--${status.toLowerCase()}">${STATUS_LABEL[status] || status}</span>`;
  }

  function fmtDate(d) {
    return d ? new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  }

  /* ============================================================
     SS_RFQ_FORM — the reusable controller
     ============================================================ */
  const SS_RFQ_FORM = (function () {

    async function ensureBuyer() {
      try {
        const res = await SS_API.getMe();
        const user = (res && (res.user || res)) || null;
        if (!user) throw new Error('no-session');
        const role = (user.role || '').toLowerCase();
        if (role && role !== 'buyer') {
          toast('Only buyers can post a quote request.', 'fa-circle-info');
          return false;
        }
        return true;
      } catch (err) {
        toast('Log in to post a quote request.', 'fa-lock');
        return false;
      }
    }

    /**
     * Wire up one instance of the RFQ form.
     * @param {Object}  [opts]
     * @param {Element|Document} [opts.root=document] scope to find #rfqForm and its fields in
     * @param {boolean} [opts.checkAuth=true]  verify a buyer session before posting
     * @param {Function} [opts.onStart]    called once validation + auth pass, right before the request fires
     * @param {Function} [opts.onSuccess]  called with the created rfq; default redirects to rfq-detail.html
     * @param {Function} [opts.onError]    called with the error after a failed post
     * @param {Function} [opts.onAuthFail] called instead of the default login redirect when checkAuth fails
     * @returns {{reset:Function, form:Element}|null}
     */
    function init(opts) {
      opts = opts || {};
      const root = opts.root || document;
      const form = root.querySelector('#rfqForm');
      if (!form) return null;
      if (form.dataset.ssRfqBound === '1') return form._ssRfqController || null;

      const imageInput = root.querySelector('#productImage');
      const imageDrop = root.querySelector('#imageDrop');
      const imageDropText = root.querySelector('#imageDropText');
      const descEl = root.querySelector('#description');
      const descHint = root.querySelector('#descHint');
      const requiredDateInput = root.querySelector('#requiredDate');
      const errEl = root.querySelector('#rfqError');
      // NOTE: on the chat.html sheet, the submit button sits in the sheet
      // footer using form="rfqForm" rather than nested inside <form>, so
      // it's queried from `root` (which wraps both) instead of `form`.
      const submitBtn = root.querySelector('#rfqSubmitBtn');

      /* ---- image preview ---- */
      if (imageInput && imageDrop) {
        imageInput.addEventListener('change', () => {
          const file = imageInput.files[0];
          if (!file) return;
          if (file.size > 5 * 1024 * 1024) {
            toast('Image must be under 5MB', 'fa-circle-exclamation');
            imageInput.value = '';
            return;
          }
          const reader = new FileReader();
          reader.onload = (e) => {
            if (imageDropText) imageDropText.style.display = 'none';
            let img = imageDrop.querySelector('img');
            if (!img) {
              img = document.createElement('img');
              imageDrop.insertBefore(img, imageInput);
            }
            img.src = e.target.result;
          };
          reader.readAsDataURL(file);
        });
      }

      /* ---- description length hint ---- */
      if (descEl && descHint) {
        descEl.addEventListener('input', () => {
          const len = descEl.value.trim().length;
          descHint.textContent = len < 20 ? `Minimum 20 characters (${len}/20)` : `${len} characters`;
          descHint.style.color = len < 20 ? 'var(--danger)' : 'var(--ink-faint)';
        });
      }

      /* ---- required-by date can't be in the past ---- */
      if (requiredDateInput) {
        const tomorrow = new Date(Date.now() + 86400000);
        requiredDateInput.min = tomorrow.toISOString().slice(0, 10);
      }

      function showError(msg) {
        if (!errEl) { toast(msg, 'fa-triangle-exclamation'); return; }
        errEl.textContent = msg;
        errEl.style.display = 'block';
        errEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      function resetForm() {
        form.reset();
        if (imageDrop) {
          const img = imageDrop.querySelector('img');
          if (img) img.remove();
        }
        if (imageDropText) imageDropText.style.display = '';
        if (descHint) { descHint.textContent = 'Minimum 20 characters'; descHint.style.color = 'var(--ink-faint)'; }
        if (errEl) errEl.style.display = 'none';
      }

      /* ---- submit ---- */
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (errEl) errEl.style.display = 'none';

        const minBudgetEl = root.querySelector('#minBudget');
        const maxBudgetEl = root.querySelector('#maxBudget');
        const minBudget = Number(minBudgetEl.value);
        const maxBudget = Number(maxBudgetEl.value);
        if (minBudget > maxBudget) {
          showError('Minimum budget cannot be greater than maximum budget.');
          return;
        }
        if (!descEl || descEl.value.trim().length < 20) {
          showError('Please add a bit more detail to your description (at least 20 characters).');
          return;
        }

        if (opts.checkAuth !== false) {
          const okAuth = await ensureBuyer();
          if (!okAuth) {
            if (typeof opts.onAuthFail === 'function') {
              opts.onAuthFail();
            } else {
              const page = window.location.pathname.split('/').pop() || 'chat.html';
              setTimeout(() => { window.location.href = `login.html?redirect=${encodeURIComponent(page)}`; }, 700);
            }
            return;
          }
        }

        if (typeof opts.onStart === 'function') opts.onStart();

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.dataset.origHtml = submitBtn.dataset.origHtml || submitBtn.innerHTML;
          submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Posting...';
        }

        const fd = new FormData();
        fd.append('productName', root.querySelector('#productName').value.trim());
        fd.append('quantity', root.querySelector('#quantity').value);
        fd.append('unit', root.querySelector('#unit').value.trim());
        fd.append('minBudget', minBudget);
        fd.append('maxBudget', maxBudget);
        fd.append('budgetType', root.querySelector('#budgetType').value);
        fd.append('location', root.querySelector('#location').value.trim());
        fd.append('requiredDate', root.querySelector('#requiredDate').value);
        fd.append('deliveryRequired', root.querySelector('#deliveryRequired').value);
        fd.append('deliveryBudget', root.querySelector('#deliveryBudget').value || 0);
        fd.append('description', descEl.value.trim());
        if (imageInput && imageInput.files[0]) fd.append('productImage', imageInput.files[0]);

        try {
          const { rfq } = await SS_API.createRFQ(fd);
          toast('Request posted! Sellers can now submit offers.', 'fa-circle-check');
          resetForm();
          if (typeof opts.onSuccess === 'function') opts.onSuccess(rfq);
          else window.location.href = `rfq-detail.html?id=${rfq._id}`;
        } catch (err) {
          showError(err.message || 'Could not post your request. Please try again.');
          if (typeof opts.onError === 'function') opts.onError(err);
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = submitBtn.dataset.origHtml || '<i class="fa-solid fa-paper-plane"></i> Post Request';
          }
        }
      });

      form.dataset.ssRfqBound = '1';
      const controller = { reset: resetForm, form };
      form._ssRfqController = controller;
      return controller;
    }

    return { init };
  })();

  global.SS_RFQ_FORM = SS_RFQ_FORM;

  /* ============================================================
     PAGE BOOTSTRAP — the "post + my requests" flow, but only when
     this script is loaded on rfq.html itself (it looks for
     #myRfqGrid, which only exists there). On chat.html this
     quietly no-ops and chat.js calls SS_RFQ_FORM.init() directly
     for the Quick Quote sheet instead.
     ============================================================ */
  const myRfqGrid = document.getElementById('myRfqGrid');
  if (myRfqGrid) {
    const user = SS_AUTH.requireRole(['buyer']);
    if (user) {
      // Page is already buyer-gated above, so the form controller
      // doesn't need to re-check auth on submit.
      SS_RFQ_FORM.init({ checkAuth: false });

      function rfqCardHTML(r) {
        const img = r.productImage || 'https://placehold.co/400x260/F3F4F8/15161A?text=No+Photo';
        return `
          <a class="rfq-card" href="rfq-detail.html?id=${r._id}">
            <div class="rfq-card__img"><img src="${esc(img)}" alt="${esc(r.productName)}" loading="lazy"></div>
            <div class="rfq-card__body">
              <div class="rfq-card__title">${esc(r.productName)}</div>
              <div class="rfq-card__meta">
                <span><i class="fa-solid fa-box"></i> ${r.quantity} ${esc(r.unit)}</span>
                <span><i class="fa-solid fa-calendar"></i> ${fmtDate(r.requiredDate)}</span>
              </div>
              <div class="rfq-card__foot">
                ${statusPill(r.status)}
                <span class="rfq-card__bids">${r.bidCount || 0} offer${r.bidCount === 1 ? '' : 's'}</span>
              </div>
            </div>
          </a>`;
      }

      (async function loadMyRFQs() {
        try {
          const { rfqs } = await SS_API.getMyRFQs();
          if (!rfqs || !rfqs.length) {
            myRfqGrid.innerHTML = `<div class="offer-empty" style="grid-column:1/-1;"><i class="fa-solid fa-file-circle-question"></i>You haven't posted any requests yet.</div>`;
            return;
          }
          myRfqGrid.innerHTML = rfqs.map(rfqCardHTML).join('');
        } catch (err) {
          myRfqGrid.innerHTML = `<div class="offer-empty" style="grid-column:1/-1;"><i class="fa-solid fa-triangle-exclamation"></i>${esc(err.message || 'Could not load your requests.')}</div>`;
        }
      })();
    }
  }
})(window);