/**
 * api/shop-detail.js  (Vercel Serverless Function)
 * -----------------------------------------------------------------------
 * Changes from before:
 *  - Explicit no-store cache headers on every response (defense in depth,
 *    regardless of what's happening upstream in Cloudflare/Vercel).
 *  - Injects REAL visible text (shop name, category, description, rating)
 *    into the page body via <!--SSR_SHOP_INTRO--> — not just <head> meta —
 *    so a crawler that never runs shop-detail.js still sees genuine,
 *    unique content that matches the title/meta tags.
 *  - Hands the already-fetched shop object to the client via
 *    <!--SSR_SHOP_DATA--> so shop-detail.js can paint instantly instead of
 *    firing a second request at the (sometimes slow/cold) Render API.
 *  - The "not found" branch now also flips which block is visible
 *    server-side, so a genuinely missing shop actually LOOKS like a 404
 *    even before any JS runs (matches its already-correct 404 status).
 * -----------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const API_BASE = process.env.RENDER_API_BASE || 'https://sixstarbackend.onrender.com/api';
const SITE_URL = (process.env.SITE_URL || 'https://www.sixstarsuppliers.com').replace(/\/$/, '');

const SEO_BLOCK_RE = /<!--SEO_HEAD-->[\s\S]*?<!--\/SEO_HEAD-->/;
const INTRO_BLOCK_RE = /<!--SSR_SHOP_INTRO-->[\s\S]*?<!--\/SSR_SHOP_INTRO-->/;
const DATA_BLOCK_RE = /<!--SSR_SHOP_DATA-->[\s\S]*?<!--\/SSR_SHOP_DATA-->/;

function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

function readTemplate() {
  return fs.readFileSync(path.join(process.cwd(), 'templates', 'shop-detail.html'), 'utf8');
}

function extractSlug(req) {
  return req.query.slug || req.query.id || null;
}

// Applies every substitution in one place so no branch can ever leave a
// literal placeholder token in the HTML sent to the browser.
function render(template, { seo, intro, dataScript, detailDisplay, notFoundDisplay }) {
  let html = template.replace(SEO_BLOCK_RE, seo);
  html = html.replace(INTRO_BLOCK_RE, intro);
  html = html.replace(DATA_BLOCK_RE, dataScript || '');
  html = html.replace('__DETAIL_DISPLAY__', detailDisplay);
  html = html.replace('__NOTFOUND_DISPLAY__', notFoundDisplay);
  return html;
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

  noStore(res);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!slug) {
    const seo = [
      `<title>Shops — Six Star Suppliers</title>`,
      `<meta name="description" content="Browse verified shops on Six Star Suppliers.">`,
      `<meta name="robots" content="noindex,follow">`,
      `<link rel="canonical" href="${SITE_URL}/shop.html">`,
    ].join('\n');
    const html = render(template, {
      seo,
      intro: `<h1>No shop specified</h1><p><a href="/shop.html">Browse all shops</a></p>`,
      detailDisplay: 'none',
      notFoundDisplay: 'block',
    });
    res.status(404).send(html);
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
    const html = render(template, {
      seo,
      intro: `
        <h1>Shop not found</h1>
        <p>This shop may have been removed or suspended, or the link is incorrect.</p>
      `,
      detailDisplay: 'none',
      notFoundDisplay: 'block',
    });
    res.status(404).send(html);
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

  // Real, visible text — matches the title/meta above, and is there even
  // if shop-detail.js never runs or runs before the Render API answers.
  const intro = `
    <h1>${escapeHtml(shop.shopName)}</h1>
    ${shop.businessCategory ? `<p class="ssr-shop-category">${escapeHtml(shop.businessCategory)}</p>` : ''}
    <p>${escapeHtml(rawDescription)}</p>
    ${shop.ratingsCount ? `<p>${Number(shop.ratingsAverage || 0).toFixed(1)} out of 5 stars from ${shop.ratingsCount} review${shop.ratingsCount === 1 ? '' : 's'}</p>` : ''}
  `;

  // Handed straight to the client so shop-detail.js can paint immediately
  // instead of firing a second, possibly-slow request at the same API.
  const dataScript = `<script id="ssrShopData" type="application/json">${JSON.stringify(shop).replace(/</g, '\\u003c')}</script>`;

  const html = render(template, {
    seo,
    intro,
    dataScript,
    detailDisplay: '',
    notFoundDisplay: 'none',
  });

  res.status(200).send(html);
};