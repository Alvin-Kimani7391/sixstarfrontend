/**
 * api/product-detail.js  (Vercel Serverless Function)
 * -----------------------------------------------------------------------
 * UPDATED to fix 5 Search Console structured-data warnings:
 *
 *   Merchant listings issues:
 *     - Missing field "hasMerchantReturnPolicy" (in "offers")  -> fixed
 *     - No global identifier provided (e.g., gtin, brand)      -> brand
 *       now included when a product has one; gtin/mpn genuinely
 *       don't exist for most of your catalog, so this stays a
 *       harmless permanent suggestion where absent — do not
 *       fabricate identifiers you don't have.
 *     - Missing field "shippingDetails" (in "offers")           -> fixed
 *
 *   Product snippets issues:
 *     - Missing field "aggregateRating"  -> already conditional;
 *       only ever fires on products with zero reviews, which is
 *       correct/expected, not a bug.
 *     - Missing field "review"           -> NOW fetches and includes
 *       real reviews when they exist, instead of omitting the field
 *       entirely.
 *
 * Reads the template from templates/product-detail.html (unchanged from
 * before — this update only touches the JSON-LD construction below).
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

  if (!id) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(template);
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

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(template.replace(SEO_BLOCK_RE, seo));
};