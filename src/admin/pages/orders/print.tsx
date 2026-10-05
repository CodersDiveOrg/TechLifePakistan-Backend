import { Menu } from '@strapi/design-system';
import { File as FileIcon } from '@strapi/icons';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import { Fragment, useState } from 'react';

export type PrintType = 'label' | 'dispatch' | 'packing' | 'invoice';
export type PrintSize = '4x6' | '80mm' | 'a4';

/** The print formats offered everywhere (order page, Content Manager, bulk). */
export const PRINT_OPTIONS: { group: string; items: { type: PrintType; size: PrintSize; label: string }[] }[] = [
  {
    group: 'Dispatch',
    items: [
      { type: 'label', size: '4x6', label: 'Shipping label — 4×6 in (label printer)' },
      { type: 'label', size: '80mm', label: 'Shipping label — 80 mm (receipt printer)' },
      { type: 'dispatch', size: 'a4', label: 'Dispatch sheet — A4 (label + packing list)' },
    ],
  },
  {
    group: 'Documents',
    items: [
      { type: 'packing', size: 'a4', label: 'Packing slip — A4' },
      { type: 'packing', size: '80mm', label: 'Packing slip — 80 mm' },
      { type: 'invoice', size: 'a4', label: 'Invoice — A4' },
      { type: 'invoice', size: '80mm', label: 'Invoice / receipt — 80 mm' },
    ],
  },
];

/** Prints HTML through a hidden iframe — the browser's print dialog opens directly, no new tab. */
export function printHtml(html: string) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', visibility: 'hidden' });
  frame.srcdoc = html;
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) return;
    const cleanup = () => setTimeout(() => frame.remove(), 1000);
    win.addEventListener('afterprint', cleanup);
    setTimeout(() => frame.remove(), 10 * 60_000); // fallback
    win.focus();
    win.print();
  };
  document.body.appendChild(frame);
}

/** Fetches a printable document (with the admin token) and prints it. */
export function usePrint() {
  const { get } = useFetchClient();
  const { toggleNotification } = useNotification();
  const [busy, setBusy] = useState(false);

  const run = async (url: string, params: Record<string, string>) => {
    setBusy(true);
    try {
      const { data } = await get<string>(url, { params, responseType: 'text' });
      printHtml(data);
    } catch (error) {
      const err = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
      toggleNotification({ type: 'danger', message: err.response?.data?.error?.message ?? err.message ?? 'Could not prepare the document' });
    } finally {
      setBusy(false);
    }
  };

  return {
    busy,
    printOrder: (documentId: string, type: PrintType, size: PrintSize) => run(`/store-dashboard/orders/${documentId}/print`, { type, size }),
    printOrders: (documentIds: string[], type: PrintType, size: PrintSize) => run('/store-dashboard/orders/print-batch', { ids: documentIds.join(','), type, size }),
  };
}

/** "Print" dropdown with every format. */
export function PrintMenu({
  onPick,
  label = 'Print',
  disabled,
  loading,
  variant = 'secondary',
  fullWidth,
}: {
  onPick: (type: PrintType, size: PrintSize) => void;
  label?: string;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'secondary' | 'default' | 'tertiary';
  fullWidth?: boolean;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger variant={variant} startIcon={<FileIcon />} disabled={disabled} loading={loading} fullWidth={fullWidth}>
        {label}
      </Menu.Trigger>
      <Menu.Content popoverPlacement="bottom-end">
        {PRINT_OPTIONS.map((g, i) => (
          <Fragment key={g.group}>
            {i > 0 && <Menu.Separator />}
            <Menu.Label>{g.group}</Menu.Label>
            {g.items.map((o) => (
              <Menu.Item key={`${o.type}-${o.size}`} onSelect={() => onPick(o.type, o.size)}>
                {o.label}
              </Menu.Item>
            ))}
          </Fragment>
        ))}
      </Menu.Content>
    </Menu.Root>
  );
}
