# Deploying the backend to a Hostinger VPS

Strapi + PostgreSQL run on the VPS; the Next.js storefront (separate repo) is deployed on Hostinger
and talks to this server at `https://api.yourdomain.pk`. Replace `api.yourdomain.pk` / `yourdomain.pk`
with your real domains throughout.

**VPS size:** KVM 2 (8 GB RAM) recommended — building the admin panel needs ~2–3 GB. OS: Ubuntu 24.04.
**DNS:** add an `A` record `api` → the VPS IP (hPanel → Domains → DNS).

## 1. Prepare the server (once)

```bash
ssh root@VPS_IP

apt update && apt upgrade -y
apt install -y git nginx certbot python3-certbot-nginx ufw

# Node 22 LTS + pnpm + PM2
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
corepack enable && corepack prepare pnpm@latest --activate
npm install -g pm2

# Docker (for PostgreSQL)
curl -fsSL https://get.docker.com | sh

# Firewall: SSH + web only (Postgres stays on 127.0.0.1)
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable
```

## 2. Get the code

```bash
mkdir -p /var/www && cd /var/www
git clone https://github.com/<you>/<backend-repo>.git techlife-api   # private repo: use a GitHub token or deploy key
cd techlife-api
```

## 3. Configure `.env`

```bash
cp .env.example .env
# generate a secret (run once per value; APP_KEYS needs two, comma-separated):
node -e "console.log(require('crypto').randomBytes(16).toString('base64'))"
nano .env
```

| Variable | Production value |
|---|---|
| `APP_KEYS`, `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`, `JWT_SECRET`, `ENCRYPTION_KEY` | **new** random values (not the ones from your computer) |
| `DATABASE_PASSWORD` | a strong password (only used by the Docker Postgres on this server) |
| `PUBLIC_URL` | `https://api.yourdomain.pk` |
| `IS_PROXIED` | `true` |
| `STOREFRONT_URL` | `https://yourdomain.pk` |
| `CORS_ORIGINS` | `https://yourdomain.pk,https://www.yourdomain.pk` |
| `REVALIDATE_SECRET` | a random value — **the same value goes into the storefront's environment variables** |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | `smtp.hostinger.com` / `465` / `true` |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | a mailbox created in hPanel → Emails (e.g. `orders@yourdomain.pk`) |
| `EMAIL_FROM` | `Tech Life Pakistan <orders@yourdomain.pk>` (must be that mailbox) |
| `EMAIL_REPLY_TO`, `STORE_NOTIFY_EMAIL` | where customers reply / where new-order alerts go |

## 4. Start PostgreSQL

```bash
docker compose up -d          # starts only Postgres (Mailpit is for local development)
docker compose ps             # STATUS should become "healthy"
```

## 5. Copy your data (products, images, settings, admin account)

On **your computer**, in the backend folder (with the local database running):

```bash
pnpm export:server                                   # → deploy-bundle-YYYYMMDD-HHMM.tar.gz
scp deploy-bundle-*.tar.gz root@VPS_IP:/var/www/techlife-api/
```

On the **server**:

```bash
cd /var/www/techlife-api
bash scripts/restore-on-server.sh deploy-bundle-*.tar.gz
```

You log in to the admin with the **same email/password as on your computer**. (Starting empty
instead? Skip this step and run `pnpm seed` after step 6.)

## 6. Build and start Strapi

```bash
pnpm install --frozen-lockfile
NODE_ENV=production pnpm build
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup        # run the command it prints, so Strapi starts after a reboot
pm2 logs techlife-api          # should end with "Strapi started successfully" (Ctrl+C to exit)
```

## 7. Nginx + HTTPS

```bash
cp deploy/nginx-api.conf /etc/nginx/sites-available/techlife-api
nano /etc/nginx/sites-available/techlife-api       # set server_name api.yourdomain.pk
ln -s /etc/nginx/sites-available/techlife-api /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d api.yourdomain.pk               # free SSL, auto-renews
```

Check: open `https://api.yourdomain.pk/admin` and sign in. Then:

```bash
curl -s https://api.yourdomain.pk/graphql -H 'content-type: application/json' \
  -d '{"query":"{ products { name } }"}'
```

## 8. Point the storefront at it

In Hostinger → your storefront app → **Environment variables**:

```
STRAPI_URL=https://api.yourdomain.pk
REVALIDATE_SECRET=<same value as the backend .env>
NEXT_PUBLIC_SITE_URL=https://yourdomain.pk
```

Redeploy the storefront.

## 9. After the storefront's first build — rate-limit allowlist

The storefront's build and page refreshes make many requests from one IP. Find that IP:

```bash
tail -n 200 /var/log/nginx/access.log | awk '{print $1}' | sort | uniq -c | sort -rn | head
```

Then put it in both places and reload:

```bash
nano /etc/nginx/sites-available/techlife-api    # geo block: replace 127.0.0.1 with the storefront IP
nano .env                                       # RATE_LIMIT_ALLOW_IPS=127.0.0.1,::1,::ffff:127.0.0.1,<storefront IP>
nginx -t && systemctl reload nginx && pm2 restart techlife-api
```

## 10. Before going live

- Admin → Orders: delete test orders; Content Manager → Store settings: real phone, email, address,
  **Payment accounts** (bank / JazzCash / Easypaisa); check Shipping zones and Tax rates.
- Place one real test order from the live site and confirm the emails arrive.

## Updating later

```bash
cd /var/www/techlife-api
git pull
pnpm install --frozen-lockfile
NODE_ENV=production pnpm build
pm2 restart techlife-api
```

## Backups (recommended)

Daily database dump + uploads, kept 14 days:

```bash
mkdir -p /var/backups/techlife
crontab -e
# add:
30 3 * * * cd /var/www/techlife-api && docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip > /var/backups/techlife/db-$(date +\%F).sql.gz && tar -czf /var/backups/techlife/uploads-$(date +\%F).tar.gz -C public uploads && find /var/backups/techlife -mtime +14 -delete
```

Download them occasionally (or enable Hostinger VPS snapshots) so a copy lives off the server.
