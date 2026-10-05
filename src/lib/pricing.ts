import type { Core } from '@strapi/strapi';
import { getShippingRules, money, shippingFeeFor } from './store-settings';

/**
 * Shipping + tax engine shared by the checkout quote and placeOrder.
 * - Shipping zones match by city first, then province (higher priority wins). With no zones
 *   configured, the flat rate from Store settings applies.
 * - Tax rates match by province (empty list = everywhere); inclusive rates are informational,
 *   exclusive rates are added to the total.
 */

export interface ShippingOption {
  id: string;
  name: string;
  description?: string | null;
  estimate?: string | null;
  fee: number;
  codFee: number;
}

export interface Quote {
  options: ShippingOption[];
  method: ShippingOption | null;
  shippingFee: number;
  codFee: number;
  tax: number;
  taxLabel: string | null;
  taxInclusive: boolean;
  total: number;
}

const norm = (s?: string | null) => (s ?? '').trim().toLowerCase();
const texts = (list?: { text: string }[] | null) => (list ?? []).map((t) => norm(t.text)).filter(Boolean);

type Zone = {
  name: string;
  priority?: number;
  provinces?: { text: string }[];
  cities?: { text: string }[];
  methods?: {
    documentId: string;
    name: string;
    description?: string | null;
    estimate?: string | null;
    rate: number | string;
    freeOver?: number | string | null;
    codFee?: number | string | null;
    minOrder?: number | string | null;
    maxOrder?: number | string | null;
    active?: boolean;
    sortOrder?: number;
  }[];
};

export async function shippingOptions(strapi: Core.Strapi, province: string, city: string | undefined, amount: number): Promise<ShippingOption[]> {
  const zones = (await strapi.documents('api::shipping-zone.shipping-zone').findMany({
    filters: { active: true },
    populate: { provinces: true, cities: true, methods: true },
    limit: 200,
  })) as unknown as Zone[];

  if (zones.length === 0) {
    const rules = await getShippingRules(strapi);
    return [{ id: 'standard', name: 'Standard delivery', estimate: null, fee: shippingFeeFor(rules, amount), codFee: 0 }];
  }

  const p = norm(province);
  const c = norm(city);
  const matches = zones
    .map((z) => ({ z, byCity: !!c && texts(z.cities).includes(c), byProvince: texts(z.provinces).includes(p) }))
    .filter((m) => m.byCity || m.byProvince)
    .sort((a, b) => Number(b.byCity) - Number(a.byCity) || (b.z.priority ?? 0) - (a.z.priority ?? 0));
  const zone = matches[0]?.z;
  if (!zone) return [];

  return (zone.methods ?? [])
    .filter((m) => m.active !== false)
    .filter((m) => (m.minOrder == null || amount >= Number(m.minOrder)) && (m.maxOrder == null || amount <= Number(m.maxOrder)))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((m) => ({
      id: m.documentId,
      name: m.name,
      description: m.description ?? null,
      estimate: m.estimate ?? null,
      fee: m.freeOver != null && amount >= Number(m.freeOver) ? 0 : money(Number(m.rate)),
      codFee: money(Number(m.codFee ?? 0)),
    }));
}

export async function computeTax(strapi: Core.Strapi, province: string, goods: number, shipping: number) {
  const rates = (await strapi.documents('api::tax-rate.tax-rate').findMany({ filters: { active: true }, populate: { provinces: true }, limit: 100 })) as unknown as {
    name: string;
    rate: number | string;
    inclusive?: boolean;
    appliesToShipping?: boolean;
    provinces?: { text: string }[];
  }[];
  const p = norm(province);
  const applicable = rates.filter((r) => texts(r.provinces).length === 0 || texts(r.provinces).includes(p));
  let included = 0; // already inside the prices — shown as a breakdown only
  let added = 0; // charged on top
  for (const r of applicable) {
    const rate = Number(r.rate) / 100;
    const base = goods + (r.appliesToShipping ? shipping : 0);
    if (r.inclusive !== false) included += base - base / (1 + rate);
    else added += base * rate;
  }
  return {
    tax: money(included + added),
    added: money(added),
    label: applicable.length ? applicable.map((r) => `${r.name} ${Number(r.rate)}%`).join(' + ') : null,
    inclusive: added === 0,
  };
}

/** Full quote for an already-priced cart (subtotal and coupon discount computed by the caller). */
export async function quote(
  strapi: Core.Strapi,
  args: { subtotal: number; discount: number; province: string; city?: string; methodId?: string | null; paymentMethod?: string | null }
): Promise<Quote> {
  const goods = Math.max(0, args.subtotal - args.discount);
  const options = await shippingOptions(strapi, args.province, args.city, goods);
  const method = options.find((o) => o.id === args.methodId) ?? options[0] ?? null;
  const shippingFee = method?.fee ?? 0;
  const codFee = args.paymentMethod === 'cod' ? (method?.codFee ?? 0) : 0;
  const t = await computeTax(strapi, args.province, goods, shippingFee);
  const total = goods + shippingFee + codFee + t.added;
  return { options, method, shippingFee, codFee, tax: t.tax, taxLabel: t.label, taxInclusive: t.inclusive, total: money(total) };
}
