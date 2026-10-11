# Tech Life Pakistan backend — Strapi 5 + GraphQL + PostgreSQL

Headless e-commerce backend for the Next.js storefront (separate repository: `Shahzaib`). Admins manage products,
orders, coupons, banners and store settings in the Strapi dashboard; the storefront talks to it over GraphQL.

## Run it locally

```bash
cp .env.example .env   # then fill in secrets / DB password
pnpm install
pnpm db:up          # PostgreSQL 16 on 127.0.0.1:5434 + Mailpit (local mail inbox: http://localhost:8025)
pnpm develop        # http://localhost:1337/admin  ·  GraphQL: http://localhost:1337/graphql
pnpm seed           # first run only: loads the client's products, images, banners, FAQs, policies & settings
```

On first visit to `/admin`, create the owner (super-admin) account. `pnpm seed --force` wipes the
catalogue (not orders/customers) and re-seeds from `data/`.

## Content model (`src/api`, `src/components`)

| Type | Purpose | Draft & publish |
|---|---|---|
| **Product** | name, slug, SKU, price / compare-at price, stock + low-stock alert, images, category, brand, specs, highlights, downloads (manuals), warranty, badges (featured/new/best seller/flash sale), rating (auto), SEO, **options + variants** (e.g. 20A / 30A — each with its own SKU, price, stock, image), **tags**, **related products** | ✓ |
| **Tag** | free-form product tags (`/shop?t=slug`) | – |
| **Category** / **Brand** | taxonomy (categories support parents/children) | ✓ |
| **Banner** | home hero slides & promo tiles (`placement`, `theme`, `sortOrder`) | ✓ |
| **Review** | customer reviews — submitted as drafts, **publish = approve**; product rating/count update automatically | ✓ |
| **Order** | order #, status, payment method/status, paid / refunded amounts, customer, shipping address, line items (price + variant snapshot), totals incl. shipping method, COD fee and tax, coupon, courier / tracking # / ETA, cancel reason, internal notes, linked customer | – |
| **Order event** | the order timeline (status changes, payments, emails, notes — each marked internal or customer-visible) | – |
| **Payment** | payments and refunds per order (`completed` / `pending` / `failed`); the order's payment status is recomputed from completed records | – |
| **Shipping zone** / **Shipping method** | zones match cities first, then provinces (by priority); each method has a rate, free-over threshold, COD fee and delivery estimate | – |
| **Tax rate** | percentage, included in prices or added at checkout, optionally per province | – |
| **Address** | customers' saved addresses (address book) | – |
| **Coupon** | percent/fixed, min subtotal, max discount, date window, usage limit | – |
| **FAQ**, **Policy page** | content pages | ✓ |
| **Contact message**, **Newsletter subscriber** | storefront inboxes | – |
| **Store settings** (single type) | store name, announcements, contact details, WhatsApp, shipping rules (fallback flat rate when no zones exist, restricted regions), socials, trust badges, **payment accounts** (bank / JazzCash / Easypaisa details shown to customers who pay in advance) | – |

Customer accounts (users-permissions **User**) also store full name, phone, the saved cart and wishlist.

## Commerce rules (server-side, `src/api/order/services/order.ts`)

- `placeOrder` re-prices every line from the database — the browser only sends product ids + quantities.
- Stock is checked and decremented inside a transaction with row locks (no overselling).
- Variant lines are priced and stock-checked per variant (SKU).
- Coupons, shipping (zones → methods), COD fee and tax are computed by `src/lib/pricing.ts`; restricted regions come from Store settings.
- Setting an order to **cancelled** or **returned** puts its stock back (once).
- Orders placed while signed in are linked to the customer account.
- All admin order actions go through `src/lib/order-manager.ts`, which also writes the timeline.

## GraphQL API (`src/graphql/index.ts`)

Generated read queries for products, categories, brands, banners, reviews, FAQs, policies and
store settings. Generic create/update/delete is **disabled** for catalogue content, orders and coupons.
Custom operations:

| Operation | Auth | |
|---|---|---|
| `placeOrder(input)` | guest or customer | creates the order, returns totals |
| `validateCoupon(code, subtotal)` | public | discount preview |
| `trackOrder(orderNumber, phone)` | public | guest order tracking (phone must match) |
| `myOrders` | customer JWT | signed-in customer's orders |
| `checkoutQuote(input)` | public | shipping options for the address, COD fee, tax, total |
| `cancelOrder(orderNumber, phone?, reason?)` | owner or guest + phone | while pending / confirmed; restocks |
| `submitPayment(input)` | owner or guest + phone | customer reports a bank/wallet transaction ID → *pending* payment for the store to verify |
| `paymentAccounts(method?)` | public | active payment accounts from Store settings |
| `submitReview(input)` | public | saved as a draft for moderation |
| `myProfile`, `updateMyProfile` | customer JWT | name, phone, addresses, saved cart, wishlist (`src/graphql/customer.ts`) |
| `saveAddress`, `deleteAddress` | customer JWT | address book (max 10, one default) |
| `saveCart`, `saveWishlist` | customer JWT | cart / wishlist that follow the customer across devices (`merge: true` at sign-in) |
| `requestLoginCode(email)`, `verifyLoginCode(email, code)` | public | passwordless sign-in with an emailed 6-digit code (`src/graphql/otp.ts`) |
| `login` / `register` / `me` / `changePassword` | users-permissions | customer accounts |

**Email sign-in codes**: stored as an HMAC, valid 10 minutes, single use, 5 wrong tries max, one
resend per minute. A new email gets an account automatically unless sign-ups are switched off in
*Settings → Users & Permissions → Advanced settings*. SMS codes need an SMS provider (not set up).

The Apollo sandbox is available at `/graphql` in development only (disabled in production).

## Admin dashboard

- **Home widgets** (`src/admin/widgets`): store overview (30-day revenue, orders today, open orders,
  delivered-but-unpaid COD, reviews to approve, new messages), recent orders, low stock, quick actions.
  Data comes from admin-only routes in `src/bootstrap/dashboard.ts`.
- **Orders** (left menu, `src/admin/pages/orders`): filter by status / payment / method / date,
  search, bulk status changes, CSV export; order page with timeline, status changes (optional
  customer email, COD collection), courier & tracking, payments, refunds (with restock / mark returned),
  internal or customer-visible notes.
- **Printing for dispatch** (`src/lib/print-documents.ts`, `src/admin/pages/orders/print.tsx`): *Print* menu on
  the order page, a **Dispatch & print** panel on the Content Manager order screen, and bulk printing of
  selected orders (Orders list bulk bar, or Content Manager list → select → *Print*; one order per page).
  Formats: **shipping label** 4×6 in (thermal label printer) or 80 mm (receipt printer) — large phone and
  city, Code128 barcodes for the order # and tracking #, amount to collect (black box for COD, "PREPAID"
  or "NOT PAID YET" otherwise), contents and return address; **dispatch sheet** (A4: label + packing
  checklist); **packing slip** and **invoice** in A4 or 80 mm. The browser print dialog opens directly —
  pick your label printer and set *Margins: None* / *Scale: 100%* for labels.
- **Advance payments**: when a customer submits a bank/wallet transaction ID, the store gets an email
  and the Orders list shows "*N customer payments awaiting verification*". Open the order → Payment →
  **Verify** (counts toward paid) or **Reject** (the reason is shown to the customer).
  Add your accounts under *Content Manager → Store settings → Payment accounts*.
- **List views**: product/order/coupon/… tables show the columns that matter (set once in
  `src/bootstrap/admin-layouts.ts`; adjust freely in the UI afterwards).
- **Branding**: logo, colours and login copy in `src/admin/app.tsx`.

## Plugins

| Plugin | Purpose | Config |
|---|---|---|
| `@strapi/plugin-graphql` | Storefront API | `config/plugins.ts` → `graphql` |
| `@strapi/provider-email-nodemailer` (official) | Order emails + password reset over SMTP | `config/plugins.ts` → `email`, `SMTP_*` env |
| `strapi-plugin-rate-limit` | Per-IP rate limiting of `/graphql` and `/api/*` (admin page: **Rate Limit** in the sidebar) | `config/plugins.ts` → `strapi-plugin-rate-limit` |

### Emails (`src/lib/emails.ts`)

- **Order placed** → confirmation to the customer (if they gave an email) + alert to `STORE_NOTIFY_EMAIL` (or the Store settings email).
- **Order status changed** in the dashboard (confirmed, processing, shipped, delivered, cancelled, returned) → update to the customer, including the tracking number.
- **Forgot password** → link to the storefront's `/reset-password` page (template: Settings → Users & Permissions → Email templates).
- Sending happens after the order is saved and never blocks or fails checkout. Locally every email lands in **Mailpit** at http://localhost:8025.

### Rate limiting

Limits: 120 requests/min per IP overall, 60/min on `/graphql`, 10 per 15 min on `/api/auth/**`.
The storefront calls Strapi server-side, so it forwards each shopper's IP in `CF-Connecting-IP`;
requests from the storefront server itself (catalogue reads) are allowlisted (`RATE_LIMIT_ALLOW_IPS`).
**In production, Nginx in front of Strapi must overwrite that header** so it can't be spoofed:

```nginx
location / {
  proxy_pass http://127.0.0.1:1337;
  proxy_set_header CF-Connecting-IP $remote_addr;
  proxy_set_header X-Forwarded-For  $remote_addr;
  proxy_set_header Host $host;
}
```

(The storefront talks to Strapi on `http://127.0.0.1:1337` directly, not through this public vhost.)
For several Strapi instances, add Redis (`redis.url` in the plugin config).

## Storefront cache refresh

On boot Strapi registers the webhook **Storefront revalidation** (Settings → Webhooks) pointing to
`$STOREFRONT_URL/api/revalidate` with the `x-revalidate-secret` header. `REVALIDATE_SECRET` must match the
storefront's `.env.local`. Publishing content refreshes the store immediately.

## Environment (`.env`)

| Variable | |
|---|---|
| `DATABASE_*` | PostgreSQL connection (docker-compose reads the same values) |
| `APP_KEYS`, `*_SECRET`, `*_SALT`, `ENCRYPTION_KEY` | generated secrets — **use new values in production** |
| `CORS_ORIGINS` | storefront origin(s), comma-separated |
| `STOREFRONT_URL`, `REVALIDATE_SECRET` | revalidation webhook target + shared secret |
| `PUBLIC_URL`, `IS_PROXIED` | set when running behind Nginx with a domain |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USERNAME`, `SMTP_PASSWORD` | outgoing mail (Hostinger mail: `smtp.hostinger.com`, port 465, `SMTP_SECURE=true`) |
| `EMAIL_FROM`, `EMAIL_REPLY_TO`, `STORE_NOTIFY_EMAIL` | sender, reply-to, and where new-order alerts go |
| `RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_GRAPHQL_PER_MINUTE`, `RATE_LIMIT_ALLOW_IPS` | rate-limit tuning; allowlist = the storefront server's IPs |

## Deploying to a Hostinger VPS

Step-by-step guide: **[DEPLOY.md](DEPLOY.md)** — server setup, `.env`, Postgres, copying your local data
(`pnpm export:server` → `scripts/restore-on-server.sh`), PM2 (`ecosystem.config.cjs`), Nginx + HTTPS
(`deploy/nginx-api.conf`), rate-limit allowlist, updates and backups.
