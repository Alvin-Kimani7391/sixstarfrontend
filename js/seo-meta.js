/**
 * seo-meta.js
 * -----------------------------------------------------------------------
 * A small helper (window.SS_SEO) for pages that are NOT server-rendered
 * (product.html listing/filter pages, shop-detail.html). It updates the
 * document's <title>, <meta name="description">, canonical link, and
 * injects JSON-LD once your page's own JS has fetched its data.
 *
 * This is weaker than true server-side rendering (see
 * render-product.route.js for the stronger version used on
 * product-detail.html) because social-media link-preview bots won't see
 * it — but Googlebot does execute JS and will pick these up, which
 * matters a lot for category/search listing pages and shop pages.
 *
 * Include AFTER config.js, near the top of your other page scripts:
 *   <script src="js/seo-meta.js"></script>
 *
 * Then, once your page has its data, call e.g.:
 *   SS_SEO.setMeta({
 *     title: `${category.name} — Shop Online | Six Star Suppliers`,
 *     description: `Browse ${category.name} products...`,
 *     canonical: location.href,
 *   });
 * -----------------------------------------------------------------------
 */
(function (window, document) {
  function upsertMeta(attr, key, content) {
    let el = document.querySelector(`meta[${attr}="${key}"]`);
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute(attr, key);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  }

  function upsertCanonical(href) {
    let el = document.querySelector('link[rel="canonical"]');
    if (!el) {
      el = document.createElement('link');
      el.setAttribute('rel', 'canonical');
      document.head.appendChild(el);
    }
    el.setAttribute('href', href);
  }

  function setJsonLd(id, data) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('script');
      el.type = 'application/ld+json';
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = JSON.stringify(data);
  }

  function setMeta({ title, description, canonical, image, type = 'website', robots }) {
    if (title) document.title = title;
    if (description) {
      upsertMeta('name', 'description', description);
      upsertMeta('property', 'og:description', description);
    }
    if (canonical) {
      upsertCanonical(canonical);
      upsertMeta('property', 'og:url', canonical);
    }
    if (title) upsertMeta('property', 'og:title', title);
    upsertMeta('property', 'og:type', type);
    if (image) upsertMeta('property', 'og:image', image);
    if (robots) upsertMeta('name', 'robots', robots);
  }

  // Convenience: builds an ItemList JSON-LD block for a product grid
  // (product.html listing pages), which helps Google understand the page
  // is a catalog listing and can surface rich results for it.
  function setItemListJsonLd(products, baseUrl) {
    setJsonLd('ss-itemlist-jsonld', {
      '@context': 'https://schema.org/',
      '@type': 'ItemList',
      itemListElement: products.map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${baseUrl}/product-detail.html?id=${p.id || p._id}`,
        name: p.name,
      })),
    });
  }

  // Convenience: BreadcrumbList JSON-LD, e.g. Home > Electronics > Phones
  function setBreadcrumbJsonLd(items) {
    setJsonLd('ss-breadcrumb-jsonld', {
      '@context': 'https://schema.org/',
      '@type': 'BreadcrumbList',
      itemListElement: items.map((it, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: it.name,
        item: it.url,
      })),
    });
  }

  window.SS_SEO = { setMeta, setJsonLd, setItemListJsonLd, setBreadcrumbJsonLd };
})(window, document);