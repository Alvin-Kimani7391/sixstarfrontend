# Six Star Suppliers — storefront frontend

Plain HTML/CSS/JS (no build step) built to sit on Vercel and talk to your
Render backend. Buyer-facing pages only, per the current scope.

## 1. Point it at your backend

Open `js/config.js` and set:

```js
API_BASE: "https://YOUR-BACKEND.onrender.com/api"
```

Your backend must send `Access-Control-Allow-Origin` (your Vercel domain) and
`Access-Control-Allow-Credentials: true` on every response, since the
frontend calls `fetch(..., { credentials: "include" })` so the login cookie
is sent with each request.

## 2. Pages

| File | What it does |
|---|---|
| `index.html` | Home: hero, homepage_hero ad, categories, hot deals, new arrivals, catalog preview |
| `product.html` | Full catalog with category/price/hotDeals filters, search, sort, pagination |
| `product-detail.html?id=...` | Single product, gallery, add to cart, reviews + review form |
| `cart.html` | Cart + checkout (shipping address + M-Pesa message) → `POST /api/orders` |
| `order-confirmation.html` | Shown right after a successful order |
| `login.html` / `register.html` | Auth, register supports buyer/retailer/wholesaler roles |
| `track-order.html` | Look up an order by reference and see a status timeline |
| `about.html` / `contact.html` | Static content + WhatsApp contact |

## 3. Shared JS (`/js`)

- `config.js` — the one file to edit per environment
- `api.js` — one function per backend route
- `cart.js` — localStorage cart, shared across pages
- `auth.js` — a light client-side copy of the logged-in user for UI only (the
  cookie the backend sets is the real auth)
- `ui.js` — injects the header/footer/mobile drawer, product card markup,
  category grid, hero ad, toast messages

## 4. Two assumed routes

Your route table didn't include a "get one product" or "get one order"
endpoint, so `api.js` calls `GET /api/products/:id` and `GET /api/orders/:id`
(both marked `(assumed route)` in that file). If your backend names these
differently, update those two lines — everything else already points at the
routes you listed.

## 5. Deploy

Push this folder to a Git repo and import it into Vercel as a static site
(no framework/build command needed) — or run `vercel` from inside this
folder. Update `API_BASE` before you deploy.

## 6. Not built yet (by design, per current scope)

Seller dashboard (add/manage products as wholesaler/retailer) and the admin
panel (approve products, verify M-Pesa payments, manage ads/categories)
weren't part of this pass — say the word when you're ready and I'll build
those against the same `js/api.js` / design system.
