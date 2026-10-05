import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { createOrderManager, ORDER_STATUSES, type OrderStatus } from '../lib/order-manager';
import { PRINT_SIZES, PRINT_TYPES, renderPrint, type PrintableOrder, type PrintSize, type PrintType } from '../lib/print-documents';

type Ctx = {
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  request: { body: Record<string, any> };
  body: unknown;
  status: number;
  type: string;
  set: (k: string, v: string) => void;
};

// Same permissions as viewing / editing orders in the content manager.
const CAN_READ = { name: 'admin::hasPermissions', config: { actions: [['plugin::content-manager.explorer.read', 'api::order.order']] } };
const CAN_UPDATE = { name: 'admin::hasPermissions', config: { actions: [['plugin::content-manager.explorer.update', 'api::order.order']] } };

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const rs = (n: unknown) => `Rs. ${Math.round(Number(n ?? 0)).toLocaleString('en-PK')}`;

/** Admin-only endpoints for the "Orders" manager page (src/admin/pages/orders). */
export function registerOrderRoutes(strapi: Core.Strapi) {
  const manager = createOrderManager(strapi);

  /** Wraps handlers: validation errors → 400 with a readable message. */
  const handle = (fn: (ctx: Ctx) => Promise<unknown>) => async (ctx: Ctx) => {
    try {
      const result = await fn(ctx);
      if (result !== undefined) ctx.body = result;
    } catch (error) {
      if (error instanceof errors.ValidationError || error instanceof errors.NotFoundError) {
        ctx.status = error instanceof errors.NotFoundError ? 404 : 400;
        ctx.body = { error: { message: error.message } };
        return;
      }
      throw error;
    }
  };

  function buildWhere(q: Ctx['query']) {
    const and: Record<string, unknown>[] = [];
    if (q.status && q.status !== 'all') and.push({ orderStatus: q.status });
    if (q.payment) and.push({ paymentStatus: q.payment });
    if (q.method) and.push({ paymentMethod: q.method });
    if (q.verify) and.push({ payments: { kind: 'payment', status: 'pending' } });
    if (q.from) and.push({ createdAt: { $gte: new Date(q.from) } });
    if (q.to) and.push({ createdAt: { $lte: new Date(`${q.to}T23:59:59`) } });
    const term = q.q?.trim();
    if (term) {
      and.push({
        $or: [
          { orderNumber: { $containsi: term } },
          { customer: { fullName: { $containsi: term } } },
          { customer: { phone: { $containsi: term.replace(/\s/g, '') } } },
          { customer: { email: { $containsi: term } } },
          { shippingAddress: { city: { $containsi: term } } },
          { trackingNumber: { $containsi: term } },
        ],
      });
    }
    return and.length ? { $and: and } : {};
  }

  const listOrders = async (ctx: Ctx) => {
    const page = Math.max(1, Number(ctx.query.page ?? 1));
    const pageSize = Math.min(100, Math.max(5, Number(ctx.query.pageSize ?? 20)));
    const where = buildWhere(ctx.query);
    const db = strapi.db.query('api::order.order');
    const [rows, total, counts, awaitingVerification] = await Promise.all([
      db.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        offset: (page - 1) * pageSize,
        limit: pageSize,
        populate: { customer: true, shippingAddress: true, items: true, payments: { where: { kind: 'payment', status: 'pending' }, select: ['id'] } },
      }),
      db.count({ where }),
      Promise.all(ORDER_STATUSES.map(async (s) => [s, await db.count({ where: { ...buildWhere({ ...ctx.query, status: undefined }), orderStatus: s } })] as const)),
      db.count({ where: { payments: { kind: 'payment', status: 'pending' } } }),
    ]);
    return {
      data: rows.map((o: Record<string, any>) => ({
        documentId: o.documentId,
        orderNumber: o.orderNumber,
        createdAt: o.createdAt,
        customer: o.customer?.fullName ?? '—',
        phone: o.customer?.phone ?? '',
        city: o.shippingAddress?.city ?? '',
        items: (o.items ?? []).reduce((n: number, i: { quantity: number }) => n + i.quantity, 0),
        total: Number(o.total),
        orderStatus: o.orderStatus,
        paymentStatus: o.paymentStatus,
        paymentMethod: o.paymentMethod,
        awaitingVerification: (o.payments ?? []).length > 0,
      })),
      meta: { page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)), counts: Object.fromEntries(counts), awaitingVerification },
    };
  };

  const exportCsv = async (ctx: Ctx) => {
    const rows = await strapi.db.query('api::order.order').findMany({
      where: buildWhere(ctx.query),
      orderBy: { createdAt: 'desc' },
      limit: 5000,
      populate: { customer: true, shippingAddress: true, items: true },
    });
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Order #', 'Date', 'Status', 'Payment', 'Method', 'Customer', 'Phone', 'Email', 'Province', 'City', 'Address', 'Items', 'Subtotal', 'Discount', 'Shipping', 'Total', 'Paid', 'Refunded', 'Coupon', 'Courier', 'Tracking #'];
    const lines = rows.map((o: Record<string, any>) =>
      [
        o.orderNumber,
        new Date(o.createdAt).toISOString().slice(0, 16).replace('T', ' '),
        o.orderStatus,
        o.paymentStatus,
        o.paymentMethod,
        o.customer?.fullName,
        o.customer?.phone,
        o.customer?.email,
        o.shippingAddress?.province,
        o.shippingAddress?.city,
        o.shippingAddress?.address,
        (o.items ?? []).map((i: { quantity: number; productName: string }) => `${i.quantity}× ${i.productName}`).join('; '),
        Number(o.subtotal),
        Number(o.discount ?? 0),
        Number(o.shippingFee ?? 0),
        Number(o.total),
        Number(o.paidAmount ?? 0),
        Number(o.refundedAmount ?? 0),
        o.couponCode,
        o.courier,
        o.trackingNumber,
      ]
        .map(cell)
        .join(',')
    );
    ctx.set('Content-Disposition', `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"`);
    ctx.type = 'text/csv; charset=utf-8';
    return '﻿' + [header.map(cell).join(','), ...lines].join('\n');
  };

  /** ?type=label|dispatch|packing|invoice &size=4x6|80mm|a4 — returns printable HTML. */
  const printOptions = (q: Ctx['query']) => ({
    type: (PRINT_TYPES as readonly string[]).includes(q.type ?? '') ? (q.type as PrintType) : 'invoice',
    size: (PRINT_SIZES as readonly string[]).includes(q.size ?? '') ? (q.size as PrintSize) : '4x6',
  });

  const printable = async (ctx: Ctx) => {
    const { type, size } = printOptions(ctx.query);
    const order = await manager.load(ctx.params.id);
    ctx.type = 'text/html; charset=utf-8';
    return renderPrint(strapi, [order as unknown as PrintableOrder], type, size);
  };

  /** Several orders in one document (one per page) — e.g. labels for today's dispatch. */
  const printBatch = async (ctx: Ctx) => {
    const { type, size } = printOptions(ctx.query);
    const ids = (ctx.query.ids ?? '').split(',').filter(Boolean).slice(0, 200);
    if (!ids.length) throw new errors.ValidationError('Select at least one order.');
    const orders = (await Promise.all(ids.map((id) => manager.load(id).catch(() => null)))).filter(Boolean);
    ctx.type = 'text/html; charset=utf-8';
    return renderPrint(strapi, orders as unknown as PrintableOrder[], type, size);
  };

  const route = (method: 'GET' | 'POST', path: string, handler: (ctx: Ctx) => Promise<unknown>, policy = CAN_UPDATE) => ({
    method,
    path,
    handler: handle(handler),
    info: { type: 'admin' },
    config: { policies: ['admin::isAuthenticatedAdmin', policy] },
  });

  strapi.server.routes({
    type: 'admin',
    prefix: '/store-dashboard',
    routes: [
      route('GET', '/orders', listOrders, CAN_READ),
      route('GET', '/orders/export.csv', exportCsv, CAN_READ),
      route('GET', '/orders/print-batch', printBatch, CAN_READ),
      route('GET', '/orders/:id', (ctx) => manager.load(ctx.params.id), CAN_READ),
      route('GET', '/orders/:id/print', printable, CAN_READ),
      route('POST', '/orders/bulk-status', async (ctx) => {
        const { documentIds, status, notify } = ctx.request.body;
        if (!Array.isArray(documentIds) || !documentIds.length) throw new errors.ValidationError('Select at least one order.');
        return manager.bulkStatus(documentIds, status as OrderStatus, notify !== false);
      }),
      route('POST', '/orders/:id/status', (ctx) => {
        const b = ctx.request.body;
        return manager.changeStatus(ctx.params.id, b.status, { note: b.note, notify: b.notify !== false, collectCod: !!b.collectCod, reason: b.reason });
      }),
      route('POST', '/orders/:id/shipping', (ctx) => manager.updateShipping(ctx.params.id, ctx.request.body)),
      route('POST', '/orders/:id/payments', (ctx) => manager.recordPayment(ctx.params.id, ctx.request.body as never)),
      route('POST', '/orders/:id/payments/:paymentId/verify', (ctx) => {
        const body = ctx.request.body as { approve?: boolean; note?: string };
        return manager.verifyPayment(ctx.params.id, Number(ctx.params.paymentId), body.approve !== false, body.note);
      }),
      route('POST', '/orders/:id/refunds', (ctx) => manager.refund(ctx.params.id, ctx.request.body as never)),
      route('POST', '/orders/:id/notes', (ctx) => manager.addNote(ctx.params.id, ctx.request.body.message, !!ctx.request.body.visibleToCustomer)),
    ] as never,
  });
}
