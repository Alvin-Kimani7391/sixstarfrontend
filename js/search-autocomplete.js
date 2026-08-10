/**
 * search-autocomplete.js
 * -----------------------------------------------------------------------
 * Jumia-style live search suggestions. Attach it to ANY input by giving
 * that input the attribute  data-search-input  — works on the header
 * search box once it's rendered by ui.js, and on shop-detail.html's own
 * search box.
 *
 * Requires js/config.js, js/api.js (with the getProductSuggestions patch
 * applied — see api.suggestions.patch.js) loaded first.
 *
 * Include near the end of <body>, after js/api.js:
 *   <link rel="stylesheet" href="css/search-autocomplete.css">
 *   <script src="js/search-autocomplete.js"></script>
 * -----------------------------------------------------------------------
 */
(function () {
  const DEBOUNCE_MS = 220;
  const MIN_CHARS = 2;

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function fmtPrice(n) {
    if (n == null) return '';
    return 'Ksh ' + Number(n).toLocaleString();
  }

  function buildDropdown(input) {
    const wrap = document.createElement('div');
    wrap.className = 'ss-search-suggest';
    wrap.setAttribute('role', 'listbox');
    wrap.style.display = 'none';

    let anchor = input.closest('[data-search-wrap]');
    if (!anchor) {
      anchor = document.createElement('div');
      anchor.setAttribute('data-search-wrap', '');
      anchor.style.position = 'relative';
      input.parentNode.insertBefore(anchor, input);
      anchor.appendChild(input);
    }
    anchor.appendChild(wrap);
    return wrap;
  }

  function renderResults(dropdown, data, input) {
    const { products = [], categories = [] } = data;

    if (!products.length && !categories.length) {
      dropdown.innerHTML = `<div class="ss-search-empty">No matches. Press Enter to search the full catalog.</div>`;
      dropdown.style.display = 'block';
      return;
    }

    let html = '';

    if (categories.length) {
      html += `<div class="ss-search-group-label">Categories</div>`;
      categories.forEach((c) => {
        html += `<a class="ss-search-row ss-search-row--cat" href="product.html?category=${c.id}">
          <i class="fa-solid fa-layer-group"></i>
          <span>${c.name}</span>
        </a>`;
      });
    }

    if (products.length) {
      html += `<div class="ss-search-group-label">Products</div>`;
      products.forEach((p) => {
        html += `<a class="ss-search-row" href="product-detail.html?id=${p.id}">
          <img src="${p.image || 'images/placeholder.png'}" alt="" onerror="this.src='images/placeholder.png'">
          <span class="ss-search-row__name">${p.name}</span>
          <span class="ss-search-row__price">${fmtPrice(p.price)}</span>
        </a>`;
      });
    }

    html += `<a class="ss-search-viewall" href="product.html?search=${encodeURIComponent(input.value.trim())}">
      See all results for "${input.value.trim()}" <i class="fa-solid fa-arrow-right"></i>
    </a>`;

    dropdown.innerHTML = html;
    dropdown.style.display = 'block';
  }

  function attach(input) {
    if (input.dataset.ssSearchBound) return;
    input.dataset.ssSearchBound = 'true';

    const dropdown = buildDropdown(input);

    const runSearch = debounce(async () => {
      const q = input.value.trim();
      if (q.length < MIN_CHARS) {
        dropdown.style.display = 'none';
        return;
      }
      try {
        const data = await SS_API.getProductSuggestions(q);
        renderResults(dropdown, data, input);
      } catch (e) {
        dropdown.style.display = 'none';
      }
    }, DEBOUNCE_MS);

    input.addEventListener('input', runSearch);
    input.addEventListener('focus', () => {
      if (input.value.trim().length >= MIN_CHARS) dropdown.style.display = 'block';
    });

    input.closest('form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (q) window.location.href = `product.html?search=${encodeURIComponent(q)}`;
    });

    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target) && e.target !== input) {
        dropdown.style.display = 'none';
      }
    });
  }

  function init() {
    document.querySelectorAll('[data-search-input]').forEach(attach);
  }

  // Header is injected dynamically by ui.js, so the input may not exist
  // yet at DOMContentLoaded — re-scan shortly after to catch it once
  // rendered.
  document.addEventListener('DOMContentLoaded', () => {
    init();
    setTimeout(init, 300);
    setTimeout(init, 1000);
  });
})();