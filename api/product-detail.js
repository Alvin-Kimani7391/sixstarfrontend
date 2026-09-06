/**
 * api/product-detail.js  (Vercel Serverless Function)
 * -----------------------------------------------------------------------
 * Same fixes as api/product-detail.js's original JSON-LD update, PLUS the
 * SSR-body fix already applied to api/shop-detail.js:
 *  - Explicit no-store cache headers on every response.
 *  - Injects REAL visible text (name, price, brand, description, rating)
 *    into the page body via <!--SSR_PRODUCT_INTRO--> — not just <head>
 *    meta — so a crawler that never runs product-detail.js still sees
 *    genuine, unique content that matches the title/meta tags.
 *  - Hands the already-fetched product object to the client via
 *    <!--SSR_PRODUCT_DATA--> so product-detail.js can paint instantly
 *    instead of firing a first request at the (sometimes slow/cold)
 *    Render API.
 *  - The "not found" / "no id" branches now also flip which block is
 *    visible server-side, so a genuinely missing product actually LOOKS
 *    like a 404 even before any JS runs (matches its already-correct 404
 *    status) — fixes the soft-404 Search Console flagged.
 *
 * All existing structured-data logic (brand, return policy, shipping
 * details, reviews) is unchanged.
 * -----------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const API_BASE = process.env.RENDER_API_BASE || 'https://sixstarbackend.onrender.com/api';
const SITE_URL = (process.env.SITE_URL || 'https://www.sixstarsuppliers.com').replace(/\/$/, '');

const SEO_BLOCK_RE = /<!--SEO_HEAD-->[\s\S]*?<!--\/SEO_HEAD-->/;
const INTRO_BLOCK_RE = /<!--SSR_PRODUCT_INTRO-->[\s\S]*?<!--\/SSR_PRODUCT_INTRO-->/;
const DATA_BLOCK_RE = /<!--SSR_PRODUCT_DATA-->[\s\S]*?<!--\/SSR_PRODUCT_DATA-->/;

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

// Plain "KES 1,234" formatting for the server-rendered intro text only.
// This is just crawler/no-JS fallback text — the real, JS-rendered price
// still goes through your existing ssFmtPrice() in ui.js. If that
// function formats KES differently, tweak this to match (cosmetic only,
// doesn't affect any functionality).
function fmtPrice(amount) {
  const n = Math.round(Number(amount) || 0);
  return `KES ${n.toLocaleString('en-US')}`;
}

function readTemplate() {
  return fs.readFileSync(path.join(process.cwd(), 'templates', 'product-detail.html'), 'utf8');
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

// Pulls a Brand-like attribute value off a populated product, same
// matching logic as the Merchant Center feed's findBrand() — kept
// consistent so the on-page structured data and the feed never disagree
// with each other about a product's brand.
function findBrand(product) {
  const attrs = Array.isArray(product.attributes) ? product.attributes : [];
  const match = attrs.find((a) => {
    const name = a.attribute && a.attribute.name ? String(a.attribute.name).toLowerCase() : '';
    return name === 'brand' || name === 'manufacturer';
  });
  return match ? String(match.value) : null;
}

// Your published return policy (matches the "Buyer Protections & Rights"
// accordion card in about.html — 7-day window). Update this in ONE place
// if that policy ever changes, rather than per-product.
function buildReturnPolicy() {
  return {
    '@type': 'MerchantReturnPolicy',
    applicableCountry: 'KE',
    returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
    merchantReturnDays: 7,
    returnMethod: 'https://schema.org/ReturnByMail',
    returnFees: 'https://schema.org/FreeReturn',
  };
}

// Generic shipping declaration matching your countrywide-delivery
// messaging. Deliberately account-level/generic rather than per-product —
// your actual per-product delivery terms (simple vs heavy wholesale, free
// vs fixed vs quantity-based vs negotiated) are already handled at
// checkout; this block exists purely to satisfy structured-data
// requirements with an honest, non-misleading baseline claim ("ships
// within Kenya, standard handling/transit times"), not to replicate your
// full checkout pricing logic in JSON-LD.
function buildShippingDetails() {
  return {
    '@type': 'OfferShippingDetails',
    shippingDestination: {
      '@type': 'DefinedRegion',
      addressCountry: 'KE',
    },
    deliveryTime: {
      '@type': 'ShippingDeliveryTime',
      handlingTime: {
        '@type': 'QuantitativeValue',
        minValue: 1,
        maxValue: 2,
        unitCode: 'DAY',
      },
      transitTime: {
        '@type': 'QuantitativeValue',
        minValue: 1,
        maxValue: 5,
        unitCode: 'DAY',
      },
    },
  };
}

// Maps whatever your reviewController actually returns into schema.org
// Review objects. Field names guessed from your other controllers'
// conventions (rating/comment/buyer.name/createdAt) — adjust the
// r.buyer?.name / r.comment lookups below if your real review shape
// differs.
function buildReviews(reviews) {
  if (!Array.isArray(reviews) || !reviews.length) return null;
  return reviews.slice(0, 20).map((r) => ({
    '@type': 'Review',
    reviewRating: {
      '@type': 'Rating',
      ratingValue: r.rating,
      bestRating: 5,
      worstRating: 1,
    },
    author: {
      '@type': 'Person',
      name: r.buyer?.name || r.userName || r.name || 'Verified buyer',
    },
    reviewBody: r.comment || undefined,
    datePublished: r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : undefined,
  }));
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

  noStore(res);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!id) {
    const seo = [
      `<title>Products — Six Star Suppliers</title>`,
      `<meta name="description" content="Shop quality products at Six Star Suppliers.">`,
      `<meta name="robots" content="noindex,follow">`,
      `<link rel="canonical" href="${SITE_URL}/product.html">`,
    ].join('\n');
    const html = render(template, {
      seo,
      intro: `<h1>No product specified</h1><p><a href="/product.html">Browse all products</a></p>`,
      detailDisplay: 'none',
      notFoundDisplay: 'block',
    });
    res.status(404).send(html);
    return;
  }

  let product = null;
  let reviews = [];

  try {
    const [productRes, reviewsRes] = await Promise.all([
      fetch(`${API_BASE}/products/${id}`),
      fetch(`${API_BASE}/products/${id}/reviews`).catch(() => null),
    ]);

    if (productRes.ok) {
      const data = await productRes.json();
      product = data.product || null;
    }
    if (reviewsRes && reviewsRes.ok) {
      const data = await reviewsRes.json();
      reviews = data.reviews || data.data || (Array.isArray(data) ? data : []);
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
    const html = render(template, {
      seo,
      intro: `
        <h1>Product not found</h1>
        <p>This product may have been removed or is no longer available, or the link is incorrect.</p>
      `,
      detailDisplay: 'none',
      notFoundDisplay: 'block',
    });
    res.status(404).send(html);
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

  const brand = findBrand(product);
  const reviewObjects = buildReviews(reviews);

  const jsonLd = {
    '@context': 'https://schema.org/',
    '@type': 'Product',
    name: product.name,
    description: rawDescription,
    image: product.images,
    sku: String(product._id),
    ...(brand ? { brand: { '@type': 'Brand', name: brand } } : {}),
    offers: {
      '@type': 'Offer',
      url: canonical,
      priceCurrency: 'KES',
      price: price || 0,
      availability: product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
      seller: {
        '@type': 'Organization',
        name: 'Six Star Suppliers',
      },
      hasMerchantReturnPolicy: buildReturnPolicy(),
      shippingDetails: buildShippingDetails(),
    },
    ...(product.ratingsCount ? {
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: product.ratingsAverage,
        reviewCount: product.ratingsCount,
      },
    } : {}),
    ...(reviewObjects ? { review: reviewObjects } : {}),
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

  // Real, visible text — matches the title/meta above, and is there even
  // if product-detail.js never runs or runs before the Render API answers.
  const intro = `
    <h1>${escapeHtml(product.name)}</h1>
    <p class="ssr-product-price">${fmtPrice(price)}</p>
    ${brand ? `<p class="ssr-product-brand">Brand: ${escapeHtml(brand)}</p>` : ''}
    <p>${escapeHtml(rawDescription)}</p>
    ${product.ratingsCount ? `<p>${Number(product.ratingsAverage || 0).toFixed(1)} out of 5 stars from ${product.ratingsCount} review${product.ratingsCount === 1 ? '' : 's'}</p>` : ''}
  `;

  // Handed straight to the client so product-detail.js can paint
  // immediately instead of firing a first, possibly-slow request at the
  // same API.
  const dataScript = `<script id="ssrProductData" type="application/json">${JSON.stringify(product).replace(/</g, '\\u003c')}</script>`;

  const html = render(template, {
    seo,
    intro,
    dataScript,
    detailDisplay: '',
    notFoundDisplay: 'none',
  });

  res.status(200).send(html);
};