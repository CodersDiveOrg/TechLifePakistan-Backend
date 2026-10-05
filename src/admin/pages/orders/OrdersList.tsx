import {
  Box,
  Button,
  Checkbox,
  Flex,
  Searchbar,
  SingleSelect,
  SingleSelectOption,
  Table,
  Tbody,
  Td,
  TextInput,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Download } from '@strapi/icons';
import { Layouts, Page, useNotification } from '@strapi/strapi/admin';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PrintMenu, usePrint } from './print';
import { dateTime, label, ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES, rupees, StatusBadge, useLoader, useOrdersApi } from './shared';

export function OrdersList() {
  const api = useOrdersApi();
  const printer = usePrint();
  const navigate = useNavigate();
  const { toggleNotification } = useNotification();
  const [status, setStatus] = useState('all');
  const [payment, setPayment] = useState('');
  const [method, setMethod] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [searchParams] = useSearchParams();
  const [verify, setVerify] = useState(searchParams.get('verify') === '1');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkNotify, setBulkNotify] = useState(true);
  const [busy, setBusy] = useState(false);

  const filters = { status, payment, method, q, from, to, verify: verify ? '1' : '' };
  const params = Object.fromEntries(Object.entries({ ...filters, page: String(page), pageSize: '20' }).filter(([, v]) => v));
  const { data, loading, error, reload } = useLoader(() => api.list(params), [status, payment, method, q, from, to, verify, page]);

  const counts = data?.meta.counts ?? {};
  const allCount = Object.values(counts).reduce((n, c) => n + c, 0);
  const rows = data?.data ?? [];
  const allSelected = rows.length > 0 && rows.every((r) => selected.includes(r.documentId));

  const setFilter = (fn: () => void) => {
    fn();
    setPage(1);
    setSelected([]);
  };

  const applyBulk = async () => {
    if (!bulkStatus || !selected.length) return;
    setBusy(true);
    try {
      const res = await api.bulkStatus(selected, bulkStatus, bulkNotify);
      toggleNotification({ type: res.failed.length ? 'warning' : 'success', message: `${res.updated} order(s) set to ${label(bulkStatus)}${res.failed.length ? `, ${res.failed.length} failed` : ''}` });
      setSelected([]);
      setBulkStatus('');
      reload();
    } catch (e) {
      toggleNotification({ type: 'danger', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    try {
      await api.exportCsv(Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as Record<string, string>);
    } catch (e) {
      toggleNotification({ type: 'danger', message: (e as Error).message });
    }
  };

  return (
    <Page.Main>
      <Page.Title>Orders</Page.Title>
      <Layouts.Header
        title="Orders"
        subtitle={`${allCount} order${allCount === 1 ? '' : 's'} match the current filters`}
        primaryAction={
          <Button variant="secondary" startIcon={<Download />} onClick={exportCsv}>
            Export CSV
          </Button>
        }
      />
      <Layouts.Content>
        {/* Status tabs */}
        <Flex gap={2} wrap="wrap" paddingBottom={4}>
          {[['all', allCount] as const, ...ORDER_STATUSES.map((s) => [s, counts[s] ?? 0] as const)].map(([s, n]) => (
            <Button key={s} size="S" variant={status === s ? 'default' : 'tertiary'} onClick={() => setFilter(() => setStatus(s))}>
              {s === 'all' ? 'All' : label(s)} ({n})
            </Button>
          ))}
        </Flex>

        {(data?.meta.awaitingVerification ?? 0) > 0 || verify ? (
          <Box background="warning100" padding={3} hasRadius marginBottom={4} borderColor="warning200">
            <Flex gap={3} justifyContent="space-between" wrap="wrap">
              <Typography textColor="warning700" fontWeight="semiBold">
                {data?.meta.awaitingVerification ?? 0} customer payment{data?.meta.awaitingVerification === 1 ? '' : 's'} awaiting verification
              </Typography>
              <Button size="S" variant={verify ? 'default' : 'secondary'} onClick={() => setFilter(() => setVerify((v) => !v))}>
                {verify ? 'Show all orders' : 'Show these orders'}
              </Button>
            </Flex>
          </Box>
        ) : null}

        {/* Filters */}
        <Box background="neutral0" padding={4} hasRadius shadow="tableShadow" marginBottom={4}>
          <Flex gap={3} wrap="wrap" alignItems="flex-end">
            <Box minWidth="260px" flex="1">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setFilter(() => setQ(search));
                }}
              >
                <Searchbar
                  name="q"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onClear={() => {
                    setSearch('');
                    setFilter(() => setQ(''));
                  }}
                  clearLabel="Clear"
                  placeholder="Order #, customer, phone, email, city, tracking #"
                >
                  Search orders
                </Searchbar>
              </form>
            </Box>
            <Box minWidth="180px">
              <SingleSelect aria-label="Payment status" placeholder="Payment status" value={payment} onChange={(v) => setFilter(() => setPayment(String(v)))} onClear={() => setFilter(() => setPayment(''))}>
                {PAYMENT_STATUSES.map((s) => (
                  <SingleSelectOption key={s} value={s}>{label(s)}</SingleSelectOption>
                ))}
              </SingleSelect>
            </Box>
            <Box minWidth="180px">
              <SingleSelect aria-label="Payment method" placeholder="Payment method" value={method} onChange={(v) => setFilter(() => setMethod(String(v)))} onClear={() => setFilter(() => setMethod(''))}>
                {Object.entries(PAYMENT_METHODS).slice(0, 3).map(([k, v]) => (
                  <SingleSelectOption key={k} value={k}>{v}</SingleSelectOption>
                ))}
              </SingleSelect>
            </Box>
            <Box width="160px">
              <TextInput type="date" aria-label="From date" value={from} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilter(() => setFrom(e.target.value))} />
            </Box>
            <Box width="160px">
              <TextInput type="date" aria-label="To date" value={to} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilter(() => setTo(e.target.value))} />
            </Box>
          </Flex>
        </Box>

        {/* Bulk actions */}
        {selected.length > 0 && (
          <Box background="primary100" padding={3} hasRadius marginBottom={4}>
            <Flex gap={3} wrap="wrap" alignItems="center">
              <Typography fontWeight="bold">{selected.length} selected</Typography>
              <Box minWidth="200px">
                <SingleSelect aria-label="New status" placeholder="Set status to…" value={bulkStatus} onChange={(v) => setBulkStatus(String(v))}>
                  {ORDER_STATUSES.map((s) => (
                    <SingleSelectOption key={s} value={s}>{label(s)}</SingleSelectOption>
                  ))}
                </SingleSelect>
              </Box>
              <Checkbox checked={bulkNotify} onCheckedChange={(v) => setBulkNotify(v === true)}>
                Email customers
              </Checkbox>
              <Button onClick={applyBulk} loading={busy} disabled={!bulkStatus}>
                Apply
              </Button>
              <PrintMenu label={`Print ${selected.length} order${selected.length === 1 ? '' : 's'}`} loading={printer.busy} onPick={(type, size) => printer.printOrders(selected, type, size)} />
              <Button variant="tertiary" onClick={() => setSelected([])}>
                Clear selection
              </Button>
            </Flex>
          </Box>
        )}

        {error ? (
          <Typography textColor="danger600">{error}</Typography>
        ) : (
          <Table colCount={9} rowCount={rows.length + 1}>
            <Thead>
              <Tr>
                <Th>
                  <Checkbox
                    aria-label="Select all"
                    checked={allSelected}
                    onCheckedChange={(v) => setSelected(v === true ? rows.map((r) => r.documentId) : [])}
                  />
                </Th>
                {['Order', 'Placed', 'Customer', 'City', 'Items', 'Total', 'Payment', 'Status'].map((h) => (
                  <Th key={h}>
                    <Typography variant="sigma">{h}</Typography>
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {loading && rows.length === 0 ? (
                <Tr>
                  <Td colSpan={9}>
                    <Typography textColor="neutral600">Loading orders…</Typography>
                  </Td>
                </Tr>
              ) : rows.length === 0 ? (
                <Tr>
                  <Td colSpan={9}>
                    <Box padding={6}>
                      <Typography textColor="neutral600">No orders match these filters.</Typography>
                    </Box>
                  </Td>
                </Tr>
              ) : (
                rows.map((o) => (
                  <Tr key={o.documentId} onClick={() => navigate(o.documentId)} style={{ cursor: 'pointer' }}>
                    <Td onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                      <Checkbox
                        aria-label={`Select ${o.orderNumber}`}
                        checked={selected.includes(o.documentId)}
                        onCheckedChange={(v) => setSelected((s) => (v === true ? [...s, o.documentId] : s.filter((x) => x !== o.documentId)))}
                      />
                    </Td>
                    <Td>
                      <Typography fontWeight="bold">{o.orderNumber}</Typography>
                    </Td>
                    <Td>
                      <Typography>{dateTime(o.createdAt)}</Typography>
                    </Td>
                    <Td>
                      <Flex direction="column" alignItems="flex-start">
                        <Typography>{o.customer}</Typography>
                        <Typography variant="pi" textColor="neutral600">{o.phone}</Typography>
                      </Flex>
                    </Td>
                    <Td>
                      <Typography>{o.city}</Typography>
                    </Td>
                    <Td>
                      <Typography>{o.items}</Typography>
                    </Td>
                    <Td>
                      <Typography fontWeight="semiBold">{rupees(o.total)}</Typography>
                    </Td>
                    <Td>
                      <Flex direction="column" alignItems="flex-start" gap={1}>
                        <StatusBadge value={o.paymentStatus} />
                        {o.awaitingVerification && <StatusBadge value="to_verify" />}
                        <Typography variant="pi" textColor="neutral600">{PAYMENT_METHODS[o.paymentMethod] ?? o.paymentMethod}</Typography>
                      </Flex>
                    </Td>
                    <Td>
                      <StatusBadge value={o.orderStatus} />
                    </Td>
                  </Tr>
                ))
              )}
            </Tbody>
          </Table>
        )}

        {data && data.meta.pageCount > 1 && (
          <Flex justifyContent="flex-end" gap={2} paddingTop={4} alignItems="center">
            <Button variant="tertiary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Typography>
              Page {data.meta.page} of {data.meta.pageCount}
            </Typography>
            <Button variant="tertiary" disabled={page >= data.meta.pageCount} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </Flex>
        )}
      </Layouts.Content>
    </Page.Main>
  );
}
