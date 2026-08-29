/* ============================================================
   SIX STAR SUPPLIERS — category.js
   Powers category.html: a Jumia-style "Shop by Category" browser.

     - Left rail: top-level (Parent) categories. Sticky, with its
       own independent scroll so a long list never pushes the page
       around.
     - Right panel: one card per Category (2nd tree level) under the
       active parent. Each card has a "See All" link and a tile grid
       of that category's Sub-categories (3rd / leaf level), each
       with an image.
     - Every "See All" / tile click routes into category-explore.html
       pre-filtered via ?category=<id> — the exact same convention
       ssRenderMegaMenu() / ssRenderDrawerCategories() already use
       in ui.js, so category-explore.js needs zero changes.

   Depends on window.SS_API (js/api.js) and, optionally, the small
   helpers already defined in js/ui.js (ssCldTransform, ssEscapeHtml,
   ssFindCategoryPath) — all three are used defensively so this file
   still works even if it's ever loaded before ui.js for some reason.
   ============================================================ */

(function () {
  "use strict";

  const state = {
    tree: [],
    activeId: null,
  };

  const els = {};

  function catId(node) {
    return (node && (node._id || node.id)) || "";
  }

  function esc(str) {
    return (typeof ssEscapeHtml === "function") ? ssEscapeHtml(str) : String(str == null ? "" : str);
  }

  function cxImg(node) {
    const raw = node.image || ("https://placehold.co/240/F3F4F8/15161A?text=" + encodeURIComponent(node.name || "Category"));
    return (typeof ssCldTransform === "function")
      ? ssCldTransform(raw, "f_auto,q_auto:good,w_220,h_220,c_fill,dpr_auto")
      : raw;
  }

  function exploreLink(id) {
    return "/category-explore.html?category=" + encodeURIComponent(id);
  }

  /* ---------- skeleton / error / empty states ---------- */
  function renderRailSkeleton() {
    els.rail.innerHTML = Array.from({ length: 8 }).map(() =>
      `<div class="cx-rail__skel skel-shimmer"></div>`
    ).join("");
  }

  function renderPanelSkeleton() {
    els.panel.innerHTML = Array.from({ length: 2 }).map(() => `
      <div class="cx-card">
        <div class="cx-card__head">
          <div class="cx-skel-line skel-shimmer" style="width:120px;height:14px;margin:0;"></div>
        </div>
        <div class="cx-card__body">
          <div class="cx-grid">
            ${Array.from({ length: 6 }).map(() => `
              <div class="cx-tile">
                <div class="cx-tile__thumb skel-shimmer"></div>
                <div class="cx-skel-line skel-shimmer" style="width:70%;height:10px;"></div>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    `).join("");
  }

  function renderError() {
    els.rail.innerHTML = "";
    els.panel.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <h3>Couldn't load categories</h3>
        <p>Check your connection and try again.</p>
        <button type="button" class="btn btn-dark btn-sm" id="cxRetryBtn" style="margin-top:14px;">
          <i class="fa-solid fa-rotate-right"></i> Retry
        </button>
      </div>`;
    if (els.count) els.count.textContent = "";
    const retry = document.getElementById("cxRetryBtn");
    if (retry) retry.addEventListener("click", init);
  }

  function renderEmptyTree() {
    els.rail.innerHTML = "";
    els.panel.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-layer-group"></i>
        <h3>No categories yet</h3>
        <p>Check back soon — we're adding categories all the time.</p>
      </div>`;
    if (els.count) els.count.textContent = "";
  }

  /* ---------- rail ---------- */
  function renderRail() {
    els.rail.innerHTML = state.tree.map(node => {
      const id = catId(node);
      const active = id === state.activeId;
      return `<a href="?parent=${encodeURIComponent(id)}" class="cx-rail__item ${active ? "active" : ""}" data-id="${id}">${esc(node.name)}</a>`;
    }).join("");

    els.rail.querySelectorAll(".cx-rail__item").forEach(a => {
      a.addEventListener("click", (e) => {
        // Plain left-click: switch in place. Middle-click / cmd-click / etc.
        // is left alone so the browser can still open a new tab at
        // category.html?parent=ID (init() below reads that param too).
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        const id = a.dataset.id;
        if (id === state.activeId) return;
        state.activeId = id;
        try { history.replaceState(null, "", "?parent=" + encodeURIComponent(id)); } catch (_) { /* no-op */ }
        renderRailActiveState();
        renderPanel();
        els.panel.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function renderRailActiveState() {
    els.rail.querySelectorAll(".cx-rail__item").forEach(a => {
      a.classList.toggle("active", a.dataset.id === state.activeId);
    });
  }

  /* ---------- panel ---------- */
  function renderPanel() {
    const parent = state.tree.find(n => catId(n) === state.activeId);
    if (!parent) { renderEmptyTree(); return; }

    updateBreadcrumb(parent);

    const cats = parent.children || [];

    if (!cats.length) {
      els.panel.innerHTML = `
        <div class="cx-card">
          <div class="cx-card__empty">
            <i class="fa-solid fa-box-open" style="font-size:1.8rem;color:var(--brand);margin-bottom:10px;display:block;"></i>
            <p style="color:var(--ink-soft);font-size:.88rem;margin-bottom:14px;">No sub-categories under ${esc(parent.name)} yet.</p>
            <a href="${exploreLink(catId(parent))}" class="btn btn-dark btn-sm">
              <i class="fa-solid fa-bag-shopping"></i> Browse all ${esc(parent.name)}
            </a>
          </div>
        </div>`;
      if (els.count) els.count.textContent = "";
      return;
    }

    const totalSub = cats.reduce((sum, c) => sum + ((c.children || []).length), 0);
    if (els.count) {
      els.count.textContent = `${cats.length} categor${cats.length === 1 ? "y" : "ies"} · ${totalSub} sub-categor${totalSub === 1 ? "y" : "ies"}`;
    }

    els.panel.innerHTML = cats.map(cat => {
      const leaves = cat.children || [];
      const head = `
        <div class="cx-card__head">
          <h2>${esc(cat.name)}</h2>
          <a class="cx-card__see" href="${exploreLink(catId(cat))}">See All <i class="fa-solid fa-chevron-right"></i></a>
        </div>`;

      if (!leaves.length) {
        return `
          <div class="cx-card">
            ${head}
            <div class="cx-card__empty">
              <a href="${exploreLink(catId(cat))}" class="btn btn-outline btn-sm">
                <i class="fa-solid fa-bag-shopping"></i> Browse all ${esc(cat.name)}
              </a>
            </div>
          </div>`;
      }

      const tiles = leaves.map(leaf => `
        <a class="cx-tile" href="${exploreLink(catId(leaf))}">
          <span class="cx-tile__thumb"><img src="${cxImg(leaf)}" alt="${esc(leaf.name)}" loading="lazy"></span>
          <span>${esc(leaf.name)}</span>
        </a>`).join("");

      return `
        <div class="cx-card">
          ${head}
          <div class="cx-card__body">
            <div class="cx-grid">${tiles}</div>
          </div>
        </div>`;
    }).join("");
  }

  function updateBreadcrumb(parent) {
    if (!els.breadcrumb) return;
    els.breadcrumb.innerHTML = `
      <a href="/index.html">Home</a>
      <i class="fa-solid fa-chevron-right"></i>
      <a href="/category.html">Shop by Category</a>
      <i class="fa-solid fa-chevron-right"></i>
      <strong>${esc(parent.name)}</strong>`;
  }

  /* ---------- init ---------- */
  async function init() {
    els.rail = document.getElementById("cxRail");
    els.panel = document.getElementById("cxPanel");
    els.breadcrumb = document.getElementById("cxBreadcrumb");
    els.count = document.getElementById("cxCount");
    if (!els.rail || !els.panel) return;

    renderRailSkeleton();
    renderPanelSkeleton();

    let data;
    try {
      data = await SS_API.getCategoryTree();
    } catch (_) {
      renderError();
      return;
    }

    state.tree = Array.isArray(data) ? data : (data.categories || data.tree || []);
    if (!state.tree.length) { renderEmptyTree(); return; }

    // Deep-link support: /category.html?parent=<id> (top-level) or
    // ?category=<id> (any level — we walk up to its top-level ancestor
    // via ssFindCategoryPath, same helper ui.js's filter cascade uses).
    const params = new URLSearchParams(location.search);
    const wantId = params.get("parent") || params.get("category");
    let initialParent = state.tree[0];

    if (wantId) {
      const direct = state.tree.find(n => catId(n) === wantId);
      if (direct) {
        initialParent = direct;
      } else if (typeof ssFindCategoryPath === "function") {
        const path = ssFindCategoryPath(state.tree, wantId);
        if (path && path.length) initialParent = path[0];
      }
    }

    state.activeId = catId(initialParent);
    renderRail();
    renderPanel();
  }

  document.addEventListener("DOMContentLoaded", init);
})();