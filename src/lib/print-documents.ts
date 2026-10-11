import type { Core } from '@strapi/strapi';
import bwipjs from 'bwip-js';

/**
 * Printable order documents for dispatch:
 *  - label     courier / shipping label (4×6 in thermal label, 80 mm receipt roll, or A4)
 *  - dispatch  A4 sheet: shipping label + packing checklist, for ordinary printers
 *  - packing   packing slip (no prices)
 *  - invoice   invoice / receipt
 * Several orders can be printed in one go — each starts on a new page.
 */
export const PRINT_TYPES = ['label', 'dispatch', 'packing', 'invoice'] as const;
export const PRINT_SIZES = ['4x6', '80mm', 'a4'] as const;
export type PrintType = (typeof PRINT_TYPES)[number];
export type PrintSize = (typeof PRINT_SIZES)[number];

type Item = { productName: string; variantTitle?: string | null; sku?: string | null; quantity: number; unitPrice: number | string; lineTotal: number | string };
export type PrintableOrder = {
  orderNumber: string;
  createdAt: string | Date;
  orderStatus: string;
  paymentMethod: string;
  paymentStatus: string;
  subtotal: number | string;
  discount?: number | string | null;
  shippingFee?: number | string | null;
  shippingMethod?: string | null;
  codFee?: number | string | null;
  tax?: number | string | null;
  taxLabel?: string | null;
  taxInclusive?: boolean | null;
  total: number | string;
  paidAmount?: number | string | null;
  refundedAmount?: number | string | null;
  couponCode?: string | null;
  courier?: string | null;
  trackingNumber?: string | null;
  notes?: string | null;
  customer?: { fullName?: string; phone?: string; email?: string | null } | null;
  shippingAddress?: { province?: string; city?: string; address?: string } | null;
  items?: Item[] | null;
};

type Store = { name: string; address: string; phone: string; email: string; website: string };

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const rs = (n: unknown) => `Rs. ${Math.round(Number(n ?? 0)).toLocaleString('en-PK')}`;
const date = (d: string | Date) => new Date(d).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
/** 03062306838 → 0306 2306838 (easier for riders to read and dial). */
const phone = (p?: string) => (p ?? '').replace(/^(\+92|0)(3\d{2})-?(\d{7})$/, (_, cc, a, b) => `${cc === '+92' ? '+92 ' : '0'}${a} ${b}`);
const METHOD: Record<string, string> = { cod: 'Cash on Delivery', bank: 'Bank transfer', wallet: 'JazzCash / Easypaisa' };

function barcode(text: string, height = 12) {
  try {
    return bwipjs.toSVG({ bcid: 'code128', text, height, includetext: false, paddingwidth: 0, paddingheight: 0 }).replace('<svg ', '<svg preserveAspectRatio="none" class="bc-svg" ');
  } catch {
    return '';
  }
}

async function storeInfo(strapi: Core.Strapi): Promise<Store> {
  const g = await strapi.documents('api::global.global').findFirst({ populate: { contact: { populate: ['phones'] } } });
  const contact = (g?.contact ?? {}) as { email?: string; address?: string; phones?: { text: string }[] };
  return {
    name: (g?.storeName as string) || 'Tech Life Pakistan',
    address: contact.address ?? '',
    phone: contact.phones?.[0]?.text ?? '',
    email: contact.email ?? '',
    website: (process.env.STOREFRONT_URL ?? '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
  };
}

/** What the rider must collect: COD balance, or nothing for prepaid orders. */
function collection(o: PrintableOrder) {
  // A status set to "paid" by hand (without a payment record) still means nothing to collect.
  const settled = ['paid', 'refunded', 'partially_refunded'].includes(o.paymentStatus);
  const due = settled ? 0 : Math.max(0, Math.round(Number(o.total) - Number(o.paidAmount ?? 0)));
  if (o.paymentMethod === 'cod') {
    return due > 0
      ? { kind: 'cod' as const, title: 'COLLECT CASH', amount: rs(due), note: 'Cash on Delivery' }
      : { kind: 'paid' as const, title: 'PREPAID', amount: 'Rs. 0', note: 'Do not collect cash' };
  }
  return due > 0
    ? { kind: 'unpaid' as const, title: 'NOT PAID YET', amount: rs(due), note: `${METHOD[o.paymentMethod] ?? o.paymentMethod} — verify before dispatch` }
    : { kind: 'paid' as const, title: 'PREPAID', amount: 'Rs. 0', note: 'Do not collect cash' };
}

const pieces = (o: PrintableOrder) => (o.items ?? []).reduce((n, i) => n + i.quantity, 0);
const itemName = (i: Item) => `${esc(i.productName)}${i.variantTitle ? ` — ${esc(i.variantTitle)}` : ''}`;

// ---------- templates ----------

function label(o: PrintableOrder, store: Store, size: PrintSize) {
  const c = (o.customer ?? {}) as NonNullable<PrintableOrder['customer']>;
  const a = (o.shippingAddress ?? {}) as NonNullable<PrintableOrder['shippingAddress']>;
  const pay = collection(o);
  const items = o.items ?? [];
  const maxLines = size === 'a4' ? 8 : 4;
  const shown = items.slice(0, maxLines);
  return `<section class="label label-${size}">
  <div class="l-head">
    <div><div class="l-store">${esc(store.name)}</div><div class="l-small">${date(o.createdAt)}${o.shippingMethod ? ` · ${esc(o.shippingMethod)}` : ''}</div></div>
    ${o.courier ? `<div class="l-courier">${esc(o.courier)}</div>` : ''}
  </div>
  <div class="l-to">
    <div class="l-tag">SHIP TO</div>
    <div class="l-name">${esc(c.fullName)}</div>
    <div class="l-phone">${esc(phone(c.phone))}</div>
    <div class="l-addr">${esc(a.address)}</div>
    <div class="l-city">${esc((a.city ?? '').toUpperCase())}<span>${esc(a.province)}</span></div>
  </div>
  <div class="l-grid">
    <div class="l-pay l-pay-${pay.kind}"><div class="l-tag">${pay.title}</div><div class="l-amount">${pay.amount}</div><div class="l-small">${esc(pay.note)}</div></div>
    <div class="l-meta"><div class="l-tag">ORDER</div><div class="l-order">${esc(o.orderNumber)}</div><div class="l-small">${pieces(o)} item${pieces(o) === 1 ? '' : 's'} · 1 parcel</div></div>
  </div>
  <div class="l-bc">${barcode(o.orderNumber)}<div class="l-bc-text">${esc(o.orderNumber)}</div></div>
  ${
    o.trackingNumber
      ? `<div class="l-bc l-track"><div class="l-small">${esc(o.courier ?? 'Courier')} tracking #</div>${barcode(o.trackingNumber, 9)}<div class="l-bc-text">${esc(o.trackingNumber)}</div></div>`
      : ''
  }
  <div class="l-contents">
    <div class="l-tag">CONTENTS</div>
    ${shown.map((i) => `<div class="l-item"><b>${i.quantity}×</b> ${itemName(i)}${i.sku ? ` <span class="l-sku">${esc(i.sku)}</span>` : ''}</div>`).join('')}
    ${items.length > shown.length ? `<div class="l-small">+ ${items.length - shown.length} more item(s) — see packing slip</div>` : ''}
    <div class="l-weight">Weight: ________ kg</div>
  </div>
  ${o.notes ? `<div class="l-notes"><b>Note:</b> ${esc(o.notes)}</div>` : ''}
  <div class="l-from"><b>FROM / RETURN TO:</b> ${esc(store.name)}${store.address ? `, ${esc(store.address)}` : ''}${store.phone ? ` · ${esc(store.phone)}` : ''}</div>
</section>`;
}

function itemsTable(o: PrintableOrder, withPrices: boolean) {
  return `<table class="items"><thead><tr><th>#</th><th>Item</th><th class="c">Qty</th>${withPrices ? '<th class="r">Price</th><th class="r">Total</th>' : '<th class="c">Packed</th>'}</tr></thead><tbody>
  ${(o.items ?? [])
    .map(
      (i, n) => `<tr><td class="muted">${n + 1}</td><td>${itemName(i)}${i.sku ? `<div class="muted small">SKU ${esc(i.sku)}</div>` : ''}</td><td class="c"><b>${i.quantity}</b></td>${
        withPrices ? `<td class="r">${rs(i.unitPrice)}</td><td class="r">${rs(i.lineTotal)}</td>` : '<td class="c"><span class="box"></span></td>'
      }</tr>`
    )
    .join('')}</tbody></table>`;
}

function totals(o: PrintableOrder) {
  const row = (k: string, v: string, cls = '') => `<tr class="${cls}"><td>${k}</td><td class="r">${v}</td></tr>`;
  return `<table class="totals"><tbody>
    ${row('Subtotal', rs(o.subtotal))}
    ${Number(o.discount) > 0 ? row(`Discount${o.couponCode ? ` (${esc(o.couponCode)})` : ''}`, `−${rs(o.discount)}`) : ''}
    ${row(`Shipping${o.shippingMethod ? ` (${esc(o.shippingMethod)})` : ''}`, Number(o.shippingFee) > 0 ? rs(o.shippingFee) : 'Free')}
    ${Number(o.codFee) > 0 ? row('Cash on Delivery fee', rs(o.codFee)) : ''}
    ${Number(o.tax) > 0 ? row(`${esc(o.taxLabel ?? 'Tax')}${o.taxInclusive ? ' (included)' : ''}`, rs(o.tax)) : ''}
    ${row('Total', rs(o.total), 'grand')}
    ${Number(o.paidAmount) > 0 ? row('Paid', rs(o.paidAmount)) : ''}
    ${Number(o.refundedAmount) > 0 ? row('Refunded', `−${rs(o.refundedAmount)}`) : ''}
    ${row('Balance due', rs(Math.max(0, Number(o.total) - Number(o.paidAmount ?? 0))), 'due')}
  </tbody></table>`;
}

function docHeader(o: PrintableOrder, store: Store, title: string) {
  return `<header class="d-head">
    <div><div class="d-store">${esc(store.name)}</div><div class="muted small">${[store.address, store.phone, store.email, store.website].filter(Boolean).map(esc).join(' · ')}</div></div>
    <div class="r"><div class="d-title">${title}</div><div class="d-bc">${barcode(o.orderNumber, 8)}</div><div style="white-space:nowrap"><b>${esc(o.orderNumber)}</b> · ${date(o.createdAt)}</div></div>
  </header>`;
}

function shipTo(o: PrintableOrder) {
  const c = (o.customer ?? {}) as NonNullable<PrintableOrder['customer']>;
  const a = (o.shippingAddress ?? {}) as NonNullable<PrintableOrder['shippingAddress']>;
  const pay = collection(o);
  return `<div class="d-cols">
    <div><div class="tag">Ship to</div><b>${esc(c.fullName)}</b><br>${esc(phone(c.phone))}${c.email ? `<br>${esc(c.email)}` : ''}<br>${esc(a.address)}<br>${esc(a.city)}, ${esc(a.province)}</div>
    <div><div class="tag">Payment</div>${esc(METHOD[o.paymentMethod] ?? o.paymentMethod)} — <b>${esc(o.paymentStatus.replace(/_/g, ' '))}</b><br>
      <span class="pill pill-${pay.kind}">${pay.title}: ${pay.amount}</span>
      ${o.courier || o.trackingNumber ? `<div class="tag" style="margin-top:8px">Courier</div>${esc(o.courier ?? '—')}${o.trackingNumber ? ` · <b>${esc(o.trackingNumber)}</b>` : ''}` : ''}
    </div>
  </div>`;
}

function packing(o: PrintableOrder, store: Store) {
  return `<section class="doc">
  ${docHeader(o, store, 'PACKING SLIP')}
  ${shipTo(o)}
  ${itemsTable(o, false)}
  <p class="small"><b>${pieces(o)}</b> item(s) in total.${o.notes ? ` <b>Customer note:</b> ${esc(o.notes)}` : ''}</p>
  <div class="signs"><span>Packed by: ____________________</span><span>Checked by: ____________________</span><span>Date: ____________</span></div>
</section>`;
}

function invoice(o: PrintableOrder, store: Store) {
  return `<section class="doc">
  ${docHeader(o, store, 'INVOICE')}
  ${shipTo(o)}
  ${itemsTable(o, true)}
  ${totals(o)}
  <p class="muted small thanks">Thank you for shopping with ${esc(store.name)}! Keep this invoice for warranty claims.</p>
</section>`;
}

/** 80 mm thermal receipt version of the invoice / packing slip. */
function receipt(o: PrintableOrder, store: Store, withPrices: boolean) {
  const c = (o.customer ?? {}) as NonNullable<PrintableOrder['customer']>;
  const a = (o.shippingAddress ?? {}) as NonNullable<PrintableOrder['shippingAddress']>;
  return `<section class="receipt">
  <div class="c"><b class="r-store">${esc(store.name)}</b><br><span class="small">${[store.address, store.phone].filter(Boolean).map(esc).join('<br>')}</span></div>
  <div class="r-rule"></div>
  <div class="c"><b>${withPrices ? 'INVOICE' : 'PACKING SLIP'}</b><br>${esc(o.orderNumber)} · ${date(o.createdAt)}</div>
  <div class="r-bc">${barcode(o.orderNumber, 8)}</div>
  <div class="r-rule"></div>
  <div><b>${esc(c.fullName)}</b> · ${esc(phone(c.phone))}<br>${esc(a.address)}, ${esc(a.city)}</div>
  <div class="r-rule"></div>
  ${(o.items ?? [])
    .map(
      (i) => `<div class="r-item"><div>${itemName(i)}</div><div class="r-line"><span>${i.quantity} × ${withPrices ? rs(i.unitPrice) : '☐'}</span>${withPrices ? `<b>${rs(i.lineTotal)}</b>` : ''}</div></div>`
    )
    .join('')}
  <div class="r-rule"></div>
  ${withPrices ? totals(o) : `<div>${pieces(o)} item(s)</div>`}
  <div class="r-rule"></div>
  <div class="c small">${withPrices ? 'Thank you for your order!' : 'Packed by: ____________'}</div>
</section>`;
}

// ---------- page styles ----------

const PAGE: Record<PrintSize, string> = {
  '4x6': '@page{size:4in 6in;margin:0}',
  '80mm': '@page{size:80mm 200mm;margin:0}',
  a4: '@page{size:A4;margin:10mm}',
};

const CSS = `
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#fff}
.page{break-after:page;page-break-after:always;overflow:hidden}.page:last-child{break-after:auto;page-break-after:auto}
.muted{color:#444}.small{font-size:11px}.c{text-align:center}.r{text-align:right}
.bc-svg{display:block;width:100%;height:100%}

/* label */
.label{border:2px solid #000;display:flex;flex-direction:column;font-size:12px;line-height:1.3}
.label>div{padding:6px 10px;border-bottom:1.5px solid #000}.label>div:last-child{border-bottom:0}
.label-4x6{width:4in;height:6in}
.label-80mm{width:76mm;min-height:150mm;margin:2mm}
.label-a4{width:110mm}.label-a4 .l-contents{flex:none}
.l-head{display:flex;justify-content:space-between;align-items:center;gap:8px}
.l-store{font-size:17px;font-weight:800;letter-spacing:.5px;text-transform:uppercase}
.l-courier{border:2px solid #000;padding:3px 8px;font-weight:800;font-size:14px;text-transform:uppercase}
.l-tag{font-size:9px;font-weight:800;letter-spacing:1.2px}
.l-small{font-size:10px}
.l-name{font-size:17px;font-weight:800;margin-top:2px}
.l-phone{font-size:20px;font-weight:800;font-family:'Courier New',monospace;letter-spacing:.5px}
.l-addr{font-size:13px;margin-top:2px}
.l-city{font-size:22px;font-weight:900;margin-top:3px}.l-city span{font-size:12px;font-weight:600;margin-left:8px}
.l-grid{display:grid;grid-template-columns:1fr 1fr;padding:0!important}
.l-grid>div{padding:6px 10px}.l-pay{border-right:1.5px solid #000}
.l-pay-cod{background:#000;color:#fff}.l-pay-unpaid{background:repeating-linear-gradient(45deg,#fff,#fff 6px,#ddd 6px,#ddd 12px)}
.l-amount{font-size:22px;font-weight:900;line-height:1.1}
.l-order{font-size:14px;font-weight:800;font-family:'Courier New',monospace}
.l-bc{text-align:center}.l-bc .bc-svg{height:46px}.l-track .bc-svg{height:34px}
.l-bc-text{font-family:'Courier New',monospace;font-weight:700;font-size:13px;letter-spacing:2px}
.l-contents{flex:1}.l-item{font-size:11px;margin-top:2px}.l-sku{font-family:'Courier New',monospace;font-size:10px}
.l-weight{margin-top:6px;font-size:11px}
.l-notes{font-size:11px}
.l-from{font-size:10px}
.label-80mm .l-phone{font-size:18px}.label-80mm .l-city{font-size:19px}.label-80mm .l-amount{font-size:19px}

/* A4 documents */
.doc{width:100%;font-size:13px;line-height:1.45}
.d-head{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #000;padding-bottom:10px}
.d-store{font-size:22px;font-weight:800}.d-title{font-size:20px;font-weight:800;letter-spacing:1px}.d-bc{width:180px;height:34px;margin:4px 0 2px auto}
.d-cols{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:14px 0}
.tag{font-size:10px;font-weight:800;letter-spacing:1.2px;color:#444;text-transform:uppercase;margin-bottom:2px}
.pill{display:inline-block;margin-top:4px;border:1.5px solid #000;padding:2px 8px;font-weight:800}.pill-cod{background:#000;color:#fff}
table{width:100%;border-collapse:collapse}
.items th{font-size:10px;letter-spacing:1px;text-transform:uppercase;text-align:left;border-bottom:2px solid #000;padding:6px}
.items td{border-bottom:1px solid #ccc;padding:7px 6px;vertical-align:top}
.items th.c,.items td.c{text-align:center}.items th.r,.items td.r{text-align:right}
.box{display:inline-block;width:16px;height:16px;border:1.5px solid #000}
.totals{width:300px;margin:10px 0 0 auto}.totals td{padding:3px 6px}.totals .grand td{font-weight:800;font-size:15px;border-top:2px solid #000}.totals .due td{font-weight:700}
.signs{display:flex;justify-content:space-between;gap:12px;margin-top:40px;font-size:12px}
.thanks{margin-top:24px}
.dispatch{display:flex;flex-direction:column;gap:6mm}.dispatch .doc{font-size:12px}.dispatch .d-cols{margin:10px 0}.dispatch .signs{margin-top:24px}.dispatch .cut{border-top:1.5px dashed #000;text-align:center;font-size:10px;color:#444}

/* 80mm receipt */
.receipt{width:72mm;margin:3mm 4mm;font-size:12px;line-height:1.35}
.r-store{font-size:16px}.r-rule{border-top:1px dashed #000;margin:6px 0}.r-bc{height:34px;margin:4px 0}
.r-item{margin:3px 0}.r-line{display:flex;justify-content:space-between}
.receipt .totals{width:100%;margin:0}.receipt .totals td{padding:1px 0}

/* on screen */
@media screen{body{background:#e5e7eb;padding:16px}.page{background:#fff;margin:0 auto 16px;box-shadow:0 2px 10px rgba(0,0,0,.15);width:fit-content;padding:0}
.page-a4{width:210mm;min-height:297mm;padding:10mm}}
`;

export async function renderPrint(strapi: Core.Strapi, orders: PrintableOrder[], type: PrintType, size: PrintSize) {
  const store = await storeInfo(strapi);
  // Packing slips / invoices come in A4 or 80 mm; a 4×6 request for them falls back to A4.
  const docSize: PrintSize = type === 'dispatch' ? 'a4' : type === 'label' ? size : size === '80mm' ? '80mm' : 'a4';
  const pages = orders.map((o) => {
    let body: string;
    if (type === 'label') body = label(o, store, docSize);
    else if (type === 'dispatch')
      body = `<div class="dispatch">${label(o, store, 'a4')}<div class="cut">✂ - - - - - - - - cut along this line and stick the label on the parcel - - - - - - - - ✂</div>${packing(o, store)}</div>`;
    else if (docSize === '80mm') body = receipt(o, store, type === 'invoice');
    else body = type === 'invoice' ? invoice(o, store) : packing(o, store);
    return `<div class="page page-${docSize}">${body}</div>`;
  });
  const title = `${{ label: 'Shipping label', dispatch: 'Dispatch sheet', packing: 'Packing slip', invoice: 'Invoice' }[type]}${orders.length === 1 ? ` ${orders[0].orderNumber}` : `s (${orders.length})`}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PAGE[docSize]}${CSS}</style></head><body>${pages.join('')}</body></html>`;
}
