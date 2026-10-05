import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import type { PlaceOrderInput } from '../api/order/services/order';
import { sendPaymentSubmittedAlert } from '../lib/emails';
import { createOrderManager } from '../lib/order-manager';
import { customerExtension } from './customer';
import { otpExtension } from './otp';
import { quote } from '../lib/pricing';
import { getShippingRules } from '../lib/store-settings';

const { ValidationError } = errors;

type GqlContext = { state: { user?: { id: number } }; koaContext: unknown };

/**
 * Storefront GraphQL surface.
 *
 * Auto-generated (shadow CRUD) mutations are disabled for anything sensitive; the storefront
 * gets purpose-built operations instead so prices, stock and moderation stay server-side.
 */
export function registerGraphQL(strapi: Core.Strapi) {
  const ext = strapi.plugin('graphql').service('extension');

  // Read-only catalogue & content — edited only from the admin dashboard.
  for (const uid of [
    'api::product.product',
    'api::category.category',
    'api::brand.brand',
    'api::tag.tag',
    'api::banner.banner',
    'api::faq.faq',
    'api::policy.policy',
    'api::global.global',
  ]) {
    ext.shadowCRUD(uid).disableMutations();
  }
  // Never expose orders or coupon codes through generic CRUD.
  ext.shadowCRUD('api::order.order').disable();
  ext.shadowCRUD('api::coupon.coupon').disable();
  // Internal records — shipping/tax are applied server-side, timelines and payments shown via custom fields.
  for (const uid of ['api::shipping-zone.shipping-zone', 'api::shipping-method.shipping-method', 'api::tax-rate.tax-rate', 'api::order-event.order-event', 'api::payment.payment', 'api::address.address']) {
    ext.shadowCRUD(uid).disable();
  }
  // Write-only inboxes.
  for (const uid of ['api::contact-message.contact-message', 'api::newsletter-subscriber.newsletter-subscriber']) {
    ext.shadowCRUD(uid).disableQueries();
    ext.shadowCRUD(uid).disableActions(['update', 'delete']);
  }
  // Reviews are read via the API but submitted through `submitReview` (always as a draft for moderation).
  ext.shadowCRUD('api::review.review').disableActions(['create', 'update', 'delete']);

  ext.use(() => customerExtension(strapi));
  ext.use(() => otpExtension(strapi));

  ext.use(() => ({
    typeDefs: /* GraphQL */ `
      input OrderItemInput {
        productId: ID!
        "Required when the product has variants"
        variantSku: String
        quantity: Int!
      }
      input OrderCustomerInput {
        fullName: String!
        phone: String!
        email: String
      }
      input OrderAddressInput {
        province: String!
        city: String!
        address: String!
      }
      input PlaceOrderInput {
        items: [OrderItemInput!]!
        customer: OrderCustomerInput!
        shippingAddress: OrderAddressInput!
        "cod | bank | wallet"
        paymentMethod: String!
        notes: String
        couponCode: String
        "From checkoutQuote.shippingOptions (defaults to the first option)"
        shippingMethodId: ID
      }
      input CheckoutQuoteInput {
        items: [OrderItemInput!]!
        province: String!
        city: String
        couponCode: String
        shippingMethodId: ID
        paymentMethod: String
      }
      type ShippingOption {
        id: ID!
        name: String!
        description: String
        estimate: String
        fee: Float!
        codFee: Float!
      }
      type CheckoutQuote {
        subtotal: Float!
        discount: Float!
        couponMessage: String
        shippingOptions: [ShippingOption!]!
        shippingMethodId: ID
        shippingFee: Float!
        codFee: Float!
        tax: Float!
        taxLabel: String
        taxInclusive: Boolean!
        total: Float!
        deliverable: Boolean!
      }
      type PlaceOrderResult {
        orderNumber: String!
        subtotal: Float!
        discount: Float!
        shippingFee: Float!
        total: Float!
        paymentMethod: String!
      }
      type CouponCheck {
        valid: Boolean!
        code: String!
        discount: Float!
        message: String!
      }
      type TrackedOrderItem {
        productName: String!
        variantTitle: String
        sku: String
        imageUrl: String
        unitPrice: Float!
        quantity: Int!
        lineTotal: Float!
      }
      type TrackedOrder {
        orderNumber: String!
        orderStatus: String!
        paymentStatus: String!
        paymentMethod: String!
        subtotal: Float!
        discount: Float!
        shippingFee: Float!
        total: Float!
        trackingNumber: String
        courier: String
        estimatedDelivery: String
        cancelReason: String
        canCancel: Boolean!
        "Outstanding amount (total − verified payments)."
        amountDue: Float!
        "A customer-reported payment is waiting for the store to verify it."
        paymentPending: Boolean!
        "Bank/wallet order that still needs the customer's payment details."
        canSubmitPayment: Boolean!
        createdAt: String!
        items: [TrackedOrderItem!]!
        "Customer-visible timeline (newest first)"
        events: [TrackedOrderEvent!]!
      }
      type TrackedOrderEvent {
        type: String!
        message: String!
        createdAt: String!
      }
      type PaymentAccount {
        method: String!
        provider: String!
        accountTitle: String!
        accountNumber: String!
        iban: String
        instructions: String
      }
      input SubmitPaymentInput {
        orderNumber: String!
        "Required for guests; signed-in owners can omit it."
        phone: String
        reference: String!
        amount: Float
        note: String
      }
      type CancelOrderResult {
        ok: Boolean!
        message: String!
      }
      input SubmitReviewInput {
        productId: ID!
        author: String!
        rating: Int!
        title: String
        body: String!
      }
      type SubmitReviewResult {
        ok: Boolean!
        message: String!
      }

      extend type Query {
        "Totals for the checkout page: shipping options for the address, coupon, COD fee and tax."
        checkoutQuote(input: CheckoutQuoteInput!): CheckoutQuote!
        "Check a coupon against a cart subtotal before checkout."
        validateCoupon(code: String!, subtotal: Float!): CouponCheck!
        "Guest order tracking — requires the phone number used at checkout."
        trackOrder(orderNumber: String!, phone: String!): TrackedOrder
        "Orders of the signed-in customer, newest first."
        myOrders: [TrackedOrder!]!
        "Where to send advance payments (bank / JazzCash / Easypaisa), from Store settings."
        paymentAccounts(method: String): [PaymentAccount!]!
      }

      extend type Mutation {
        "Place an order. Prices, stock, coupon and shipping are computed on the server."
        placeOrder(input: PlaceOrderInput!): PlaceOrderResult!
        "Submit a product review. It is saved as a draft until approved (published) in the dashboard."
        submitReview(input: SubmitReviewInput!): SubmitReviewResult!
        "Cancel a pending/confirmed order — signed-in owner, or guest with the checkout phone number."
        cancelOrder(orderNumber: String!, phone: String, reason: String): CancelOrderResult!
        "Report a bank/wallet payment (transaction reference). It is verified by the store before it counts."
        submitPayment(input: SubmitPaymentInput!): CancelOrderResult!
      }
    `,
    resolvers: {
      Query: {
        checkoutQuote: async (_: unknown, { input }: { input: { items: PlaceOrderInput['items']; province: string; city?: string; couponCode?: string; shippingMethodId?: string; paymentMethod?: string } }) => {
          const subtotal = await strapi.service('api::order.order').priceCart(input.items ?? []);
          let discount = 0;
          let couponMessage: string | null = null;
          if (input.couponCode?.trim()) {
            const c = await strapi.service('api::coupon.coupon').evaluate(input.couponCode, subtotal);
            discount = c.valid ? c.discount : 0;
            couponMessage = c.message;
          }
          const rules = await getShippingRules(strapi);
          const restricted = rules.restrictedRegions.includes(input.province.trim().toLowerCase());
          const q = await quote(strapi, { subtotal, discount, province: input.province, city: input.city, methodId: input.shippingMethodId, paymentMethod: input.paymentMethod });
          return {
            subtotal,
            discount,
            couponMessage,
            shippingOptions: restricted ? [] : q.options,
            shippingMethodId: restricted ? null : (q.method?.id ?? null),
            shippingFee: q.shippingFee,
            codFee: q.codFee,
            tax: q.tax,
            taxLabel: q.taxLabel,
            taxInclusive: q.taxInclusive,
            total: q.total,
            deliverable: !restricted && !!q.method,
          };
        },
        validateCoupon: async (_: unknown, args: { code: string; subtotal: number }) => {
          const { couponId: _id, ...result } = await strapi.service('api::coupon.coupon').evaluate(args.code, args.subtotal);
          return result;
        },
        trackOrder: async (_: unknown, args: { orderNumber: string; phone: string }) => {
          const order = await findOrders({ orderNumber: args.orderNumber.trim().toUpperCase() }, 1);
          const phone = args.phone.replace(/\s/g, '');
          return order[0] && order[0].customer?.phone === phone ? order[0] : null;
        },
        paymentAccounts: async (_: unknown, args: { method?: string }) => {
          const g = await strapi.documents('api::global.global').findFirst({ populate: ['paymentAccounts'] });
          const list = ((g?.paymentAccounts ?? []) as { method: string; active?: boolean | null }[]).filter((a) => a.active !== false);
          return args.method ? list.filter((a) => a.method === args.method) : list;
        },
        myOrders: async (_: unknown, __: unknown, ctx: GqlContext) => {
          const userId = ctx.state.user?.id;
          return userId ? findOrders({ user: { id: userId } }, 50) : [];
        },
      },
      Mutation: {
        placeOrder: async (_: unknown, args: { input: PlaceOrderInput }, ctx: GqlContext) =>
          strapi.service('api::order.order').placeOrder(args.input, await optionalUserId(ctx)),

        cancelOrder: async (_: unknown, args: { orderNumber: string; phone?: string; reason?: string }, ctx: GqlContext) => {
          const userId = await optionalUserId(ctx);
          if (!userId && !args.phone) throw new ValidationError('Enter the phone number used at checkout.');
          await createOrderManager(strapi).cancelByCustomer(args.orderNumber, { userId, phone: args.phone }, args.reason);
          return { ok: true, message: 'Your order has been cancelled.' };
        },
        submitPayment: async (_: unknown, { input }: { input: { orderNumber: string; phone?: string; reference: string; amount?: number; note?: string } }, ctx: GqlContext) => {
          const userId = await optionalUserId(ctx);
          if (!userId && !input.phone) throw new ValidationError('Enter the phone number used at checkout.');
          const r = await createOrderManager(strapi).submitCustomerPayment(input.orderNumber, { userId, phone: input.phone ?? undefined }, input);
          setImmediate(() => void sendPaymentSubmittedAlert(strapi, input.orderNumber.trim().toUpperCase(), r.reference, r.amount));
          return { ok: true, message: `Thanks! We’ll verify your payment of Rs. ${r.amount.toLocaleString('en-PK')} and update your order shortly.` };
        },
        submitReview: async (_: unknown, { input }: { input: { productId: string; author: string; rating: number; title?: string; body: string } }) => {
          if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new ValidationError('Rating must be between 1 and 5.');
          if (!input.author?.trim() || input.author.trim().length < 2) throw new ValidationError('Please enter your name.');
          if (!input.body?.trim() || input.body.trim().length < 10) throw new ValidationError('Please write at least a few words.');
          const product = await strapi.documents('api::product.product').findOne({ documentId: input.productId, status: 'published' });
          if (!product) throw new ValidationError('Product not found.');
          await strapi.documents('api::review.review').create({
            data: {
              author: input.author.trim().slice(0, 80),
              rating: input.rating,
              title: input.title?.trim().slice(0, 120) || undefined,
              body: input.body.trim().slice(0, 2000),
              verified: false,
              product: input.productId,
            },
          });
          return { ok: true, message: 'Thanks! Your review will appear once it’s approved.' };
        },
      },
    },
    resolversConfig: {
      'Query.validateCoupon': { auth: false },
      'Query.checkoutQuote': { auth: false },
      'Query.trackOrder': { auth: false },
      // Signed-in customers only (the Authenticated role has users-permissions `me`).
      'Query.myOrders': { auth: { scope: ['plugin::users-permissions.user.me'] } },
      'Mutation.submitReview': { auth: false },
      // Guests can check out. When a customer JWT is sent, the order is linked to their account.
      'Mutation.placeOrder': { auth: false },
      'Mutation.cancelOrder': { auth: false },
      'Mutation.submitPayment': { auth: false },
      'Query.paymentAccounts': { auth: false },
    },
  }));

  /** Guest-friendly auth: returns the customer id when a valid JWT is sent, otherwise undefined. */
  async function optionalUserId(ctx: GqlContext): Promise<number | undefined> {
    if (ctx.state.user?.id) return ctx.state.user.id;
    try {
      const payload = await strapi.plugin('users-permissions').service('jwt').getToken(ctx.koaContext);
      const id = Number(payload?.id);
      if (!id) return undefined;
      const user = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { id }, select: ['id', 'blocked'] });
      return user && !user.blocked ? user.id : undefined;
    } catch {
      return undefined; // invalid/expired token → treat as guest
    }
  }

  async function findOrders(where: Record<string, unknown>, limit: number) {
    const orders = await strapi.db.query('api::order.order').findMany({
      where,
      orderBy: { createdAt: 'desc' },
      limit,
      populate: { items: true, customer: true, payments: { select: ['kind', 'status'] }, events: { where: { visibleToCustomer: true }, orderBy: { createdAt: 'desc' } } },
    });
    return orders.map((o: Record<string, any>): Record<string, any> => ({
      ...o,
      createdAt: new Date(o.createdAt).toISOString(),
      estimatedDelivery: o.estimatedDelivery ? String(o.estimatedDelivery) : null,
      canCancel: ['pending', 'confirmed'].includes(o.orderStatus),
      ...(() => {
        const amountDue = Math.max(0, Math.round((Number(o.total) - Number(o.paidAmount ?? 0)) * 100) / 100);
        const paymentPending = (o.payments ?? []).some((p: { kind: string; status: string }) => p.kind === 'payment' && p.status === 'pending');
        const active = !['cancelled', 'returned'].includes(o.orderStatus);
        return { amountDue, paymentPending, canSubmitPayment: active && amountDue > 0 && !paymentPending && ['bank', 'wallet'].includes(o.paymentMethod) };
      })(),
      payments: undefined,
      events: (o.events ?? []).map((e: Record<string, any>) => ({ type: e.type, message: e.message, createdAt: new Date(e.createdAt).toISOString() })),
      subtotal: Number(o.subtotal),
      discount: Number(o.discount ?? 0),
      shippingFee: Number(o.shippingFee ?? 0),
      total: Number(o.total),
      items: (o.items ?? []).map((i: Record<string, any>) => ({
        ...i,
        unitPrice: Number(i.unitPrice),
        lineTotal: Number(i.lineTotal),
      })),
    }));
  }
}
