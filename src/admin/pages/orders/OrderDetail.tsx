import {
  Box,
  Button,
  Checkbox,
  Divider,
  Field,
  Flex,
  Grid,
  LinkButton,
  Modal,
  NumberInput,
  SingleSelect,
  SingleSelectOption,
  Table,
  Tbody,
  Td,
  Textarea,
  TextInput,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Pencil } from '@strapi/icons';
import { BackButton, Layouts, Page, useNotification } from '@strapi/strapi/admin';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PrintMenu, usePrint } from './print';
import { dateTime, label, ORDER_STATUSES, PAYMENT_METHODS, rupees, StatusBadge, useLoader, useOrdersApi, type OrderDetail as Order } from './shared';

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Box background="neutral0" padding={5} hasRadius shadow="tableShadow" height="100%">
      <Flex justifyContent="space-between" alignItems="center" paddingBottom={3}>
        <Typography variant="delta" tag="h2">
          {title}
        </Typography>
        {action}
      </Flex>
      {children}
    </Box>
  );
}

function Row({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) {
  return (
    <Flex justifyContent="space-between" paddingTop={1} paddingBottom={1}>
      <Typography textColor="neutral600">{k}</Typography>
      <Typography fontWeight={strong ? 'bold' : 'regular'}>{v}</Typography>
    </Flex>
  );
}

const EVENT_ICON: Record<string, string> = { created: '🛒', status: '🔄', payment: '💰', refund: '↩️', shipping: '🚚', note: '📝', email: '✉️', cancel: '✖️' };

/** Money dialog used for both "Record payment" and "Refund". */
function MoneyDialog({ kind, order, onDone }: { kind: 'payment' | 'refund'; order: Order; onDone: (o: Order) => void }) {
  const api = useOrdersApi();
  const { toggleNotification } = useNotification();
  const due = Math.max(0, Math.round(order.total - order.paidAmount));
  const refundable = Math.max(0, Math.round(order.paidAmount - order.refundedAmount));
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number | undefined>(kind === 'payment' ? due : refundable);
  const [method, setMethod] = useState(order.paymentMethod);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [restock, setRestock] = useState(false);
  const [markReturned, setMarkReturned] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const body = kind === 'payment' ? { amount, method, reference, note } : { amount, method, reference, note, restock, markReturned };
      onDone(await api.action(order.documentId, kind === 'payment' ? 'payments' : 'refunds', body));
      toggleNotification({ type: 'success', message: kind === 'payment' ? 'Payment recorded' : 'Refund recorded' });
      setOpen(false);
    } catch (e) {
      toggleNotification({ type: 'danger', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal.Root open={open} onOpenChange={setOpen}>
      <Modal.Trigger>
        <Button size="S" variant={kind === 'payment' ? 'success-light' : 'danger-light'} disabled={kind === 'payment' ? due <= 0 : refundable <= 0}>
          {kind === 'payment' ? 'Record payment' : 'Refund'}
        </Button>
      </Modal.Trigger>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{kind === 'payment' ? `Record payment — ${order.orderNumber}` : `Refund — ${order.orderNumber}`}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" gap={4} alignItems="stretch">
            <Typography textColor="neutral600">
              {kind === 'payment' ? `Outstanding: ${rupees(due)}` : `Refundable (paid minus earlier refunds): ${rupees(refundable)}`}
            </Typography>
            <Field.Root name="amount" required>
              <Field.Label>Amount (Rs.)</Field.Label>
              <NumberInput value={amount} onValueChange={(v) => setAmount(v)} />
            </Field.Root>
            <Field.Root name="method">
              <Field.Label>Method</Field.Label>
              <SingleSelect value={method} onChange={(v) => setMethod(String(v))}>
                {Object.entries(PAYMENT_METHODS).map(([k, v]) => (
                  <SingleSelectOption key={k} value={k}>{v}</SingleSelectOption>
                ))}
              </SingleSelect>
            </Field.Root>
            <Field.Root name="reference" hint="Bank transaction ID, wallet reference, receipt number…">
              <Field.Label>Reference</Field.Label>
              <TextInput value={reference} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReference(e.target.value)} />
              <Field.Hint />
            </Field.Root>
            <Field.Root name="note">
              <Field.Label>Note</Field.Label>
              <Textarea value={note} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNote(e.target.value)} />
            </Field.Root>
            {kind === 'refund' && (
              <>
                <Checkbox checked={restock} onCheckedChange={(v) => setRestock(v === true)}>
                  Put the items back in stock
                </Checkbox>
                <Checkbox checked={markReturned} onCheckedChange={(v) => setMarkReturned(v === true)}>
                  Mark the order as returned
                </Checkbox>
              </>
            )}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary">Cancel</Button>
          </Modal.Close>
          <Button onClick={submit} loading={busy} variant={kind === 'refund' ? 'danger' : 'default'}>
            {kind === 'payment' ? 'Record payment' : 'Issue refund'}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}

export function OrderDetail() {
  const { id = '' } = useParams();
  const printer = usePrint();
  const api = useOrdersApi();
  const { toggleNotification } = useNotification();
  const { data: order, loading, error, setData } = useLoader(() => api.detail(id), [id]);

  const [status, setStatus] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [notify, setNotify] = useState(true);
  const [collectCod, setCollectCod] = useState(true);
  const [ship, setShip] = useState<{ courier?: string; trackingNumber?: string; estimatedDelivery?: string } | null>(null);
  const [note, setNote] = useState('');
  const [noteVisible, setNoteVisible] = useState(false);
  const [busy, setBusy] = useState('');

  if (loading && !order) return <Page.Loading />;
  if (error || !order) return <Page.Error />;

  const shipping = ship ?? { courier: order.courier ?? '', trackingNumber: order.trackingNumber ?? '', estimatedDelivery: order.estimatedDelivery ?? '' };

  const run = async (key: string, path: string, body: Record<string, unknown>, success: string) => {
    setBusy(key);
    try {
      setData(await api.action(order.documentId, path, body));
      toggleNotification({ type: 'success', message: success });
      return true;
    } catch (e) {
      toggleNotification({ type: 'danger', message: (e as Error).message });
      return false;
    } finally {
      setBusy('');
    }
  };

  const balanceDue = Math.max(0, Math.round(order.total - order.paidAmount));

  return (
    <Page.Main>
      <Page.Title>{`Order ${order.orderNumber}`}</Page.Title>
      <Layouts.Header
        navigationAction={<BackButton fallback="../orders-manager" />}
        title={`Order ${order.orderNumber}`}
        subtitle={
          <Flex gap={2} alignItems="center">
            <StatusBadge value={order.orderStatus} />
            <StatusBadge value={order.paymentStatus} />
            <Typography textColor="neutral600">Placed {dateTime(order.createdAt)}</Typography>
          </Flex>
        }
        primaryAction={
          <Flex gap={2}>
            <PrintMenu loading={printer.busy} onPick={(type, size) => printer.printOrder(order.documentId, type, size)} />
            <LinkButton tag={Link} variant="tertiary" startIcon={<Pencil />} to={`/content-manager/collection-types/api::order.order/${order.documentId}`}>
              Edit raw entry
            </LinkButton>
          </Flex>
        }
      />
      <Layouts.Content>
        <Grid.Root gap={4}>
          {/* Status */}
          <Grid.Item col={12} s={12} direction="column" alignItems="stretch">
            <Card title="Order status">
              <Flex gap={3} wrap="wrap" alignItems="flex-end">
                <Box minWidth="220px">
                  <Field.Root name="status">
                    <Field.Label>New status</Field.Label>
                    <SingleSelect value={status || order.orderStatus} onChange={(v) => setStatus(String(v))}>
                      {ORDER_STATUSES.map((s) => (
                        <SingleSelectOption key={s} value={s}>{label(s)}</SingleSelectOption>
                      ))}
                    </SingleSelect>
                  </Field.Root>
                </Box>
                <Box flex="1" minWidth="240px">
                  <Field.Root name="statusNote">
                    <Field.Label>Note (optional, internal)</Field.Label>
                    <TextInput value={statusNote} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStatusNote(e.target.value)} placeholder="e.g. Confirmed on phone" />
                  </Field.Root>
                </Box>
                <Flex direction="column" alignItems="flex-start" gap={1}>
                  <Checkbox checked={notify} onCheckedChange={(v) => setNotify(v === true)}>
                    Email the customer
                  </Checkbox>
                  {(status || order.orderStatus) === 'delivered' && order.paymentMethod === 'cod' && order.paymentStatus === 'unpaid' && (
                    <Checkbox checked={collectCod} onCheckedChange={(v) => setCollectCod(v === true)}>
                      Cash collected ({rupees(order.total)})
                    </Checkbox>
                  )}
                </Flex>
                <Button
                  loading={busy === 'status'}
                  disabled={!status || status === order.orderStatus}
                  onClick={async () => {
                    if (await run('status', 'status', { status, note: statusNote, notify, collectCod }, `Status set to ${label(status)}`)) {
                      setStatus('');
                      setStatusNote('');
                    }
                  }}
                >
                  Update status
                </Button>
              </Flex>
              {order.cancelReason && (
                <Box paddingTop={3}>
                  <Typography textColor="danger600">Cancel reason: {order.cancelReason}</Typography>
                </Box>
              )}
            </Card>
          </Grid.Item>

          {/* Items */}
          <Grid.Item col={8} s={12} direction="column" alignItems="stretch">
            <Card title={`Items (${order.items.reduce((n, i) => n + i.quantity, 0)})`}>
              <Table colCount={4} rowCount={order.items.length + 1}>
                <Thead>
                  <Tr>
                    {['Product', 'Qty', 'Unit price', 'Total'].map((h) => (
                      <Th key={h}>
                        <Typography variant="sigma">{h}</Typography>
                      </Th>
                    ))}
                  </Tr>
                </Thead>
                <Tbody>
                  {order.items.map((i) => (
                    <Tr key={i.id}>
                      <Td>
                        <Flex direction="column" alignItems="flex-start">
                          {i.product ? (
                            <Link to={`/content-manager/collection-types/api::product.product/${i.product.documentId}`}>{i.productName}</Link>
                          ) : (
                            <Typography>{i.productName}</Typography>
                          )}
                          {i.sku && <Typography variant="pi" textColor="neutral600">SKU {i.sku}</Typography>}
                        </Flex>
                      </Td>
                      <Td><Typography>{i.quantity}</Typography></Td>
                      <Td><Typography>{rupees(i.unitPrice)}</Typography></Td>
                      <Td><Typography fontWeight="semiBold">{rupees(i.lineTotal)}</Typography></Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
              {order.notes && (
                <Box paddingTop={3}>
                  <Typography textColor="neutral600">Customer notes: </Typography>
                  <Typography>{order.notes}</Typography>
                </Box>
              )}
            </Card>
          </Grid.Item>

          {/* Customer */}
          <Grid.Item col={4} s={12} direction="column" alignItems="stretch">
            <Card title="Customer">
              <Flex direction="column" alignItems="flex-start" gap={1}>
                <Typography fontWeight="bold">{order.customer?.fullName}</Typography>
                <Typography>
                  <a href={`tel:${order.customer?.phone}`}>{order.customer?.phone}</a>
                </Typography>
                {order.customer?.email && <Typography><a href={`mailto:${order.customer.email}`}>{order.customer.email}</a></Typography>}
                <Typography variant="pi" textColor="neutral600">{order.user ? `Account: ${order.user.email}` : 'Guest checkout'}</Typography>
                <Box paddingTop={3}>
                  <Typography variant="sigma" textColor="neutral600">Ship to</Typography>
                </Box>
                <Typography>{order.shippingAddress?.address}</Typography>
                <Typography>
                  {order.shippingAddress?.city}, {order.shippingAddress?.province}
                </Typography>
                {order.customer?.phone && (
                  <Box paddingTop={2}>
                    <LinkButton size="S" variant="tertiary" href={`https://wa.me/${order.customer.phone.replace(/^0/, '92').replace(/\D/g, '')}`} target="_blank">
                      WhatsApp customer
                    </LinkButton>
                  </Box>
                )}
              </Flex>
            </Card>
          </Grid.Item>

          {/* Payment */}
          <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
            <Card
              title="Payment"
              action={
                <Flex gap={2}>
                  <MoneyDialog kind="payment" order={order} onDone={setData} />
                  <MoneyDialog kind="refund" order={order} onDone={setData} />
                </Flex>
              }
            >
              <Row k="Method" v={PAYMENT_METHODS[order.paymentMethod] ?? order.paymentMethod} />
              <Row k="Subtotal" v={rupees(order.subtotal)} />
              {order.discount > 0 && <Row k={`Discount${order.couponCode ? ` (${order.couponCode})` : ''}`} v={`−${rupees(order.discount)}`} />}
              <Row k={order.shippingMethod ? `Shipping — ${order.shippingMethod}` : 'Shipping'} v={order.shippingFee > 0 ? rupees(order.shippingFee) : 'Free'} />
              {order.codFee > 0 && <Row k="Cash on Delivery fee" v={rupees(order.codFee)} />}
              {order.tax > 0 && <Row k={`${order.taxLabel ?? 'Tax'}${order.taxInclusive ? ' (included)' : ''}`} v={rupees(order.tax)} />}
              <Row k="Order total" v={rupees(order.total)} strong />
              <Divider />
              <Row k="Paid" v={rupees(order.paidAmount)} />
              {order.refundedAmount > 0 && <Row k="Refunded" v={`−${rupees(order.refundedAmount)}`} />}
              <Row k="Balance due" v={rupees(balanceDue)} strong />
              {order.payments.length > 0 && (
                <Box paddingTop={3}>
                  <Typography variant="sigma" textColor="neutral600">Transactions</Typography>
                  {order.payments.map((p) => (
                    <Box key={p.id} paddingTop={2}>
                      <Flex justifyContent="space-between" gap={2}>
                        <Typography variant="pi" textColor={p.status === 'failed' ? 'neutral500' : undefined} style={p.status === 'failed' ? { textDecoration: 'line-through' } : undefined}>
                          {p.kind === 'refund' ? '↩️ Refund' : '💰 Payment'} · {PAYMENT_METHODS[p.method] ?? p.method}
                          {p.reference ? ` · ref ${p.reference}` : ''} · {dateTime(p.createdAt)}
                          {p.recordedBy ? ` · ${p.recordedBy}` : ''}
                        </Typography>
                        <Flex gap={2}>
                          {p.status !== 'completed' && <StatusBadge value={p.status === 'pending' ? 'to_verify' : p.status} />}
                          <Typography variant="pi" fontWeight="bold" textColor={p.status !== 'completed' ? 'neutral500' : p.kind === 'refund' ? 'danger600' : 'success600'}>
                            {p.kind === 'refund' ? '−' : '+'}
                            {rupees(p.amount)}
                          </Typography>
                        </Flex>
                      </Flex>
                      {p.status === 'pending' && (
                        <Flex gap={2} paddingTop={2}>
                          <Button size="S" loading={busy === `verify-${p.id}`} onClick={() => run(`verify-${p.id}`, `payments/${p.id}/verify`, { approve: true }, 'Payment verified')}>
                            Verify — money received
                          </Button>
                          <Button
                            size="S"
                            variant="danger-light"
                            loading={busy === `reject-${p.id}`}
                            onClick={() => {
                              const note = window.prompt('Why couldn’t this payment be verified? (shown to the customer)', 'No matching transaction found');
                              if (note !== null) void run(`reject-${p.id}`, `payments/${p.id}/verify`, { approve: false, note }, 'Payment rejected');
                            }}
                          >
                            Reject
                          </Button>
                        </Flex>
                      )}
                    </Box>
                  ))}
                </Box>
              )}
            </Card>
          </Grid.Item>

          {/* Shipping */}
          <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
            <Card title="Shipping">
              <Flex direction="column" alignItems="stretch" gap={3}>
                <Field.Root name="courier">
                  <Field.Label>Courier</Field.Label>
                  <TextInput value={shipping.courier} placeholder="TCS, Leopards, M&P, Trax…" onChange={(e: React.ChangeEvent<HTMLInputElement>) => setShip({ ...shipping, courier: e.target.value })} />
                </Field.Root>
                <Field.Root name="trackingNumber">
                  <Field.Label>Tracking number</Field.Label>
                  <TextInput value={shipping.trackingNumber} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setShip({ ...shipping, trackingNumber: e.target.value })} />
                </Field.Root>
                <Field.Root name="eta">
                  <Field.Label>Estimated delivery</Field.Label>
                  <TextInput type="date" value={shipping.estimatedDelivery} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setShip({ ...shipping, estimatedDelivery: e.target.value })} />
                </Field.Root>
                <Flex gap={2}>
                  <Button variant="secondary" loading={busy === 'ship'} onClick={() => run('ship', 'shipping', shipping, 'Shipping details saved').then(() => setShip(null))}>
                    Save
                  </Button>
                  {!['shipped', 'delivered', 'cancelled', 'returned'].includes(order.orderStatus) && (
                    <Button loading={busy === 'ship2'} onClick={() => run('ship2', 'shipping', { ...shipping, markShipped: true, notify: true }, 'Marked as shipped — customer emailed').then(() => setShip(null))}>
                      Save &amp; mark shipped
                    </Button>
                  )}
                </Flex>
              </Flex>
            </Card>
          </Grid.Item>

          {/* Timeline */}
          <Grid.Item col={12} s={12} direction="column" alignItems="stretch">
            <Card title="Timeline">
              <Flex gap={3} alignItems="flex-end" paddingBottom={4} wrap="wrap">
                <Box flex="1" minWidth="260px">
                  <Field.Root name="note">
                    <Field.Label>Add a note</Field.Label>
                    <TextInput value={note} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNote(e.target.value)} placeholder="Called customer, will deliver Friday…" />
                  </Field.Root>
                </Box>
                <Checkbox checked={noteVisible} onCheckedChange={(v) => setNoteVisible(v === true)}>
                  Visible to customer
                </Checkbox>
                <Button
                  variant="secondary"
                  loading={busy === 'note'}
                  disabled={!note.trim()}
                  onClick={async () => {
                    if (await run('note', 'notes', { message: note, visibleToCustomer: noteVisible }, 'Note added')) setNote('');
                  }}
                >
                  Add note
                </Button>
              </Flex>
              <Flex direction="column" alignItems="stretch" gap={2}>
                {order.events.map((e) => (
                  <Flex key={e.id} gap={3} alignItems="flex-start">
                    <Typography>{EVENT_ICON[e.type] ?? '•'}</Typography>
                    <Flex direction="column" alignItems="flex-start" flex="1">
                      <Typography>{e.message}</Typography>
                      <Typography variant="pi" textColor="neutral600">
                        {dateTime(e.createdAt)} · {e.actor}
                        {e.visibleToCustomer ? ' · visible to customer' : ''}
                      </Typography>
                    </Flex>
                  </Flex>
                ))}
                {order.events.length === 0 && <Typography textColor="neutral600">No activity yet.</Typography>}
              </Flex>
            </Card>
          </Grid.Item>
        </Grid.Root>
      </Layouts.Content>
    </Page.Main>
  );
}

