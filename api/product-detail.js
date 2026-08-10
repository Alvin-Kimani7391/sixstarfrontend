/**
 * api/product-detail.js  (Vercel Serverless Function)
 * -----------------------------------------------------------------------
 * Files under /api at your project root become serverless functions on
 * Vercel automatically — no framework needed for this to work on a plain
 * static deployment.
 *
 * A request to /product-detail.html?id=... gets rewritten (see
 * vercel.json) to this function instead of being served as a static
 * file. This function:
 *   1. Reads the real product-detail.html template (bundled alongside
 *      this function via vercel.json's `includeFiles`)
 *   2. Fetches that product from your Render API
 *   3. Injects a real <title>/<meta description>/OG/Twitter/JSON-LD block
 *      between the <!--SEO_HEAD--> markers
 *   4. Sends the result — your existing product-detail.js then runs
 *      client-side exactly as before for the interactive parts.
 *
 * Requires an environment variable in your Vercel project settings:
 *   RENDER_API_BASE = https://your-backend.onrender.com/api
 *   SITE_URL         = https://www.sixstarsuppliers.co.ke
 * -----------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const API_BASE = process.env.RENDER_API_BASE || 'https://sixstarbackend.onrender.com/api';
const SITE_URL = (process.env.SITE_URL || 'https://www.sixstarsuppliers.com').replace(/\/$/, '');

const SEO_BLOCK_RE = /<!--SEO_HEAD-->[\s\S]*?<!--\/SEO_HEAD-->/;

function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function readTemplate() {
  // process.cwd() at runtime is the project root Vercel deployed —
  // product-detail.html sits there alongside your other static pages.
  return fs.readFileSync(path.join(process.cwd(), 'product-detail.html'), 'utf8');
}

module.exports = async (req, res) => {
  const id = req.query.id;
  let template;

  try {
    template = readTemplate();
  } catch (err) {
    res.status(500).send('Could not load page template');
    return;
  }

  // No id in the URL — nothing to personalize, just serve the page as-is.
  if (!id) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(template);
    return;
  }

  let product = null;
  try {
    const r = await fetch(`${API_BASE}/products/${id}`);
    if (r.ok) {
      const data = await r.json();
      product = data.product || null;
    }
  } catch (err) {
    product = null; // Render API unreachable — fall through to not-found handling below
  }

  if (!product) {
    const seo = [
      `<title>Product not found — Six Star Suppliers</title>`,
      `<meta name="description" content="This product is no longer available. Browse our full catalog for similar items.">`,
      `<meta name="robots" content="noindex,follow">`,
      `<link rel="canonical" href="${SITE_URL}/product-detail.html?id=${escapeHtml(id)}">`,
    ].join('\n');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(404).send(template.replace(SEO_BLOCK_RE, seo));
    return;
  }

  const price = product.discountPercent
    ? Math.round(product.finalPrice * (1 - product.discountPercent / 100))
    : product.finalPrice;

  const title = escapeHtml(`${product.name} — Buy Online in Kenya | Six Star Suppliers`);
  const rawDescription = product.description || `Shop ${product.name} at Six Star Suppliers. Countrywide delivery, secure payment, 1-year warranty.`;
  const description = escapeHtml(rawDescription.slice(0, 155));
  const image = (product.images && product.images[0]) || `${SITE_URL}/images/og-default.jpg`;
  const canonical = `${SITE_URL}/product-detail.html?id=${product._id}`;

  const jsonLd = {
    '@context': 'https://schema.org/',
    '@type': 'Product',
    name: product.name,
    description: rawDescription,
    image: product.images,
    sku: String(product._id),
    offers: {
      '@type': 'Offer',
      url: canonical,
      priceCurrency: 'KES',
      price: price || 0,
      availability: product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    },
    ...(product.ratingsCount ? {
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: product.ratingsAverage,
        reviewCount: product.ratingsCount,
      },
    } : {}),
  };

  const seo = [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}">`,
    `<link rel="canonical" href="${canonical}">`,
    `<meta property="og:type" content="product">`,
    `<meta property="og:site_name" content="Six Star Suppliers">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:image" content="${image}">`,
    `<meta property="og:url" content="${canonical}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
    `<meta name="twitter:image" content="${image}">`,
    `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`,
  ].join('\n');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(template.replace(SEO_BLOCK_RE, seo));
};