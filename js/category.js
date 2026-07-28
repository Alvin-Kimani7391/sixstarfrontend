document.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(location.search);
  const slug = params.get("slug") || params.get("id") || params.get("categoryId");
  const titleEl = document.getElementById("categoryTitle");
  const crumbEl = document.getElementById("breadcrumb");
  const subcatGrid = document.getElementById("subcatGrid");
  const productGrid = document.getElementById("productGrid");

  console.log("category.html loaded — full URL:", location.href);
  console.log("Resolved slug/id param:", slug);

  if (!slug) {
    console.warn("No slug/id param found in URL — showing error instead of redirecting, so you can debug.");
    titleEl.textContent = "No category specified";
    if (crumbEl) crumbEl.innerHTML = `<a href="index.html">Home</a>`;
    ssHideLoader();
    return; // no more silent redirect — stay on the page
  }

  try {
    const { category, children, breadcrumb } = await SS_API.getCategoryBySlug(slug);

    document.title = `${category.name} | Six Star Suppliers`;
    titleEl.textContent = category.name;

    crumbEl.innerHTML =
      `<a href="index.html">Home</a>` +
      breadcrumb.map((c) => ` / <a href="category.html?slug=${encodeURIComponent(c.slug)}">${c.name}</a>`).join("");

    if (children.length > 0) {
      subcatGrid.style.display = "grid";
      productGrid.style.display = "none";
      subcatGrid.innerHTML = children
        .map(
          (c) => `
        <a class="cat-item" href="category.html?slug=${encodeURIComponent(c.slug)}">
          <div class="cat-thumb"><img src="${c.image || 'https://placehold.co/150/F1E4CE/1B1F23?text=' + encodeURIComponent(c.name)}" alt="${c.name}"></div>
          <span>${c.name}</span>
        </a>`
        )
        .join("");
    } else {
      subcatGrid.style.display = "none";
      productGrid.style.display = "grid";
      productGrid.innerHTML = ssSkeletonCards(8);

      const res = await SS_API.getProducts({ category: category._id });
      const products = res.products || res.data || res || [];

      if (!products.length) {
        productGrid.innerHTML = `<p class="form-hint">No products in this category yet.</p>`;
      } else {
        products.forEach((p) => { window.__ssProductCache[p.id] = p; });
        productGrid.innerHTML = products.map(ssProductCard).join("");
      }
    }
  } catch (err) {
    console.error("getCategoryBySlug failed for slug:", slug, err);
    titleEl.textContent = "Category not found";
  } finally {
    ssHideLoader();
  }
});