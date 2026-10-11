import type { Core } from '@strapi/strapi';

/**
 * Transactional emails (sent through the email plugin → nodemailer/SMTP).
 * Sending never throws: an email failure must not break checkout or an admin save.
 */

type OrderRecord = {
  orderNumber: string;
  orderStatus: string;
  paymentMethod: string;
  paymentStatus: string;
  subtotal: number | string;
  discount?: number | string | null;
  shippingFee?: number | string | null;
  total: number | string;
  couponCode?: string | null;
  trackingNumber?: string | null;
  notes?: string | null;
  createdAt: string;
  customer?: { fullName: string; phone: string; email?: string | null } | null;
  shippingAddress?: { province: string; city: string; address: string } | null;
  items?: { productName: string; sku?: string | null; quantity: number; unitPrice: number | string; lineTotal: number | string }[];
};

const rs = (n: number | string | null | undefined) => `Rs. ${Math.round(Number(n ?? 0)).toLocaleString('en-PK')}`;
const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const PAYMENT_LABEL: Record<string, string> = {
  cod: 'Cash on Delivery',
  bank: 'Bank transfer',
  wallet: 'JazzCash / Easypaisa',
};

const STATUS_COPY: Record<string, { subject: string; line: string }> = {
  confirmed: { subject: 'confirmed', line: 'Good news — we’ve confirmed your order and are preparing it.' },
  processing: { subject: 'being packed', line: 'Your order is being packed and will be handed to the courier soon.' },
  shipped: { subject: 'on its way', line: 'Your order has been shipped and is on its way to you.' },
  delivered: { subject: 'delivered', line: 'Your order has been delivered. We hope you enjoy it!' },
  cancelled: { subject: 'cancelled', line: 'Your order has been cancelled. If this is unexpected, please contact us.' },
  returned: { subject: 'returned', line: 'Your return has been received and is being processed.' },
};

async function storeInfo(strapi: Core.Strapi) {
  const g = await strapi.documents('api::global.global').findFirst({ populate: { contact: { populate: ['phones'] } } });
  const contact = g?.contact as { email?: string; whatsapp?: string; phones?: { text: string }[] } | undefined;
  return {
    name: (g?.storeName as string) || 'Tech Life Pakistan',
    email: contact?.email ?? '',
    phone: contact?.phones?.[0]?.text ?? '',
    whatsapp: contact?.whatsapp ?? '',
    storefront: (process.env.STOREFRONT_URL ?? '').replace(/\/$/, ''),
  };
}

function layout(store: Awaited<ReturnType<typeof storeInfo>>, title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#1c2333">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden">
      <tr><td style="background:#2f5bea;padding:20px 28px;color:#fff;font-size:22px;font-weight:bold">⚡ ${esc(store.name)}</td></tr>
      <tr><td style="padding:28px">
        <h1 style="margin:0 0 12px;font-size:22px">${esc(title)}</h1>
        ${body}
      </td></tr>
      <tr><td style="padding:18px 28px;background:#f7f8fc;color:#6b7280;font-size:12px;line-height:1.6">
        Questions? Reply to this email${store.phone ? `, call ${esc(store.phone)}` : ''}${store.whatsapp ? ` or WhatsApp +${esc(store.whatsapp)}` : ''}.
        ${store.storefront ? `<br><a href="${esc(store.storefront)}" style="color:#2f5bea">${esc(store.storefront.replace(/^https?:\/\//, ''))}</a>` : ''}
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

function orderTable(o: OrderRecord) {
  const rows = (o.items ?? [])
    .map(
      (i) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #eef0f5">${esc(i.productName)}<br><span style="color:#6b7280;font-size:12px">${i.quantity} × ${rs(i.unitPrice)}</span></td>
        <td style="padding:8px 0;border-bottom:1px solid #eef0f5;text-align:right;white-space:nowrap">${rs(i.lineTotal)}</td></tr>`
    )
    .join('');
  const line = (label: string, value: string, bold = false) =>
    `<tr><td style="padding:4px 0;${bold ? 'font-weight:bold;font-size:16px' : 'color:#6b7280'}">${label}</td><td style="padding:4px 0;text-align:right;${bold ? 'font-weight:bold;font-size:16px' : ''}">${value}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:16px 0">${rows}
    ${line('Subtotal', rs(o.subtotal))}
    ${Number(o.discount) > 0 ? line(`Discount${o.couponCode ? ` (${esc(o.couponCode)})` : ''}`, `−${rs(o.discount)}`) : ''}
    ${line('Shipping', Number(o.shippingFee) > 0 ? rs(o.shippingFee) : 'Free')}
    ${line('Total', rs(o.total), true)}
  </table>`;
}

const addressBlock = (o: OrderRecord) =>
  o.shippingAddress && o.customer
    ? `<p style="font-size:14px;line-height:1.6;margin:0 0 8px"><b>Delivering to</b><br>${esc(o.customer.fullName)} · ${esc(o.customer.phone)}<br>${esc(
        o.shippingAddress.address
      )}, ${esc(o.shippingAddress.city)}, ${esc(o.shippingAddress.province)}</p>`
    : '';

async function loadOrder(strapi: Core.Strapi, where: Record<string, unknown>): Promise<OrderRecord | null> {
  return strapi.db.query('api::order.order').findOne({ where, populate: { items: true, customer: true, shippingAddress: true } });
}

async function send(strapi: Core.Strapi, to: string, subject: string, html: string) {
  try {
    await strapi.plugin('email').service('email').send({ to, subject, html });
    strapi.log.info(`[email] "${subject}" → ${to}`);
  } catch (error) {
    strapi.log.error(`[email] failed to send "${subject}" to ${to}: ${(error as Error).message}`);
  }
}

type PaymentAccount = { method: string; provider: string; accountTitle: string; accountNumber: string; iban?: string | null; instructions?: string | null; active?: boolean | null };

async function paymentAccounts(strapi: Core.Strapi, method: string): Promise<PaymentAccount[]> {
  const g = await strapi.documents('api::global.global').findFirst({ populate: ['paymentAccounts'] });
  return ((g?.paymentAccounts ?? []) as PaymentAccount[]).filter((a) => a.active !== false && a.method === method);
}

const accountsBlock = (accounts: PaymentAccount[], orderNumber: string) =>
  accounts
    .map(
      (a) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:8px 0;background:#f7f8fc;border-radius:12px"><tr><td style="padding:12px 16px;line-height:1.7">
        <b>${esc(a.provider)}</b><br>
        Account title: ${esc(a.accountTitle)}<br>
        Account no: <b style="font-family:'Courier New',monospace">${esc(a.accountNumber)}</b>
        ${a.iban ? `<br>IBAN: <span style="font-family:'Courier New',monospace">${esc(a.iban)}</span>` : ''}
        ${a.instructions ? `<br><span style="color:#6b7280">${esc(a.instructions)}</span>` : ''}
      </td></tr></table>`
    )
    .join('') + (accounts.length ? `<p style="font-size:13px;color:#6b7280">Please mention <b>${esc(orderNumber)}</b> in the payment description.</p>` : '');

/** Customer confirmation + store notification for a newly placed order. */
export async function sendNewOrderEmails(strapi: Core.Strapi, orderNumber: string) {
  try {
    const [order, store] = await Promise.all([loadOrder(strapi, { orderNumber }), storeInfo(strapi)]);
    if (!order) return;
    const payment = PAYMENT_LABEL[order.paymentMethod] ?? order.paymentMethod;
    const accounts = order.paymentMethod === 'cod' ? [] : await paymentAccounts(strapi, order.paymentMethod);
    const paymentNote =
      order.paymentMethod === 'cod'
        ? 'Please keep the exact amount ready — you pay when your parcel arrives.'
        : accounts.length
          ? `Please send ${rs(order.total)} to one of the accounts below, then share the transaction ID from the “Track your order” page (or reply to this email). Your order ships once payment is confirmed.`
          : 'We’ll send payment details on WhatsApp. Your order ships once payment is confirmed.';

    if (order.customer?.email) {
      await send(
        strapi,
        order.customer.email,
        `Order ${order.orderNumber} received — ${store.name}`,
        layout(
          store,
          `Thank you, ${order.customer.fullName.split(' ')[0]}!`,
          `<p style="font-size:14px;line-height:1.6">We’ve received your order <b>${esc(order.orderNumber)}</b> and will call you shortly to confirm delivery.</p>
           ${orderTable(order)}
           ${addressBlock(order)}
           <p style="font-size:14px;line-height:1.6"><b>Payment:</b> ${esc(payment)}<br>${esc(paymentNote)}</p>
           ${accountsBlock(accounts, order.orderNumber)}
           ${store.storefront ? `<p><a href="${esc(store.storefront)}/track-order" style="display:inline-block;background:#2f5bea;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-size:14px">Track your order</a></p>` : ''}`
        )
      );
    }

    const notify = process.env.STORE_NOTIFY_EMAIL || store.email;
    if (notify) {
      const admin = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT ?? 1337}`).replace(/\/$/, '');
      await send(
        strapi,
        notify,
        `🛒 New order ${order.orderNumber} — ${rs(order.total)} (${payment})`,
        layout(
          store,
          `New order ${order.orderNumber}`,
          `${addressBlock(order)}${orderTable(order)}
           ${order.notes ? `<p style="font-size:14px"><b>Customer notes:</b> ${esc(order.notes)}</p>` : ''}
           <p><a href="${esc(admin)}/admin/content-manager/collection-types/api::order.order" style="color:#2f5bea">Open orders in the dashboard →</a></p>`
        )
      );
    }
  } catch (error) {
    strapi.log.error(`[email] new-order emails failed for ${orderNumber}: ${(error as Error).message}`);
  }
}

/** Tells the customer when an admin moves the order to a new status. */
export async function sendStatusEmail(strapi: Core.Strapi, orderId: number): Promise<string | null> {
  try {
    const [order, store] = await Promise.all([loadOrder(strapi, { id: orderId }), storeInfo(strapi)]);
    const copy = order && STATUS_COPY[order.orderStatus];
    if (!order?.customer?.email || !copy) return null;
    await send(
      strapi,
      order.customer.email,
      `Your order ${order.orderNumber} is ${copy.subject} — ${store.name}`,
      layout(
        store,
        `Order ${order.orderNumber} is ${copy.subject}`,
        `<p style="font-size:14px;line-height:1.6">${esc(copy.line)}</p>
         ${order.trackingNumber ? `<p style="font-size:14px"><b>Tracking number:</b> ${esc(order.trackingNumber)}</p>` : ''}
         ${orderTable(order)}`
      )
    );
    return order.customer.email;
  } catch (error) {
    strapi.log.error(`[email] status email failed for order ${orderId}: ${(error as Error).message}`);
    return null;
  }
}

/** One-time sign-in code (passwordless login). */
export async function sendLoginCodeEmail(strapi: Core.Strapi, to: string, code: string, minutes: number) {
  const store = await storeInfo(strapi);
  await send(
    strapi,
    to,
    `${code} is your ${store.name} sign-in code`,
    layout(
      store,
      'Your sign-in code',
      `<p style="font-size:14px;line-height:1.6">Enter this code to sign in to your account:</p>
      <p style="margin:20px 0;font-size:34px;font-weight:bold;letter-spacing:10px;font-family:'Courier New',monospace;color:#2f5bea">${esc(code)}</p>
      <p style="font-size:13px;line-height:1.6;color:#6b7280">The code expires in ${minutes} minutes. If you didn’t try to sign in, you can ignore this email — nobody can access your account without the code.</p>`
    )
  );
}

/** Tells the store a customer reported an advance payment that needs verifying. */
export async function sendPaymentSubmittedAlert(strapi: Core.Strapi, orderNumber: string, reference: string, amount: number) {
  try {
    const store = await storeInfo(strapi);
    const notify = process.env.STORE_NOTIFY_EMAIL || store.email;
    if (!notify) return;
    const admin = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT ?? 1337}`).replace(/\/$/, '');
    await send(
      strapi,
      notify,
      `Payment to verify: ${orderNumber} — ${rs(amount)}`,
      layout(
        store,
        'Payment reported by customer',
        `<p style="font-size:14px;line-height:1.6">The customer for order <b>${esc(orderNumber)}</b> reports paying <b>${rs(amount)}</b>.<br>
        Transaction reference: <b style="font-family:'Courier New',monospace">${esc(reference)}</b></p>
        <p style="font-size:14px;line-height:1.6">Check your bank / wallet statement, then approve or reject it in the order’s Payments section.</p>
        <p><a href="${esc(admin)}/admin/orders-manager?verify=1" style="display:inline-block;background:#2f5bea;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-size:14px">Open orders awaiting verification</a></p>`
      )
    );
  } catch (error) {
    strapi.log.error(`[email] payment alert failed: ${(error as Error).message}`);
  }
}
