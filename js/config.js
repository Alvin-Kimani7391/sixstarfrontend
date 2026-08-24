/* ============================================================
   CONFIG — the only file you should need to edit when you deploy.
   ============================================================ */
window.SS_CONFIG = {
  // TODO: replace with your real Render backend URL (no trailing slash)
  API_BASE: "https://sixstarbackend.onrender.com/api",

  // From Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID.
  // Safe to expose publicly — it identifies your app, it isn't a secret.
  // TODO: replace with your real Google Client ID
  GOOGLE_CLIENT_ID: "921180599621-sfvughebvaqkmao293hsufrnn45caha1.apps.googleusercontent.com",



  WHATSAPP_NUMBER: "254794327798",
  PHONE_1: "+254 115 913 507",
  PHONE_2: "+254 794 327 798",
  EMAIL: "info@sixstarsuppliers.com",

  SOCIALS: {
    facebook: "https://www.facebook.com/share/1GkdidaAiP/",
    instagram: "https://www.instagram.com/sixstarsuppliers",
    tiktok: "https://vm.tiktok.com/ZMHTmxytY9hkR-cyBwf/",
    x: "https://x.com/sixstarsuppliers"
  },

  PRODUCTS_PER_PAGE: 24,

  // Fallback categories shown while /api/categories loads (or if it fails)
  FALLBACK_CATEGORIES: [
    { name: "Household", slug: "household", image: "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=200" },
    { name: "Shoes", slug: "shoes", image: "https://images.unsplash.com/photo-1549298916-b41d501d3772?w=200" },
    { name: "Hand Bags", slug: "bag", image: "https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=200" },
    { name: "Cosmetics", slug: "cosmetics", image: "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=200" },
    { name: "Electronics", slug: "system", image: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=200" },
    { name: "BT Speakers", slug: "bt", image: "https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=200" },
    { name: "EarPods", slug: "airpods", image: "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=200" },
    { name: "Headphones", slug: "headphones", image: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=200" }
  ]
};