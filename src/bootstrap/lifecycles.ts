import type { Core } from '@strapi/strapi';
import { sendStatusEmail } from '../lib/emails';
import { afterCommit, createOrderManager, currentActor, silentStatusChanges } from '../lib/order-manager';

/** Recomputes a product's average rating + review count from its *published* (approved) reviews. */
async function refreshProductRating(strapi: Core.Strapi, productDocumentId?: string | null) {
  if (!productDocumentId) return;
  const reviews = await strapi.documents('api::review.review').findMany({
    filters: { product: { documentId: productDocumentId } },
    status: 'published',
    fields: ['rating'],
    limit: 10_000,
  });
  const count = reviews.length;
  const avg = count ? reviews.reduce((n, r) => n + Number(r.rating), 0) / count : 0;

  // Write to draft + published rows directly so a rating change never creates unpublished drafts.
  const meta = strapi.db.metadata.get('api::product.product');
  const col = (a: string) => (meta.attributes[a] as { columnName?: string }).columnName ?? a;
  await strapi.db
    .connection(meta.tableName)
    .where(col('documentId'), productDocumentId)
    .update({ [col('rating')]: Math.round(avg * 10) / 10, [col('reviewCount')]: count });
}

async function productOfReview(strapi: Core.Strapi, reviewId?: number) {
  if (!reviewId) return null;
  const review = await strapi.db.query('api::review.review').findOne({ where: { id: reviewId }, populate: { product: { select: ['documentId'] } } });
  return (review?.product?.documentId as string | undefined) ?? null;
}

export function registerLifecycles(strapi: Core.Strapi) {
  strapi.db.lifecycles.subscribe({
    models: ['api::review.review'],
    async afterCreate(event) {
      await refreshProductRating(strapi, await productOfReview(strapi, event.result?.id));
    },
    async afterUpdate(event) {
      await refreshProductRating(strapi, await productOfReview(strapi, event.result?.id));
    },
    async beforeDelete(event) {
      const id = (event.params.where as { id?: number } | undefined)?.id;
      event.state.productDocumentId = await productOfReview(strapi, id);
    },
    async afterDelete(event) {
      await refreshProductRating(strapi, event.state.productDocumentId as string | null);
    },
  });

  strapi.db.lifecycles.subscribe({
    models: ['api::order.order'],
    async beforeUpdate(event) {
      const id = (event.params.where as { id?: number } | undefined)?.id;
      if (id) {
        const before = await strapi.db.query('api::order.order').findOne({ where: { id }, select: ['orderStatus'] });
        event.state.previousStatus = before?.orderStatus;
      }
    },
    async afterUpdate(event) {
      const id = event.result?.id;
      if (!id) return;
      const status = event.result?.orderStatus;
      const previous = event.state.previousStatus as string | undefined;
      if (status && previous && status !== previous) {
        const manager = createOrderManager(strapi);
        await manager.logEvent(id, 'status', `Status changed: ${previous} → ${status}`, { actor: currentActor(strapi), visibleToCustomer: true });
        const silent = silentStatusChanges.delete(id);
        if (!silent) {
          afterCommit(strapi, async () => {
            const sentTo = await sendStatusEmail(strapi, id);
            if (sentTo) await manager.logEvent(id, 'email', `“${status}” email sent to ${sentTo}`, { actor: 'System' });
          });
        }
      }
      await strapi.service('api::order.order').restockIfNeeded(id);
    },
  });

  // Payments edited directly in the content manager keep the order's totals in sync too.
  const recalcFor = async (paymentId?: number) => {
    if (!paymentId) return;
    const payment = await strapi.db.query('api::payment.payment').findOne({ where: { id: paymentId }, populate: { order: { select: ['id'] } } });
    if (payment?.order?.id) await createOrderManager(strapi).recalcPayments(payment.order.id);
  };
  strapi.db.lifecycles.subscribe({
    models: ['api::payment.payment'],
    async afterCreate(event) {
      await recalcFor(event.result?.id);
    },
    async afterUpdate(event) {
      await recalcFor(event.result?.id);
    },
    async beforeDelete(event) {
      const id = (event.params.where as { id?: number } | undefined)?.id;
      const payment = id ? await strapi.db.query('api::payment.payment').findOne({ where: { id }, populate: { order: { select: ['id'] } } }) : null;
      event.state.orderId = payment?.order?.id;
    },
    async afterDelete(event) {
      if (event.state.orderId) await createOrderManager(strapi).recalcPayments(event.state.orderId as number);
    },
  });
}
