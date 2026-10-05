import { Badge } from '@strapi/design-system';
import { useFetchClient } from '@strapi/strapi/admin';
import { useCallback, useEffect, useState } from 'react';

export const ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'] as const;
export const PAYMENT_STATUSES = ['unpaid', 'partially_paid', 'paid', 'partially_refunded', 'refunded'] as const;
export const PAYMENT_METHODS: Record<string, string> = { cod: 'Cash on Delivery', bank: 'Bank transfer', wallet: 'JazzCash / Easypaisa', card: 'Card', other: 'Other' };

export const rupees = (n: number | string | null | undefined) => `Rs. ${Math.round(Number(n ?? 0)).toLocaleString('en-PK')}`;
export const label = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const dateTime = (iso: string) => new Date(iso).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' });

const TONES: Record<string, [string, string]> = {
  pending: ['warning100', 'warning700'],
  confirmed: ['primary100', 'primary700'],
  processing: ['secondary100', 'secondary700'],
  shipped: ['alternative100', 'alternative700'],
  delivered: ['success100', 'success700'],
  cancelled: ['danger100', 'danger700'],
  returned: ['neutral150', 'neutral700'],
  unpaid: ['neutral150', 'neutral700'],
  partially_paid: ['warning100', 'warning700'],
  paid: ['success100', 'success700'],
  partially_refunded: ['secondary100', 'secondary700'],
  refunded: ['danger100', 'danger700'],
  to_verify: ['warning100', 'warning700'],
  pending_payment: ['warning100', 'warning700'],
  failed: ['danger100', 'danger700'],
  completed: ['success100', 'success700'],
};

export function StatusBadge({ value }: { value: string }) {
  const [bg, fg] = TONES[value] ?? ['neutral150', 'neutral700'];
  return (
    <Badge backgroundColor={bg} textColor={fg}>
      {label(value)}
    </Badge>
  );
}

export interface OrderListItem {
  documentId: string;
  orderNumber: string;
  createdAt: string;
  customer: string;
  phone: string;
  city: string;
  items: number;
  total: number;
  orderStatus: string;
  paymentStatus: string;
  paymentMethod: string;
  awaitingVerification?: boolean;
}

export interface OrderDetail {
  id: number;
  documentId: string;
  orderNumber: string;
  createdAt: string;
  orderStatus: string;
  paymentStatus: string;
  paymentMethod: string;
  subtotal: number;
  discount: number;
  shippingFee: number;
  shippingMethod?: string | null;
  codFee: number;
  tax: number;
  taxLabel?: string | null;
  taxInclusive?: boolean;
  total: number;
  paidAmount: number;
  refundedAmount: number;
  couponCode?: string | null;
  courier?: string | null;
  trackingNumber?: string | null;
  estimatedDelivery?: string | null;
  notes?: string | null;
  cancelReason?: string | null;
  customer?: { fullName: string; phone: string; email?: string | null };
  shippingAddress?: { province: string; city: string; address: string };
  items: { id: number; productName: string; sku?: string; quantity: number; unitPrice: number; lineTotal: number; product?: { documentId: string; name: string } | null }[];
  user?: { email: string } | null;
  events: { id: number; type: string; message: string; actor: string; visibleToCustomer: boolean; createdAt: string }[];
  payments: { id: number; kind: string; amount: number; method: string; status: string; reference?: string; note?: string; recordedBy?: string; createdAt: string }[];
}

const BASE = '/store-dashboard/orders';

/** Thin wrapper around the admin-only /store-dashboard/orders endpoints. */
export function useOrdersApi() {
  const { get, post } = useFetchClient();

  const call = useCallback(
    async <T,>(fn: () => Promise<{ data: T }>): Promise<T> => {
      try {
        return (await fn()).data;
      } catch (error) {
        const err = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
        throw new Error(err.response?.data?.error?.message ?? err.message ?? 'Request failed');
      }
    },
    []
  );

  return {
    list: (params: Record<string, string | number>) => call(() => get<{ data: OrderListItem[]; meta: { page: number; pageCount: number; total: number; counts: Record<string, number>; awaitingVerification: number } }>(BASE, { params })),
    detail: (id: string) => call(() => get<OrderDetail>(`${BASE}/${id}`)),
    action: (id: string, path: string, body: Record<string, unknown>) => call(() => post<OrderDetail>(`${BASE}/${id}/${path}`, body)),
    bulkStatus: (documentIds: string[], status: string, notify: boolean) =>
      call(() => post<{ updated: number; failed: string[] }>(`${BASE}/bulk-status`, { documentIds, status, notify })),
    exportCsv: async (params: Record<string, string>) => {
      const blob = await call(() => get<Blob>(`${BASE}/export.csv`, { params, responseType: 'blob' }));
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: `orders-${new Date().toISOString().slice(0, 10)}.csv` });
      a.click();
      URL.revokeObjectURL(url);
    },
  };
}

/** Small data-loading helper with a reload trigger. */
export function useLoader<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    load()
      .then((data) => alive && setState({ data, loading: false }))
      .catch((e: Error) => alive && setState({ error: e.message, loading: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1), setData: (data: T) => setState({ data, loading: false }) };
}
