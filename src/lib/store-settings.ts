import type { Core } from '@strapi/strapi';

export interface ShippingRules {
  freeThreshold: number;
  flatRate: number;
  restrictedRegions: string[];
}

const FALLBACK: ShippingRules = { freeThreshold: 5000, flatRate: 250, restrictedRegions: [] };

/** Shipping rules from the "Store settings" single type (with safe fallbacks). */
export async function getShippingRules(strapi: Core.Strapi): Promise<ShippingRules> {
  const global = await strapi.documents('api::global.global').findFirst({
    populate: { shipping: { populate: ['restrictedRegions'] } },
  });
  const shipping = global?.shipping as
    | { freeThreshold?: number | string; flatRate?: number | string; restrictedRegions?: { text: string }[] }
    | undefined;
  if (!shipping) return FALLBACK;
  return {
    freeThreshold: Number(shipping.freeThreshold ?? FALLBACK.freeThreshold),
    flatRate: Number(shipping.flatRate ?? FALLBACK.flatRate),
    restrictedRegions: (shipping.restrictedRegions ?? []).map((r) => r.text.trim().toLowerCase()),
  };
}

export const shippingFeeFor = (rules: ShippingRules, amount: number) =>
  amount <= 0 || amount >= rules.freeThreshold ? 0 : rules.flatRate;

/** Round to whole rupees — prices are stored as decimals but the store trades in whole PKR. */
export const money = (n: number) => Math.round(n);
