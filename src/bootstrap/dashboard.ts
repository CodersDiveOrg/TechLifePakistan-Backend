import type { Core } from '@strapi/strapi';

const OPEN_STATUSES = ['pending', 'confirmed', 'processing', 'shipped'];
const LOST_STATUSES = ['cancelled', 'returned'];

/** Admin-only JSON endpoints that power the custom home-page widgets (src/admin/widgets). */
export function registerDashboardRoutes(strapi: Core.Strapi) {
  strapi.server.routes({
    type: 'admin',
    prefix: '/store-dashboard',
    routes: [
      {
        method: 'GET',
        path: '/overview',
        handler: async (ctx: { body: unknown }) => {
          ctx.body = await overview(strapi);
        },
        info: { type: 'admin' },
        config: { policies: ['admin::isAuthenticatedAdmin'] },
      },
      {
        method: 'GET',
        path: '/recent-orders',
        handler: async (ctx: { body: unknown }) => {
          const orders = await strapi.db.query('api::order.order').findMany({
            orderBy: { createdAt: 'desc' },
            limit: 8,
            populate: { customer: true },
          });
          ctx.body = orders.map((o: Record<string, any>) => ({
            documentId: o.documentId,
            orderNumber: o.orderNumber,
            customer: o.customer?.fullName ?? '—',
            total: Number(o.total),
            orderStatus: o.orderStatus,
            paymentStatus: o.paymentStatus,
            createdAt: o.createdAt,
          }));
        },
        info: { type: 'admin' },
        config: { policies: ['admin::isAuthenticatedAdmin'] },
      },
      {
        method: 'GET',
        path: '/low-stock',
        handler: async (ctx: { body: unknown }) => {
          const products = await strapi.documents('api::product.product').findMany({
            status: 'published',
            fields: ['name', 'sku', 'stock', 'lowStockThreshold'],
            populate: { variants: { fields: ['title', 'sku', 'stock'] } },
            limit: 500,
          });
          // Products with variants are tracked per variant; simple products by their own stock.
          const rows = products.flatMap((p) => {
            const threshold = Number(p.lowStockThreshold ?? 5);
            const variants = (p.variants ?? []) as { title: string; sku: string; stock: number }[];
            return variants.length
              ? variants.map((v) => ({ documentId: p.documentId, name: `${p.name} — ${v.title}`, sku: v.sku, stock: Number(v.stock), threshold }))
              : [{ documentId: p.documentId, name: p.name as string, sku: p.sku as string, stock: Number(p.stock), threshold }];
          });
          ctx.body = rows.filter((r) => r.stock <= r.threshold).sort((a, b) => a.stock - b.stock).slice(0, 8);
        },
        info: { type: 'admin' },
        config: { policies: ['admin::isAuthenticatedAdmin'] },
      },
    ],
  });
}

async function overview(strapi: Core.Strapi) {
  const orders = strapi.db.query('api::order.order');
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

  const reviews = strapi.documents('api::review.review');
  const [todayOrders, recent, openOrders, unpaidCod, products, draftReviews, publishedReviews, unreadMessages] = await Promise.all([
    orders.count({ where: { createdAt: { $gte: startOfToday } } }),
    orders.findMany({ where: { createdAt: { $gte: thirtyDaysAgo }, orderStatus: { $notIn: LOST_STATUSES } }, select: ['total'] }),
    orders.count({ where: { orderStatus: { $in: OPEN_STATUSES } } }),
    orders.count({ where: { paymentStatus: 'unpaid', orderStatus: 'delivered' } }),
    strapi.documents('api::product.product').count({ status: 'published' }),
    // Every review has a draft version; those without a published version are awaiting moderation.
    reviews.count({ status: 'draft' }),
    reviews.count({ status: 'published' }),
    strapi.db.query('api::contact-message.contact-message').count({ where: { handled: false } }),
  ]);

  const revenue30d = recent.reduce((n: number, o: { total: number | string }) => n + Number(o.total), 0);
  return {
    todayOrders,
    revenue30d,
    orders30d: recent.length,
    openOrders,
    unpaidDelivered: unpaidCod,
    products,
    pendingReviews: Math.max(0, draftReviews - publishedReviews),
    unreadMessages,
  };
}
