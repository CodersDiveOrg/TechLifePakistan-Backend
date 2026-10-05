import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { adjustVariantStock } from './variant-stock';

const { ValidationError, NotFoundError } = errors;

const ORDER = 'api::order.order';
export const ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
const CUSTOMER_CANCELLABLE: OrderStatus[] = ['pending', 'confirmed'];
const METHODS = ['cod', 'bank', 'wallet', 'card', 'other'] as const;

type EventType = 'created' | 'status' | 'payment' | 'refund' | 'shipping' | 'note' | 'email' | 'cancel';

/** Status changes requested with notify=false — the lifecycle checks this before emailing. */
export const silentStatusChanges = new Set<number>();

const money = (n: unknown) => Math.round(Number(n ?? 0));

/**
 * Runs `fn` after the current database transaction commits (or on the next tick when there is none).
 * Side effects such as emails must not run inside the document-service transaction: its context would
 * still be attached and their queries would hit an already-finished transaction.
 */
export function afterCommit(strapi: Core.Strapi, fn: () => Promise<unknown> | void) {
  const run = () => setImmediate(() => void Promise.resolve(fn()).catch((e) => strapi.log.error(`[orders] after-commit task failed: ${(e as Error).message}`)));
  if (!strapi.db.inTransaction()) return run();
  void strapi.db.transaction(async ({ onCommit }) => {
    onCommit(run);
  });
}

/** Name of the admin (or "Customer"/"System") performing the current request. */
export function currentActor(strapi: Core.Strapi, fallback = 'System') {
  const user = strapi.requestContext.get()?.state?.user as { firstname?: string; lastname?: string; email?: string; username?: string } | undefined;
  if (!user) return fallback;
  const name = [user.firstname, user.lastname].filter(Boolean).join(' ');
  return name || user.username || user.email || fallback;
}

export function createOrderManager(strapi: Core.Strapi) {
  const orders = () => strapi.documents(ORDER);

  async function load(documentId: string) {
    const order = await orders().findOne({
      documentId,
      populate: {
        customer: true,
        shippingAddress: true,
        items: { populate: { product: { fields: ['name', 'slug', 'documentId'] } } },
        user: { fields: ['email', 'username'] },
        events: { sort: ['createdAt:desc'] },
        payments: { sort: ['createdAt:desc'] },
      },
    });
    if (!order) throw new NotFoundError('Order not found');
    return { ...order, id: Number(order.id) };
  }

  async function logEvent(orderId: number | string, type: EventType, message: string, opts: { actor?: string; visibleToCustomer?: boolean; meta?: unknown } = {}) {
    try {
      await strapi.documents('api::order-event.order-event').create({
        data: {
          type,
          message,
          actor: opts.actor ?? currentActor(strapi),
          visibleToCustomer: opts.visibleToCustomer ?? false,
          meta: (opts.meta ?? null) as never,
          order: typeof orderId === 'number' ? { id: orderId } : orderId,
        } as never,
      });
    } catch (error) {
      strapi.log.error(`[orders] could not log event: ${(error as Error).message}`);
    }
  }

  /** Recomputes paid/refunded totals + payment status from completed payment records. */
  async function recalcPayments(orderId: number) {
    const order = await strapi.db.query(ORDER).findOne({ where: { id: orderId }, select: ['id', 'total'], populate: { payments: true } });
    if (!order) return;
    const done = (order.payments ?? []).filter((p: { status: string }) => p.status === 'completed');
    const paid = done.filter((p: { kind: string }) => p.kind === 'payment').reduce((n: number, p: { amount: string }) => n + Number(p.amount), 0);
    const refunded = done.filter((p: { kind: string }) => p.kind === 'refund').reduce((n: number, p: { amount: string }) => n + Number(p.amount), 0);
    const total = Number(order.total);
    const paymentStatus =
      refunded > 0 ? (refunded >= paid ? 'refunded' : 'partially_refunded') : paid <= 0 ? 'unpaid' : paid >= total ? 'paid' : 'partially_paid';
    await strapi.db.query(ORDER).update({ where: { id: orderId }, data: { paidAmount: money(paid), refundedAmount: money(refunded), paymentStatus } });
  }

  /** Adds the ordered quantities back to stock (draft + published rows). */
  async function restockItems(orderId: number) {
    const order = await strapi.db.query(ORDER).findOne({ where: { id: orderId }, populate: { items: { populate: { product: true } } } });
    if (!order || order.stockRestored) return false;
    const meta = strapi.db.metadata.get('api::product.product');
    const col = (a: string) => (meta.attributes[a] as { columnName?: string }).columnName ?? a;
    await strapi.db.transaction(async ({ trx }) => {
      for (const item of order.items ?? []) {
        if (!item.product?.documentId) continue;
        if (item.variantSku) await adjustVariantStock(trx, item.product.documentId, item.variantSku, item.quantity);
        else await trx(meta.tableName).where(col('documentId'), item.product.documentId).increment(col('stock'), item.quantity);
      }
      await strapi.db.query(ORDER).update({ where: { id: orderId }, data: { stockRestored: true } });
    });
    return true;
  }

  return {
    load,
    logEvent,
    recalcPayments,
    restockItems,

    async changeStatus(documentId: string, status: OrderStatus, opts: { note?: string; notify?: boolean; collectCod?: boolean; reason?: string } = {}) {
      if (!ORDER_STATUSES.includes(status)) throw new ValidationError(`Unknown status "${status}"`);
      const order = await load(documentId);
      if (order.orderStatus === status) return order;
      if (opts.notify === false) silentStatusChanges.add(order.id);
      await orders().update({
        documentId,
        data: { orderStatus: status, ...(status === 'cancelled' && opts.reason ? { cancelReason: opts.reason } : {}) } as never,
      });
      if (opts.note) await logEvent(order.id, 'note', opts.note);
      if (status === 'delivered' && opts.collectCod && order.paymentMethod === 'cod') {
        const due = money(order.total) - money(order.paidAmount);
        if (due > 0) await this.recordPayment(documentId, { amount: due, method: 'cod', note: 'Cash collected on delivery' });
      }
      return load(documentId);
    },

    async bulkStatus(documentIds: string[], status: OrderStatus, notify = true) {
      const results = { updated: 0, failed: [] as string[] };
      for (const id of documentIds.slice(0, 200)) {
        try {
          await this.changeStatus(id, status, { notify });
          results.updated++;
        } catch {
          results.failed.push(id);
        }
      }
      return results;
    },

    async updateShipping(documentId: string, data: { courier?: string; trackingNumber?: string; estimatedDelivery?: string | null; markShipped?: boolean; notify?: boolean }) {
      const order = await load(documentId);
      await orders().update({
        documentId,
        data: {
          courier: data.courier?.trim() || null,
          trackingNumber: data.trackingNumber?.trim() || null,
          estimatedDelivery: data.estimatedDelivery || null,
        } as never,
      });
      const parts = [data.courier && `Courier: ${data.courier}`, data.trackingNumber && `Tracking #${data.trackingNumber}`, data.estimatedDelivery && `ETA ${data.estimatedDelivery}`].filter(Boolean);
      if (parts.length) await logEvent(order.id, 'shipping', `Shipping details updated — ${parts.join(' · ')}`, { visibleToCustomer: true });
      if (data.markShipped && !['shipped', 'delivered'].includes(String(order.orderStatus))) {
        return this.changeStatus(documentId, 'shipped', { notify: data.notify ?? true });
      }
      return load(documentId);
    },

    async recordPayment(documentId: string, p: { amount: number; method?: string; reference?: string; note?: string }) {
      const order = await load(documentId);
      const amount = money(p.amount);
      if (!(amount > 0)) throw new ValidationError('Enter an amount greater than zero.');
      const method = (METHODS as readonly string[]).includes(p.method ?? '') ? p.method! : (order.paymentMethod as string);
      await strapi.documents('api::payment.payment').create({
        data: { kind: 'payment', amount, method, status: 'completed', reference: p.reference || null, note: p.note || null, receivedAt: new Date(), recordedBy: currentActor(strapi), order: documentId } as never,
      });
      await recalcPayments(order.id);
      await logEvent(order.id, 'payment', `Payment of Rs. ${amount.toLocaleString('en-PK')} recorded (${method}${p.reference ? `, ref ${p.reference}` : ''})`);
      return load(documentId);
    },

    async refund(documentId: string, r: { amount: number; method?: string; reference?: string; note?: string; restock?: boolean; markReturned?: boolean }) {
      const order = await load(documentId);
      const amount = money(r.amount);
      const refundable = money(order.paidAmount) - money(order.refundedAmount);
      if (!(amount > 0)) throw new ValidationError('Enter a refund amount greater than zero.');
      if (amount > refundable) throw new ValidationError(`You can refund at most Rs. ${refundable.toLocaleString('en-PK')} (amount paid minus earlier refunds).`);
      await strapi.documents('api::payment.payment').create({
        data: { kind: 'refund', amount, method: r.method || order.paymentMethod, status: 'completed', reference: r.reference || null, note: r.note || null, receivedAt: new Date(), recordedBy: currentActor(strapi), order: documentId } as never,
      });
      await recalcPayments(order.id);
      await logEvent(order.id, 'refund', `Refund of Rs. ${amount.toLocaleString('en-PK')} issued${r.note ? ` — ${r.note}` : ''}`, { visibleToCustomer: true });
      if (r.restock && (await restockItems(order.id))) await logEvent(order.id, 'refund', 'Items returned to stock');
      if (r.markReturned && order.orderStatus !== 'returned') await this.changeStatus(documentId, 'returned');
      return load(documentId);
    },

    async addNote(documentId: string, message: string, visibleToCustomer = false) {
      const order = await load(documentId);
      if (!message?.trim()) throw new ValidationError('Write a note first.');
      await logEvent(order.id, 'note', message.trim(), { visibleToCustomer });
      return load(documentId);
    },

    /**
     * Customer reports an advance payment (bank transfer / wallet) with its transaction reference.
     * Saved as a *pending* payment — it only counts once the store verifies it.
     */
    async submitCustomerPayment(orderNumber: string, auth: { userId?: number; phone?: string }, p: { reference: string; amount?: number; note?: string }) {
      const order = await strapi.db.query(ORDER).findOne({ where: { orderNumber: orderNumber.trim().toUpperCase() }, populate: { customer: true, user: true, payments: true } });
      const owns = order && ((auth.userId && order.user?.id === auth.userId) || (auth.phone && order.customer?.phone === auth.phone.replace(/\s/g, '')));
      if (!order || !owns) throw new NotFoundError('Order not found');
      if (!['bank', 'wallet'].includes(order.paymentMethod)) throw new ValidationError('This order is paid on delivery.');
      if (['cancelled', 'returned'].includes(order.orderStatus)) throw new ValidationError('This order is no longer active.');
      const due = money(Number(order.total) - money(order.paidAmount));
      if (due <= 0) throw new ValidationError('This order is already paid.');
      const pending = (order.payments ?? []).filter((x: { status: string; kind: string }) => x.kind === 'payment' && x.status === 'pending');
      if (pending.length >= 3) throw new ValidationError('We already have your payment details and are verifying them.');
      const reference = p.reference?.trim().slice(0, 80);
      if (!reference || reference.length < 4) throw new ValidationError('Enter the transaction ID / reference from your receipt.');
      const amount = money(p.amount && p.amount > 0 ? Math.min(p.amount, due) : due);

      await strapi.documents('api::payment.payment').create({
        data: { kind: 'payment', amount, method: order.paymentMethod, status: 'pending', reference, note: p.note?.trim().slice(0, 500) || null, recordedBy: 'Customer', order: order.documentId } as never,
      });
      await logEvent(order.id, 'payment', `Payment details received (ref ${reference}, Rs. ${amount.toLocaleString('en-PK')}) — awaiting verification`, { actor: 'Customer', visibleToCustomer: true });
      return { amount, reference };
    },

    /** Store confirms (or rejects) a pending customer-reported payment. */
    async verifyPayment(documentId: string, paymentId: number, approve: boolean, note?: string) {
      const order = await load(documentId);
      const payment = (order.payments ?? []).find((x) => Number(x.id) === Number(paymentId)) as unknown as { id: number; documentId: string; status: string; amount: string; reference?: string } | undefined;
      if (!payment) throw new NotFoundError('Payment not found on this order');
      if (payment.status !== 'pending') throw new ValidationError('Only pending payments can be verified.');
      await strapi.documents('api::payment.payment').update({
        documentId: payment.documentId,
        data: { status: approve ? 'completed' : 'failed', receivedAt: approve ? new Date() : null, note: note?.trim() || undefined } as never,
      });
      await recalcPayments(order.id);
      const amount = Number(payment.amount).toLocaleString('en-PK');
      await logEvent(
        order.id,
        'payment',
        approve
          ? `Payment of Rs. ${amount} verified${payment.reference ? ` (ref ${payment.reference})` : ''}`
          : `Payment reference ${payment.reference ?? ''} could not be verified${note?.trim() ? ` — ${note.trim()}` : ''}. Please contact us.`,
        { visibleToCustomer: true }
      );
      return load(documentId);
    },

    /** Customer self-service cancellation (signed-in owner, or guest with the checkout phone). */
    async cancelByCustomer(orderNumber: string, auth: { userId?: number; phone?: string }, reason?: string) {
      const order = await strapi.db.query(ORDER).findOne({ where: { orderNumber: orderNumber.trim().toUpperCase() }, populate: { customer: true, user: true } });
      const owns = order && ((auth.userId && order.user?.id === auth.userId) || (auth.phone && order.customer?.phone === auth.phone.replace(/\s/g, '')));
      if (!order || !owns) throw new NotFoundError('Order not found');
      if (!CUSTOMER_CANCELLABLE.includes(order.orderStatus)) {
        throw new ValidationError('This order is already being processed — please contact us to cancel it.');
      }
      await orders().update({ documentId: order.documentId, data: { orderStatus: 'cancelled', cancelReason: reason?.trim() || 'Cancelled by customer' } as never });
      await logEvent(order.id, 'cancel', `Cancelled by customer${reason ? ` — ${reason}` : ''}`, { actor: 'Customer', visibleToCustomer: true });
      return { ok: true };
    },
  };
}

export type OrderManager = ReturnType<typeof createOrderManager>;
