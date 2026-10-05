import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { sendNewOrderEmails } from '../../../lib/emails';
import { createOrderManager } from '../../../lib/order-manager';
import { adjustVariantStock, lockPublishedVariant } from '../../../lib/variant-stock';
import { quote } from '../../../lib/pricing';
import { getShippingRules, money } from '../../../lib/store-settings';

const { ValidationError } = errors;

const PRODUCT = 'api::product.product';
const ORDER = 'api::order.order';
const PAYMENT_METHODS = ['cod', 'bank', 'wallet'] as const;
const RESTOCK_STATUSES = ['cancelled', 'returned'];

export interface PlaceOrderInput {
  items: { productId: string; variantSku?: string | null; quantity: number }[];
  customer: { fullName: string; phone: string; email?: string | null };
  shippingAddress: { province: string; city: string; address: string };
  paymentMethod: (typeof PAYMENT_METHODS)[number];
  notes?: string | null;
  couponCode?: string | null;
  shippingMethodId?: string | null;
}

const PHONE_RE = /^(\+92|0)3\d{2}-?\d{7}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(input: PlaceOrderInput) {
  const errs: string[] = [];
  if (!Array.isArray(input.items) || input.items.length === 0) errs.push('Your cart is empty.');
  if (input.items?.length > 50) errs.push('Too many items in one order.');
  for (const i of input.items ?? []) {
    if (!i.productId || !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 99) {
      errs.push('Invalid item quantity.');
      break;
    }
  }
  const c = input.customer ?? ({} as PlaceOrderInput['customer']);
  if (!c.fullName || c.fullName.trim().length < 3) errs.push('Please enter your full name.');
  if (!c.phone || !PHONE_RE.test(c.phone.replace(/\s/g, ''))) errs.push('Enter a valid mobile number, e.g. 03001234567.');
  if (c.email && !EMAIL_RE.test(c.email)) errs.push('Enter a valid email address.');
  const a = input.shippingAddress ?? ({} as PlaceOrderInput['shippingAddress']);
  if (!a.province?.trim()) errs.push('Select your province.');
  if (!a.city || a.city.trim().length < 2) errs.push('Enter your city.');
  if (!a.address || a.address.trim().length < 10) errs.push('Please enter your complete address.');
  if (!PAYMENT_METHODS.includes(input.paymentMethod)) errs.push('Choose a payment method.');
  if (errs.length) throw new ValidationError(errs[0], { errors: errs });
}

function generateOrderNumber() {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `VT-${ymd}-${rand}`;
}

export default factories.createCoreService(ORDER, ({ strapi }) => ({
  /**
   * Creates an order from a storefront cart. Prices, stock and shipping are always computed
   * here from the database — values sent by the browser are never trusted.
   */
  async placeOrder(input: PlaceOrderInput, userId?: number) {
    validate(input);

    const rules = await getShippingRules(strapi);
    if (rules.restrictedRegions.includes(input.shippingAddress.province.trim().toLowerCase())) {
      throw new ValidationError(`Sorry, we don’t deliver to ${input.shippingAddress.province} yet.`);
    }

    // Merge duplicate lines for the same product + variant.
    const lines = new Map<string, { productId: string; variantSku?: string; quantity: number }>();
    for (const i of input.items) {
      const variantSku = i.variantSku?.trim() || undefined;
      const key = `${i.productId}::${variantSku ?? ''}`;
      const prev = lines.get(key);
      lines.set(key, { productId: i.productId, variantSku, quantity: (prev?.quantity ?? 0) + i.quantity });
    }
    const ids = [...new Set([...lines.values()].map((l) => l.productId))];

    const meta = strapi.db.metadata.get(PRODUCT);
    const col = (attr: string) => (meta.attributes[attr] as { columnName?: string }).columnName ?? attr;
    const T = meta.tableName;

    const result = await strapi.db.transaction(async ({ trx }) => {
      // Lock the published product rows so concurrent checkouts can't oversell.
      const rows: { id: number; document_id: string; stock: number }[] = await trx(T)
        .select({ id: 'id', document_id: col('documentId'), stock: col('stock') })
        .whereIn(col('documentId'), ids)
        .whereNotNull(col('publishedAt'))
        .forUpdate();

      const products = await strapi.documents(PRODUCT).findMany({
        filters: { documentId: { $in: ids } },
        status: 'published',
        populate: { images: { fields: ['url'] }, variants: { populate: { image: { fields: ['url'] } } } },
      });

      // Total quantity per simple product (variants have their own stock rows).
      const simpleQty = new Map<string, number>();
      const items = [];
      for (const { productId, variantSku, quantity } of lines.values()) {
        const product = products.find((p) => p.documentId === productId);
        const row = rows.find((r) => r.document_id === productId);
        if (!product || !row) throw new ValidationError('A product in your cart is no longer available.');
        const variants = (product.variants ?? []) as { sku: string; title: string; price: number | string; image?: { url: string } | null }[];

        if (variants.length) {
          const variant = variants.find((v) => v.sku === variantSku);
          if (!variant) throw new ValidationError(`Please choose an option for “${product.name}”.`);
          const locked = await lockPublishedVariant(trx, productId, variant.sku);
          const stock = locked?.stock ?? 0;
          if (stock < quantity) {
            throw new ValidationError(stock > 0 ? `Only ${stock} left of “${product.name} — ${variant.title}”.` : `“${product.name} — ${variant.title}” is out of stock.`);
          }
          const unitPrice = money(Number(variant.price));
          items.push({
            product,
            quantity,
            variantSku: variant.sku,
            line: {
              product: product.documentId,
              productName: product.name as string,
              variantTitle: variant.title,
              variantSku: variant.sku,
              sku: variant.sku,
              imageUrl: variant.image?.url ?? (product.images as { url: string }[] | undefined)?.[0]?.url,
              unitPrice,
              quantity,
              lineTotal: unitPrice * quantity,
            },
          });
          continue;
        }

        const total = (simpleQty.get(productId) ?? 0) + quantity;
        simpleQty.set(productId, total);
        if (row.stock < total) {
          throw new ValidationError(row.stock > 0 ? `Only ${row.stock} left of “${product.name}”.` : `“${product.name}” is out of stock.`);
        }
        const unitPrice = money(Number(product.price));
        items.push({
          product,
          quantity,
          variantSku: undefined as string | undefined,
          line: {
            product: product.documentId,
            productName: product.name as string,
            sku: product.sku as string,
            imageUrl: (product.images as { url: string }[] | undefined)?.[0]?.url,
            unitPrice,
            quantity,
            lineTotal: unitPrice * quantity,
          },
        });
      }

      const subtotal = items.reduce((n, i) => n + i.line.lineTotal, 0);

      let discount = 0;
      let couponCode: string | undefined;
      if (input.couponCode?.trim()) {
        const result = await strapi.service('api::coupon.coupon').evaluate(input.couponCode, subtotal);
        if (!result.valid) throw new ValidationError(result.message);
        discount = result.discount;
        couponCode = result.code;
        const couponMeta = strapi.db.metadata.get('api::coupon.coupon');
        const usedCol = (couponMeta.attributes.usedCount as { columnName?: string }).columnName ?? 'used_count';
        await trx(couponMeta.tableName).where('id', result.couponId).increment(usedCol, 1);
      }

      const q = await quote(strapi, {
        subtotal,
        discount,
        province: input.shippingAddress.province,
        city: input.shippingAddress.city,
        methodId: input.shippingMethodId,
        paymentMethod: input.paymentMethod,
      });
      if (!q.method) throw new ValidationError(`Sorry, we don’t deliver to ${input.shippingAddress.city}, ${input.shippingAddress.province} yet.`);
      const { shippingFee, total } = q;

      // Decrement stock on draft + published rows (they share a documentId / variant SKU).
      for (const { product, quantity, variantSku } of items) {
        if (variantSku) await adjustVariantStock(trx, product.documentId, variantSku, -quantity);
        else await trx(T).where(col('documentId'), product.documentId).decrement(col('stock'), quantity);
      }

      let orderNumber = generateOrderNumber();
      while (await strapi.db.query(ORDER).findOne({ where: { orderNumber } })) orderNumber = generateOrderNumber();

      const order = await strapi.documents(ORDER).create({
        data: {
          orderNumber,
          orderStatus: 'pending',
          paymentMethod: input.paymentMethod,
          paymentStatus: 'unpaid',
          customer: {
            fullName: input.customer.fullName.trim(),
            phone: input.customer.phone.replace(/\s/g, ''),
            email: input.customer.email?.trim() || undefined,
          },
          shippingAddress: {
            province: input.shippingAddress.province.trim(),
            city: input.shippingAddress.city.trim(),
            address: input.shippingAddress.address.trim(),
          },
          items: items.map((i) => i.line),
          notes: input.notes?.trim() || undefined,
          subtotal,
          discount,
          shippingFee,
          shippingMethod: q.method.name,
          codFee: q.codFee,
          tax: q.tax,
          taxLabel: q.taxLabel ?? undefined,
          taxInclusive: q.taxInclusive,
          total,
          couponCode,
          ...(userId ? { user: userId } : {}),
        },
      });

      strapi.log.info(`[orders] ${orderNumber} placed — Rs. ${total} (${items.length} line(s))`);
      return { orderNumber: order.orderNumber as string, subtotal, discount, shippingFee, total, paymentMethod: order.paymentMethod };
    });

    const created = await strapi.db.query(ORDER).findOne({ where: { orderNumber: result.orderNumber }, select: ['id'] });
    if (created) {
      await createOrderManager(strapi).logEvent(created.id, 'created', `Order placed — Rs. ${result.total.toLocaleString('en-PK')} (${input.paymentMethod})`, {
        actor: userId ? 'Customer (signed in)' : 'Customer (guest)',
        visibleToCustomer: true,
      });
    }
    // After commit, off the request path: confirmation to the customer + alert to the store.
    setImmediate(() => void sendNewOrderEmails(strapi, result.orderNumber));
    return result;
  },

  /** Prices a cart from the database (published prices, variant-aware) — used by the checkout quote. */
  async priceCart(items: PlaceOrderInput['items']) {
    const ids = [...new Set(items.map((i) => i.productId))];
    const products = await strapi.documents(PRODUCT).findMany({ filters: { documentId: { $in: ids } }, status: 'published', populate: { variants: true } });
    let subtotal = 0;
    for (const item of items) {
      const product = products.find((p) => p.documentId === item.productId);
      if (!product) continue;
      const variants = (product.variants ?? []) as { sku: string; price: number | string }[];
      const variant = variants.find((v) => v.sku === item.variantSku);
      const unit = variants.length ? (variant ? Number(variant.price) : 0) : Number(product.price);
      subtotal += money(unit) * Math.max(1, Math.min(99, item.quantity));
    }
    return subtotal;
  },

  /** Puts stock back when an order is cancelled or returned (runs once per order). */
  async restockIfNeeded(orderId: number) {
    const order = await strapi.db.query(ORDER).findOne({ where: { id: orderId }, select: ['orderStatus', 'stockRestored', 'orderNumber'] });
    if (!order || order.stockRestored || !RESTOCK_STATUSES.includes(order.orderStatus)) return;
    const manager = createOrderManager(strapi);
    if (await manager.restockItems(orderId)) {
      await manager.logEvent(orderId, 'status', 'Items returned to stock');
      strapi.log.info(`[orders] ${order.orderNumber} ${order.orderStatus} — stock restored`);
    }
  },

}));
