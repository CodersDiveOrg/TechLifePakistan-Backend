import type { Core } from '@strapi/strapi';

/** Read access to the catalogue + write access to the public inboxes. Idempotent — safe on every boot. */
const READ = (uid: string, actions = ['find', 'findOne']) => actions.map((a) => `${uid}.${a}`);

const STOREFRONT_ACTIONS = [
  ...READ('api::product.product'),
  ...READ('api::category.category'),
  ...READ('api::brand.brand'),
  ...READ('api::tag.tag'),
  ...READ('api::banner.banner'),
  ...READ('api::review.review'),
  ...READ('api::faq.faq'),
  ...READ('api::policy.policy'),
  ...READ('api::global.global', ['find']),
  'api::contact-message.contact-message.create',
  'api::newsletter-subscriber.newsletter-subscriber.create',
];

export async function ensurePermissions(strapi: Core.Strapi) {
  const roles = await strapi.db
    .query('plugin::users-permissions.role')
    .findMany({ where: { type: { $in: ['public', 'authenticated'] } } });

  for (const role of roles) {
    const existing = await strapi.db
      .query('plugin::users-permissions.permission')
      .findMany({ where: { role: role.id }, select: ['action'] });
    const have = new Set(existing.map((p: { action: string }) => p.action));
    const missing = STOREFRONT_ACTIONS.filter((a) => !have.has(a));
    for (const action of missing) {
      await strapi.db.query('plugin::users-permissions.permission').create({ data: { action, role: role.id } });
    }
    if (missing.length) strapi.log.info(`[setup] granted ${missing.length} storefront permission(s) to ${role.type}`);
  }
}
