# Six Star Suppliers — Admin Dashboard

Plain HTML/CSS/JS admin panel (no framework, no build step) that covers full
control of the marketplace: pricing approval, product editing, categories,
ads, M-Pesa payment verification, order fulfillment, and suspending any
wholesaler/retailer/buyer account.

## 1. Setup

1. Open `js/config.js` and point it at your backend:
   ```js
   window.API_BASE_URL = "https://your-backend.onrender.com/api";
   ```
2. Serve the `site/` folder with any static server (it uses ES modules, so it
   must be served over http(s), not opened directly as a `file://` URL).
   Simplest local option:
   ```bash
   cd site
   npx serve .
   ```
   Or deploy the whole folder to Vercel/Netlify as a static site.
3. Open `admin.html` and log in with an account that has `role: "admin"`.

   **You'll need to create that admin account directly in MongoDB the first
   time** — the backend's public `/api/auth/register` deliberately blocks
   creating admin accounts (see `authController.js`). Easiest way: register a
   normal buyer account, then in MongoDB Atlas manually edit that document's
   `role` field from `"buyer"` to `"admin"` (Atlas discriminator collections
   store everything in one `users` collection, so this is a one-field edit).

## 2. What this dashboard covers (all wired to real backend routes)

| Tab | What it does | Backend routes used |
|---|---|---|
| **Overview** | Live counts: pending products, pending payments, total products, users by role | `/admin/products/pending`, `/admin/orders/pending-payment`, `/admin/products`, `/admin/users` |
| **Pending Products** | Approve (set final price + discount + hot-deal flag) or reject (with reason) products submitted by sellers | `PATCH /admin/products/:id/approve`, `PATCH /admin/products/:id/reject` |
| **All Products** | Search/filter by status/category, **fully edit any field** (name, description, category, stock, both prices, discount, hot-deal, replace images), suspend, reactivate, permanently delete | `GET /admin/products`, `PATCH /admin/products/:id`, `PATCH /admin/products/:id/suspend`, `PATCH /admin/products/:id/reactivate`, `DELETE /admin/products/:id` |
| **Categories** | Create, edit, activate/deactivate | `GET/POST /categories`, `PUT /categories/:id`, plus `GET /admin/categories` for the full list including inactive ones |
| **Ads** | Create/edit/delete banners for any placement, toggle active, see click counts | `GET /admin/ads`, `POST/PUT/DELETE /ads` |
| **Orders & Payments** | Verify pasted M-Pesa messages (confirm/reject), or browse all orders and update fulfillment status | `GET /admin/orders/pending-payment`, `PATCH /admin/orders/:id/verify-payment`, `GET /admin/orders`, `PATCH /orders/:id/status` |
| **Users** | Filter by role, **suspend or reactivate any wholesaler, retailer, or buyer** with one toggle | `GET /admin/users`, `PATCH /admin/users/:id/status` |

## 3. Backend changes made to support this

Your backend previously only let admin set price/discount/hot-deal and
suspend a product — there was no way to edit a product's name, description,
stock, or images, and no endpoint to list *all* products or *all* orders for
a dashboard table. These were added:

- `GET /api/admin/products` — full product list, filterable by status/search/category
- `PATCH /api/admin/products/:id` — edit any field, optionally replace images
- `PATCH /api/admin/products/:id/reactivate` — undo a suspension
- `DELETE /api/admin/products/:id` — permanently remove a product
- `GET /api/admin/orders` — full order list, filterable
- `GET /api/admin/categories` — full category list including inactive ones (the public endpoint only returns active categories)

Redeploy your backend with these changes before using the dashboard.

## 4. Notes

- Every write action (approve, reject, edit, suspend, delete, toggle) shows a
  toast confirmation and refreshes the relevant table — nothing silently fails.
- The image-upload endpoints (product edit, category, ads) always submit as
  `multipart/form-data`, matching your backend's Multer/Cloudinary middleware.
- Admin accounts can't be suspended from the Users tab (the toggle is
  disabled for `role: admin` rows) to prevent accidentally locking yourself out.
- This dashboard is intentionally separate from the buyer-facing storefront
  pages (home, products, cart, etc.) — it's meant to be a private URL you
  don't link from the public site.
