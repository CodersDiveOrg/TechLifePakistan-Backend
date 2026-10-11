import type { Core } from '@strapi/strapi';

type ListConfig = { list?: string[]; mainField?: string; sortBy?: string; sortOrder?: 'ASC' | 'DESC'; pageSize?: number };

/** Table columns for each content type in the admin, chosen to match what the storefront shows. */
const LAYOUTS: Record<string, ListConfig> = {
  'api::product.product': { list: ['name', 'sku', 'price', 'stock', 'category', 'brand', 'isFeatured'], mainField: 'name', sortBy: 'name', sortOrder: 'ASC' },
  'api::order.order': { list: ['orderNumber', 'orderStatus', 'paymentStatus', 'paymentMethod', 'total', 'createdAt'], mainField: 'orderNumber', sortBy: 'createdAt', sortOrder: 'DESC', pageSize: 20 },
  'api::category.category': { list: ['name', 'slug', 'sortOrder', 'products'], mainField: 'name', sortBy: 'sortOrder', sortOrder: 'ASC' },
  'api::brand.brand': { list: ['name', 'slug', 'logo', 'products'], mainField: 'name', sortBy: 'name', sortOrder: 'ASC' },
  'api::review.review': { list: ['author', 'rating', 'product', 'verified', 'createdAt'], mainField: 'author', sortBy: 'createdAt', sortOrder: 'DESC' },
  'api::banner.banner': { list: ['title', 'placement', 'theme', 'sortOrder', 'image'], mainField: 'title', sortBy: 'sortOrder', sortOrder: 'ASC' },
  'api::coupon.coupon': { list: ['code', 'discountType', 'value', 'usedCount', 'usageLimit', 'active', 'endsAt', 'owner'], mainField: 'code', sortBy: 'createdAt', sortOrder: 'DESC' },
  'api::referral.referral': { list: ['referrer', 'referee', 'referralStatus', 'orderNumber', 'qualifiedAt'], sortBy: 'createdAt', sortOrder: 'DESC', pageSize: 20 },
  'api::faq.faq': { list: ['question', 'group', 'sortOrder'], mainField: 'question', sortBy: 'sortOrder', sortOrder: 'ASC' },
  'api::policy.policy': { list: ['title', 'slug', 'updatedAt'], mainField: 'title' },
  'api::contact-message.contact-message': { list: ['name', 'phone', 'subject', 'handled', 'createdAt'], mainField: 'subject', sortBy: 'createdAt', sortOrder: 'DESC' },
  'api::newsletter-subscriber.newsletter-subscriber': { list: ['email', 'createdAt'], mainField: 'email', sortBy: 'createdAt', sortOrder: 'DESC' },
  'api::tag.tag': { list: ['name', 'slug', 'products'], mainField: 'name', sortBy: 'name', sortOrder: 'ASC' },
  'api::shipping-zone.shipping-zone': { list: ['name', 'priority', 'active', 'methods'], mainField: 'name', sortBy: 'priority', sortOrder: 'DESC' },
  'api::shipping-method.shipping-method': { list: ['name', 'zone', 'rate', 'freeOver', 'codFee', 'estimate', 'active'], mainField: 'name', sortBy: 'sortOrder', sortOrder: 'ASC' },
  'api::tax-rate.tax-rate': { list: ['name', 'rate', 'inclusive', 'appliesToShipping', 'active'], mainField: 'name' },
  'api::payment.payment': { list: ['kind', 'amount', 'method', 'status', 'reference', 'order', 'createdAt'], mainField: 'reference', sortBy: 'createdAt', sortOrder: 'DESC' },
  // Single type — edit-view labels/help only.
  'api::referral-program.referral-program': {},
  'api::order-event.order-event': { list: ['type', 'message', 'actor', 'order', 'createdAt'], mainField: 'message', sortBy: 'createdAt', sortOrder: 'DESC' },
};

/** Human-friendly field labels (list + edit views). */
const LABELS: Record<string, string> = {
  orderNumber: 'Order #',
  orderStatus: 'Status',
  paymentStatus: 'Payment',
  paymentMethod: 'Method',
  shippingFee: 'Shipping fee',
  couponCode: 'Coupon',
  trackingNumber: 'Tracking #',
  shippingAddress: 'Shipping address',
  isFeatured: 'Featured',
  isNew: 'New',
  isBestseller: 'Best seller',
  isFlashSale: 'Flash sale',
  compareAtPrice: 'Compare-at price (was)',
  shortDescription: 'Short description',
  lowStockThreshold: 'Low-stock alert at',
  reviewCount: 'Reviews',
  sortOrder: 'Order',
  discountType: 'Type',
  usedCount: 'Used',
  usageLimit: 'Limit',
  minSubtotal: 'Min. subtotal',
  maxDiscount: 'Max. discount',
  startsAt: 'Starts',
  endsAt: 'Ends',
  ctaLabel: 'Button label',
  ctaHref: 'Button link',
  createdAt: 'Placed',
  sku: 'SKU',
  freeOver: 'Free over',
  codFee: 'COD fee',
  appliesToShipping: 'Taxes shipping',
  paidAmount: 'Paid',
  refundedAmount: 'Refunded',
  estimatedDelivery: 'ETA',
  relatedProducts: 'Related products',
  referralStatus: 'Status',
  qualifiedAt: 'Qualified',
  referralsRequired: 'Friends needed per reward',
  qualifyOn: 'A referral counts when',
  rewardType: 'Reward type',
  rewardValue: 'Reward value',
  rewardValidDays: 'Reward valid for (days)',
  repeatable: 'Repeatable (a new reward every N friends)',
};

/** Help text under fields in the edit view. */
const DESCRIPTIONS: Record<string, Record<string, string>> = {
  'api::referral-program.referral-program': {
    enabled: 'Show “Refer & earn” in customer accounts and accept referral links.',
    referralsRequired: 'How many invited friends must qualify before the customer earns a reward (e.g. 5).',
    qualifyOn: 'first_delivered_order (recommended): the friend’s first order must be delivered. signup: counts as soon as the friend creates an account (easy to abuse with fake sign-ups).',
    rewardType: 'percent = % off the cart, fixed = rupees off.',
    rewardValue: 'Discount amount — percent or rupees, depending on the reward type.',
    maxDiscount: 'Optional cap for percent rewards (rupees).',
    minSubtotal: 'Minimum cart subtotal for the reward coupon to apply.',
    rewardValidDays: 'Reward coupons expire after this many days. Leave empty for no expiry.',
    repeatable: 'On: a new reward every N friends (5, 10, 15…). Off: one reward only.',
    terms: 'Optional terms shown to customers under the referral link.',
  },
  'api::coupon.coupon': {
    owner: 'Optional. When set, only this customer can use the coupon (referral rewards are created this way).',
    source: 'referral = created automatically by the referral program.',
  },
};

/** Applies the list layouts once (marker stored in the core store) so later admin tweaks are kept. */
export async function applyAdminLayouts(strapi: Core.Strapi) {
  const store = strapi.store({ type: 'app', name: 'techlifepakistan' });
  const VERSION = 4;
  if ((await store.get({ key: 'admin-layouts-version' })) === VERSION) return;

  const service = strapi.plugin('content-manager').service('content-types');
  for (const [uid, cfg] of Object.entries(LAYOUTS)) {
    if (!strapi.contentTypes[uid as keyof typeof strapi.contentTypes]) continue;
    const current = await service.findConfiguration({ uid });
    const { uid: _uid, ...configuration } = current;
    await service.updateConfiguration(
      { uid },
      {
        ...configuration,
        settings: {
          ...configuration.settings,
          ...(cfg.mainField && { mainField: cfg.mainField }),
          ...(cfg.sortBy && { defaultSortBy: cfg.sortBy, defaultSortOrder: cfg.sortOrder ?? 'ASC' }),
          ...(cfg.pageSize && { pageSize: cfg.pageSize }),
        },
        layouts: { ...configuration.layouts, ...(cfg.list && { list: cfg.list }) },
        metadatas: Object.fromEntries(
          Object.entries(configuration.metadatas ?? {}).map(([field, meta]: [string, any]) => {
            const label = uid === 'api::referral.referral' && field === 'createdAt' ? 'Joined' : LABELS[field];
            const description = DESCRIPTIONS[uid]?.[field];
            if (!label && !description) return [field, meta];
            return [
              field,
              {
                ...meta,
                list: { ...meta.list, ...(label && { label }) },
                edit: { ...meta.edit, ...(label && { label }), ...(description && { description }) },
              },
            ];
          })
        ),
      }
    );
  }
  await store.set({ key: 'admin-layouts-version', value: VERSION });
  strapi.log.info('[setup] applied admin list layouts');
}
