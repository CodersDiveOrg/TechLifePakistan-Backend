import { randomInt } from 'node:crypto';
import type { Core } from '@strapi/strapi';
import { sendReferralRewardEmail } from './emails';
import { afterCommit } from './order-manager';

/**
 * Refer-a-friend engine.
 *
 * - Every customer gets a personal code (`/?ref=CODE` links); a new account that signs up through one is
 *   recorded as a pending Referral.
 * - The referral qualifies when the friend's first order is delivered (or right away, when the
 *   "Referral program" settings say "signup").
 * - Each time a customer reaches `referralsRequired` qualified referrals, they get a single-use coupon
 *   locked to their account. Rewards are recomputed from the counts, so issuing is idempotent.
 */

const USER = 'plugin::users-permissions.user';
const REFERRAL = 'api::referral.referral';
const COUPON = 'api::coupon.coupon';
const ORDER = 'api::order.order';
/** Only accounts this new (and without orders) can be credited to a referrer. */
const CLAIM_WINDOW_DAYS = 7;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export const REFERRAL_CODE_RE = /^[A-Z0-9]{4,16}$/;

export interface ReferralProgram {
  enabled: boolean;
  referralsRequired: number;
  qualifyOn: 'first_delivered_order' | 'signup';
  rewardType: 'percent' | 'fixed';
  rewardValue: number;
  maxDiscount: number | null;
  minSubtotal: number;
  rewardValidDays: number | null;
  repeatable: boolean;
  terms: string | null;
  popup: { enabled: boolean; title: string | null; text: string | null; delaySeconds: number; frequencyDays: number };
}

const randomCode = (length: number) => Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
const rs = (n: number) => `Rs. ${Math.round(n).toLocaleString('en-PK')}`;

export async function getReferralProgram(strapi: Core.Strapi): Promise<ReferralProgram> {
  const p = (await strapi.db.query('api::referral-program.referral-program').findOne({})) as Record<string, any> | null;
  return {
    enabled: !!p?.enabled,
    referralsRequired: Math.max(1, Number(p?.referralsRequired ?? 5)),
    qualifyOn: p?.qualifyOn === 'signup' ? 'signup' : 'first_delivered_order',
    rewardType: p?.rewardType === 'fixed' ? 'fixed' : 'percent',
    rewardValue: Number(p?.rewardValue ?? 0),
    maxDiscount: p?.maxDiscount != null ? Number(p.maxDiscount) : null,
    minSubtotal: Number(p?.minSubtotal ?? 0),
    rewardValidDays: p?.rewardValidDays ? Number(p.rewardValidDays) : null,
    repeatable: p?.repeatable !== false,
    terms: p?.terms ?? null,
    popup: {
      enabled: p?.popupEnabled !== false,
      title: p?.popupTitle || null,
      text: p?.popupText || null,
      delaySeconds: Number(p?.popupDelaySeconds ?? 5),
      frequencyDays: Math.max(0, Number(p?.popupFrequencyDays ?? 0)),
    },
  };
}

/** "10% off (up to Rs. 2,000) on orders over Rs. 5,000" */
export function describeReward(r: { rewardType?: string; discountType?: string; rewardValue?: number; value?: number | string; maxDiscount?: number | string | null; minSubtotal?: number | string | null }) {
  const type = r.rewardType ?? r.discountType;
  const value = Number(r.rewardValue ?? r.value ?? 0);
  let text = type === 'percent' ? `${value}% off` : `${rs(value)} off`;
  if (type === 'percent' && r.maxDiscount != null) text += ` (up to ${rs(Number(r.maxDiscount))})`;
  if (Number(r.minSubtotal ?? 0) > 0) text += ` on orders over ${rs(Number(r.minSubtotal))}`;
  return text;
}

/** The customer's personal referral code, created on first use. */
export async function ensureReferralCode(strapi: Core.Strapi, userId: number): Promise<string> {
  const user = await strapi.db.query(USER).findOne({ where: { id: userId }, select: ['referralCode'] });
  if (user?.referralCode) return user.referralCode;
  for (;;) {
    const code = randomCode(8);
    if (await strapi.db.query(USER).findOne({ where: { referralCode: code }, select: ['id'] })) continue;
    await strapi.db.query(USER).update({ where: { id: userId }, data: { referralCode: code } });
    return code;
  }
}

/** Credits a newly created account to the owner of `rawCode`. Never throws for business-rule failures. */
export async function claimReferral(strapi: Core.Strapi, refereeId: number, rawCode: string): Promise<{ ok: boolean; message: string }> {
  const fail = (message: string) => ({ ok: false, message });
  const program = await getReferralProgram(strapi);
  if (!program.enabled) return fail('The referral program is not running right now.');

  const code = (rawCode ?? '').trim().toUpperCase();
  if (!REFERRAL_CODE_RE.test(code)) return fail('This referral link is not valid.');
  const referrer = await strapi.db.query(USER).findOne({ where: { referralCode: code }, select: ['id', 'blocked'] });
  if (!referrer || referrer.blocked) return fail('This referral link is not valid.');
  if (referrer.id === refereeId) return fail('You can’t use your own referral link.');

  const userTable = strapi.db.metadata.get(USER).tableName;
  return strapi.db.transaction(async ({ trx }) => {
    // Serialise claims for the same account so it can only be credited once.
    const referee = await trx(userTable).select('id', 'created_at').where('id', refereeId).forUpdate().first();
    if (!referee) return fail('Account not found.');
    if (await strapi.db.query(REFERRAL).findOne({ where: { referee: { id: refereeId } }, select: ['id'] })) {
      return fail('Your account is already linked to a referral.');
    }
    const ageDays = (Date.now() - new Date(referee.created_at).getTime()) / 86_400_000;
    const hasOrders = (await strapi.db.query(ORDER).count({ where: { user: { id: refereeId } } })) > 0;
    if (ageDays > CLAIM_WINDOW_DAYS || hasOrders) return fail('Referral links are for new customers only.');

    const qualified = program.qualifyOn === 'signup';
    await strapi.db.query(REFERRAL).create({
      data: {
        referrer: referrer.id,
        referee: refereeId,
        referralStatus: qualified ? 'qualified' : 'pending',
        ...(qualified ? { qualifiedAt: new Date() } : {}),
      },
    });
    strapi.log.info(`[referrals] user ${refereeId} joined via ${code} (${qualified ? 'qualified' : 'pending'})`);
    return { ok: true, message: 'Welcome! Your friend’s invite has been applied.' };
  });
}

/** Called when an order is delivered: qualifies the customer's pending referral on their first delivered order. */
export async function qualifyReferralForOrder(strapi: Core.Strapi, orderId: number) {
  const program = await getReferralProgram(strapi);
  if (!program.enabled || program.qualifyOn !== 'first_delivered_order') return;

  const order = await strapi.db.query(ORDER).findOne({ where: { id: orderId }, select: ['orderNumber', 'orderStatus'], populate: { user: { select: ['id'] }, customer: true } });
  if (!order?.user || order.orderStatus !== 'delivered') return;
  const referral = await strapi.db.query(REFERRAL).findOne({
    where: { referee: { id: order.user.id }, referralStatus: 'pending' },
    populate: { referrer: { select: ['id', 'phone'] } },
  });
  if (!referral?.referrer) return;

  // Basic self-referral check: the friend's delivery phone must not be one the referrer uses.
  const norm = (p?: string | null) => (p ?? '').replace(/\D/g, '').replace(/^92/, '0');
  const referrerOrders = await strapi.db.query(ORDER).findMany({ where: { user: { id: referral.referrer.id } }, populate: { customer: true }, limit: 200 });
  const referrerPhones = new Set([referral.referrer.phone, ...referrerOrders.map((o: any) => o.customer?.phone)].map(norm).filter(Boolean));
  const phone = norm(order.customer?.phone);
  if (phone && referrerPhones.has(phone)) {
    await strapi.db.query(REFERRAL).update({
      where: { id: referral.id },
      data: { referralStatus: 'rejected', orderNumber: order.orderNumber, note: 'Automatically rejected: the order used the referrer’s phone number.' },
    });
    strapi.log.warn(`[referrals] referral ${referral.id} rejected — ${order.orderNumber} used the referrer's phone`);
    return;
  }

  // The referral lifecycle issues the reward after this update.
  await strapi.db.query(REFERRAL).update({
    where: { id: referral.id },
    data: { referralStatus: 'qualified', qualifiedAt: new Date(), orderNumber: order.orderNumber },
  });
  strapi.log.info(`[referrals] referral ${referral.id} qualified by ${order.orderNumber}`);
}

const rewardsEarned = (program: ReferralProgram, qualified: number) => {
  const full = Math.floor(qualified / program.referralsRequired);
  return program.repeatable ? full : Math.min(full, 1);
};

/** Creates any reward coupons the referrer has earned but not yet received (safe to call repeatedly). */
export async function issueReferralRewards(strapi: Core.Strapi, referrerId: number) {
  const program = await getReferralProgram(strapi);
  if (!program.enabled || program.rewardValue <= 0) return;

  const userTable = strapi.db.metadata.get(USER).tableName;
  const created = await strapi.db.transaction(async ({ trx }) => {
    await trx(userTable).select('id').where('id', referrerId).forUpdate();
    const qualified = await strapi.db.query(REFERRAL).count({ where: { referrer: { id: referrerId }, referralStatus: 'qualified' } });
    const issued = await strapi.db.query(COUPON).count({ where: { owner: { id: referrerId }, source: 'referral' } });
    const codes: string[] = [];
    for (let i = issued; i < rewardsEarned(program, qualified); i++) {
      let code = `REF-${randomCode(6)}`;
      while (await strapi.db.query(COUPON).findOne({ where: { code }, select: ['id'] })) code = `REF-${randomCode(6)}`;
      await strapi.db.query(COUPON).create({
        data: {
          code,
          discountType: program.rewardType,
          value: program.rewardValue,
          maxDiscount: program.maxDiscount,
          minSubtotal: program.minSubtotal,
          usageLimit: 1,
          usedCount: 0,
          active: true,
          endsAt: program.rewardValidDays ? new Date(Date.now() + program.rewardValidDays * 86_400_000) : null,
          owner: referrerId,
          source: 'referral',
        },
      });
      codes.push(code);
    }
    return codes;
  });
  if (!created.length) return;

  strapi.log.info(`[referrals] user ${referrerId} earned ${created.length} reward(s): ${created.join(', ')}`);
  const user = await strapi.db.query(USER).findOne({ where: { id: referrerId }, select: ['email'] });
  if (user?.email) {
    afterCommit(strapi, () => sendReferralRewardEmail(strapi, user.email, created, describeReward(program), program.rewardValidDays));
  }
}

const maskEmail = (email?: string | null) => {
  if (!email) return 'A friend';
  const [name, domain] = email.split('@');
  return `${name.slice(0, 2)}${'•'.repeat(Math.max(2, Math.min(6, name.length - 2)))}@${domain}`;
};

/** Everything the account page needs: link code, progress towards the next reward, friends and coupons. */
export async function referralSummary(strapi: Core.Strapi, userId: number) {
  const program = await getReferralProgram(strapi);
  const [code, referrals, coupons] = await Promise.all([
    ensureReferralCode(strapi, userId),
    strapi.db.query(REFERRAL).findMany({
      where: { referrer: { id: userId } },
      orderBy: { createdAt: 'desc' },
      limit: 100,
      populate: { referee: { select: ['email', 'fullName'] } },
    }),
    strapi.db.query(COUPON).findMany({ where: { owner: { id: userId }, source: 'referral' }, orderBy: { createdAt: 'desc' }, limit: 100 }),
  ]);

  const qualified = referrals.filter((r: any) => r.referralStatus === 'qualified').length;
  const earned = rewardsEarned(program, qualified);
  const maxedOut = !program.repeatable && earned >= 1;
  const progress = maxedOut ? program.referralsRequired : qualified % program.referralsRequired;
  const now = Date.now();

  return {
    enabled: program.enabled,
    code,
    referralsRequired: program.referralsRequired,
    qualifyOn: program.qualifyOn,
    rewardText: describeReward(program),
    rewardValidDays: program.rewardValidDays,
    repeatable: program.repeatable,
    terms: program.terms,
    qualifiedCount: qualified,
    pendingCount: referrals.filter((r: any) => r.referralStatus === 'pending').length,
    progress,
    remaining: maxedOut ? 0 : program.referralsRequired - progress,
    referrals: referrals.map((r: any) => ({
      name: r.referee?.fullName?.split(' ')[0] || maskEmail(r.referee?.email),
      status: r.referralStatus,
      joinedAt: new Date(r.createdAt).toISOString(),
    })),
    rewards: coupons.map((c: any) => ({
      code: c.code,
      description: describeReward(c),
      endsAt: c.endsAt ? new Date(c.endsAt).toISOString() : null,
      used: c.usageLimit != null && c.usedCount >= c.usageLimit,
      expired: (!!c.endsAt && new Date(c.endsAt).getTime() < now) || !c.active,
    })),
  };
}
