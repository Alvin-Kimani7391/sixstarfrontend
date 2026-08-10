/**
 * api/shop-detail.js  (Vercel Serverless Function)
 * -----------------------------------------------------------------------
 * Same pattern as api/product-detail.js, applied to shop storefronts.
 * Handles BOTH request shapes your site already uses:
 *   - /shop/:slug            (pretty URL, per your existing vercel.json rewrite)
 *   - /shop-detail.html?slug=... or ?id=...  (legacy/query-param form,
 *     matching ssGetSlugFromUrl() in shop-detail.js)
 *
 * Requires the same env vars as product-detail.js:
 *   RENDER_API_BASE = https://sixstarbackend.onrender.com/api
 *   SITE_URL         = https://www.sixstarsuppliers.com
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
  return fs.readFileSync(path.join(process.cwd(), 'shop-detail.html'), 'utf8');
}

// Pulls the slug out of either the rewritten :slug param (from /shop/:slug)
// or the legacy ?slug=/?id= query string.
function extractSlug(req) {
  return req.query.slug || req.query.id || null;
}

module.exports = async (req, res) => {
  const slug = extractSlug(req);
  let template;

  try {
    template = readTemplate();
  } catch (err) {
    res.status(500).send('Could not load page template');
    return;
  }

  if (!slug) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(template);
    return;
  }

  let shop = null;
  try {
    const r = await fetch(`${API_BASE}/shops/${encodeURIComponent(slug)}`);
    if (r.ok) {
      const data = await r.json();
      shop = data.shop || null;
    }
  } catch (err) {
    shop = null;
  }

  if (!shop) {
    const seo = [
      `<title>Shop not found — Six Star Suppliers</title>`,
      `<meta name="description" content="This shop may have been removed or suspended. Browse our full directory of verified shops.">`,
      `<meta name="robots" content="noindex,follow">`,
      `<link rel="canonical" href="${SITE_URL}/shop/${escapeHtml(slug)}">`,
    ].join('\n');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(404).send(template.replace(SEO_BLOCK_RE, seo));
    return;
  }

  const title = escapeHtml(`${shop.shopName} — Shop on Six Star Suppliers`);
  const rawDescription = shop.description
    || `Browse products from ${shop.shopName}, a verified seller on Six Star Suppliers. Secure payment and countrywide delivery, handled by Six Star.`;
  const description = escapeHtml(rawDescription.slice(0, 155));
  const image = shop.banner || shop.logo || `${SITE_URL}/images/og-default.jpg`;
  const canonical = `${SITE_URL}/shop/${shop.slug}`;

  const jsonLd = {
    '@context': 'https://schema.org/',
    '@type': 'Organization',
    name: shop.shopName,
    description: rawDescription,
    url: canonical,
    logo: shop.logo || undefined,
    image: shop.banner || shop.logo || undefined,
    ...(shop.ratingsCount ? {
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: shop.ratingsAverage,
        reviewCount: shop.ratingsCount,
      },
    } : {}),
  };

  const seo = [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}">`,
    `<link rel="canonical" href="${canonical}">`,
    `<meta property="og:type" content="website">`,
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