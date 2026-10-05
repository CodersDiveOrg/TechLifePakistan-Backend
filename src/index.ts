import type { Core } from '@strapi/strapi';
import { applyAdminLayouts } from './bootstrap/admin-layouts';
import { configureAuthEmails } from './bootstrap/auth-emails';
import { registerDashboardRoutes } from './bootstrap/dashboard';
import { registerLifecycles } from './bootstrap/lifecycles';
import { registerOrderRoutes } from './bootstrap/order-routes';
import { ensurePermissions } from './bootstrap/permissions';
import { ensureStorefrontWebhook } from './bootstrap/webhook';
import { registerGraphQL } from './graphql';

export default {
  register({ strapi }: { strapi: Core.Strapi }) {
    registerGraphQL(strapi);
  },

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    registerLifecycles(strapi);
    registerDashboardRoutes(strapi);
    registerOrderRoutes(strapi);
    await ensurePermissions(strapi);
    await applyAdminLayouts(strapi);
    await ensureStorefrontWebhook(strapi);
    await configureAuthEmails(strapi);
  },
};
