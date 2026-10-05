import { Badge, Box, Flex, Typography } from '@strapi/design-system';
import { Widget } from '@strapi/strapi/admin';
import { Link } from 'react-router-dom';
import { ORDER_STATUS_TONE, rupees } from './format';
import { useDashboard } from './useDashboard';

interface RecentOrder {
  documentId: string;
  orderNumber: string;
  customer: string;
  total: number;
  orderStatus: string;
  paymentStatus: string;
  createdAt: string;
}

const TONE_COLORS: Record<string, [string, string]> = {
  warning: ['warning100', 'warning700'],
  primary: ['primary100', 'primary700'],
  secondary: ['secondary100', 'secondary700'],
  success: ['success100', 'success700'],
  danger: ['danger100', 'danger700'],
  neutral: ['neutral150', 'neutral700'],
};

export default function RecentOrdersWidget() {
  const { data, loading, error } = useDashboard<RecentOrder[]>('recent-orders');
  if (loading) return <Widget.Loading />;
  if (error || !data) return <Widget.Error />;
  if (data.length === 0) return <Widget.NoData>No orders yet — they’ll appear here as soon as customers check out.</Widget.NoData>;

  return (
    <Flex direction="column" alignItems="stretch" gap={1}>
      {data.map((o) => {
        const [bg, fg] = TONE_COLORS[ORDER_STATUS_TONE[o.orderStatus] ?? 'neutral'];
        return (
          <Link key={o.documentId} to={`/orders-manager/${o.documentId}`} style={{ textDecoration: 'none' }}>
            <Box padding={2} hasRadius background="neutral0" borderColor="neutral150" borderStyle="solid" borderWidth="1px">
              <Flex justifyContent="space-between" gap={2}>
                <Flex direction="column" alignItems="flex-start">
                  <Typography fontWeight="bold" textColor="neutral800">
                    {o.orderNumber}
                  </Typography>
                  <Typography variant="pi" textColor="neutral600">
                    {o.customer} · {new Date(o.createdAt).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })}
                  </Typography>
                </Flex>
                <Flex direction="column" alignItems="flex-end" gap={1}>
                  <Typography fontWeight="semiBold" textColor="neutral800">
                    {rupees(o.total)}
                  </Typography>
                  <Badge backgroundColor={bg} textColor={fg}>
                    {o.orderStatus}
                  </Badge>
                </Flex>
              </Flex>
            </Box>
          </Link>
        );
      })}
    </Flex>
  );
}
