import type { Core } from '@strapi/strapi';

const NAME = 'Storefront revalidation';

/**
 * Registers a webhook that tells the Next.js storefront to refresh cached pages whenever catalogue
 * content changes. Its URL and secret follow STOREFRONT_URL / REVALIDATE_SECRET (so a database copied
 * from another environment is re-pointed on boot); the events and on/off switch stay editable in
 * Settings → Webhooks.
 */
export async function ensureStorefrontWebhook(strapi: Core.Strapi) {
  const storefront = process.env.STOREFRONT_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!storefront || !secret) return;

  const store = strapi.get('webhookStore');
  const url = `${storefront.replace(/\/$/, '')}/api/revalidate`;
  const existing = (await store.findWebhooks()).find((w: { name: string }) => w.name === NAME);
  if (existing) {
    if (existing.url === url && existing.headers?.['x-revalidate-secret'] === secret) return;
    const updated = await store.updateWebhook(existing.id, { ...existing, url, headers: { ...existing.headers, 'x-revalidate-secret': secret } });
    if (updated) strapi.get('webhookRunner').update(updated);
    strapi.log.info(`[setup] webhook "${NAME}" now → ${url}`);
    return;
  }

  const webhook = await store.createWebhook({
    name: NAME,
    url,
    headers: { 'x-revalidate-secret': secret },
    events: ['entry.create', 'entry.update', 'entry.delete', 'entry.publish', 'entry.unpublish'],
    isEnabled: true,
  });
  strapi.get('webhookRunner').add(webhook);
  strapi.log.info(`[setup] created webhook "${NAME}" → ${webhook.url}`);
}
