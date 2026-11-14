# Sitha Fashions

An online clothing store: a server-rendered customer storefront plus a separate admin panel, built with Express and EJS on a SQLite database.

The storefront covers the full shopping path — browse by category, product detail with sizes, cart, wishlist, saved addresses, coupons, checkout, online payment, order history, returns and reviews. The admin panel runs the shop: products and stock, orders and their status history, customers, staff accounts, coupons, review moderation, returns, analytics and store settings.

## Stack

| Layer | Choice |
|---|---|
| Server | Node.js + Express 4 |
| Views | EJS templates (server-rendered, no SPA build step) |
| Database | SQLite via `better-sqlite3` (WAL mode, foreign keys on) |
| Auth | JWT in an httpOnly cookie, bcrypt password hashes |
| Payments | Razorpay (order creation + signature verification) |
| Email | Nodemailer (password reset, order updates) |
| Uploads | Multer (product images) |
| Tests | Node's built-in test runner (`node --test`) |

## Run it

```bash
npm install
cp .env.example .env      # then fill in JWT_SECRET and any keys you need
npm start                 # http://localhost:3000
```

`JWT_SECRET` is required — the auth middleware throws on startup without it, so no session is ever signed with a missing secret.

Optional seeding for local development:

```bash
node seed.js              # demo catalogue (skips itself if the table already has data)
node seed-images.js       # placeholder product images
```

On first start the app creates the schema and, if no admin exists, one admin account: **admin@sitha.com / admin123**. That account is flagged `must_change_password`, so the first login forces a real password before anything else. Demo credentials only — set your own before putting this anywhere real.

## Environment

`.env.example` lists every variable:

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Signs session tokens (required) |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Payment gateway; checkout is disabled without them |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | Outgoing mail for password reset and order notifications |
| `NODE_ENV`, `PORT` | Runtime mode and listen port (default 3000) |

`.env` is gitignored; only `.env.example` is committed.

## Layout

```
server.js              app wiring: security headers, CSRF, static files, routes
config/database.js     schema, additive migrations, default admin, store settings
routes/customer.js     storefront: catalogue, cart, wishlist, checkout, orders, reviews, returns
routes/admin.js        admin panel: products, orders, customers, staff, coupons, returns, analytics
middleware/auth.js     token issue/verify, customer and admin guards, cookie options
middleware/csrf.js     double-submit CSRF token for every POST
middleware/rateLimit.js per-IP limiting on auth and checkout endpoints
middleware/securityHeaders.js  CSP, X-Frame-Options, nosniff, Referrer-Policy
views/customer|admin   EJS pages
public/                CSS, client JS, images, uploaded product photos
test/                  node:test suites for auth and the database layer
```

## Security notes

- Passwords are bcrypt hashes; tokens are JWT with a 7-day expiry in an `httpOnly`, `SameSite=Strict` cookie that turns `secure` in production.
- Every `POST` must carry a CSRF token, checked in one middleware instead of per route.
- Role checks live in the middleware (`admin`/`staff` for the panel, `customer` for the storefront), not in the templates.
- SQL is written with bound parameters through `better-sqlite3` prepared statements.
- Razorpay payments are verified by signature on the server before an order is marked paid.

## Tests

```bash
npm test
```

Covers token issue/verification, invalid-token rejection, cookie flags per environment, and schema/query behaviour.
