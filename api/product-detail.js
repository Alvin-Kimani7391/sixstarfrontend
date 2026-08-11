/**
 * api/product-detail.js  (Vercel Serverless Function)
 * -----------------------------------------------------------------------
 * Reads the template from templates/product-detail.html (NOT the project
 * root) so no static file shadows the /product-detail.html rewrite.
 * Matches vercel.json's includeFiles: "templates/product-detail.html".
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
  return fs.readFileSync(path.join(process.cwd(), 'templates', 'product-detail.html'), 'utf8');
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
    product = null;
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
    brand: product.attributes?.find((a) => a.attribute?.name?.toLowerCase() === 'brand')
      ? { '@type': 'Brand', name: String(product.attributes.find((a) => a.attribute?.name?.toLowerCase() === 'brand').value) }
      : undefined,
    offers: {
      '@type': 'Offer',
      url: canonical,
      priceCurrency: 'KES',
      price: price || 0,
      availability: product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      seller: {
        '@type': 'Organization',
        name: 'Six Star Suppliers',
      },
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