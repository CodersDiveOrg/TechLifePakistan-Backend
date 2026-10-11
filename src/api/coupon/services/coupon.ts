import { factories } from '@strapi/strapi';
import { money } from '../../../lib/store-settings';

export interface CouponResult {
  valid: boolean;
  code: string;
  discount: number;
  message: string;
  couponId?: number;
}

export default factories.createCoreService('api::coupon.coupon', ({ strapi }) => ({
  /** Checks a coupon code against a cart subtotal and returns the discount it gives. Never throws. */
  async evaluate(rawCode: string, subtotal: number, userId?: number): Promise<CouponResult> {
    const code = (rawCode ?? '').trim().toUpperCase();
    const fail = (message: string): CouponResult => ({ valid: false, code, discount: 0, message });
    if (!code) return fail('Enter a coupon code.');

    const coupon = await strapi.db.query('api::coupon.coupon').findOne({ where: { code }, populate: { owner: { select: ['id'] } } });
    if (!coupon || !coupon.active) return fail('This coupon code is not valid.');
    // Personal coupons (e.g. referral rewards) only work for their owner's account.
    if (coupon.owner) {
      if (!userId) return fail('Sign in to use this coupon.');
      if (coupon.owner.id !== userId) return fail('This coupon belongs to another account.');
    }

    const now = Date.now();
    if (coupon.startsAt && new Date(coupon.startsAt).getTime() > now) return fail('This coupon is not active yet.');
    if (coupon.endsAt && new Date(coupon.endsAt).getTime() < now) return fail('This coupon has expired.');
    if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) return fail('This coupon has reached its usage limit.');

    const min = Number(coupon.minSubtotal ?? 0);
    if (subtotal < min) return fail(`Spend at least Rs. ${min.toLocaleString('en-PK')} to use this coupon.`);

    let discount = coupon.discountType === 'percent' ? (subtotal * Number(coupon.value)) / 100 : Number(coupon.value);
    if (coupon.maxDiscount != null) discount = Math.min(discount, Number(coupon.maxDiscount));
    discount = money(Math.min(discount, subtotal));

    return {
      valid: true,
      code,
      discount,
      couponId: coupon.id,
      message: `Coupon applied — you save Rs. ${discount.toLocaleString('en-PK')}.`,
    };
  },
}));
