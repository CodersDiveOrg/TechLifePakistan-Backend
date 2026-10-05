import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  // Public URL of this server (e.g. https://admin.yourstore.pk) — used for absolute links behind a proxy.
  url: env('PUBLIC_URL', ''),
  proxy: { koa: env.bool('IS_PROXIED', false) },
  app: {
    keys: env.array('APP_KEYS')!,
  },
  webhooks: {
    populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
  },
});

export default config;
