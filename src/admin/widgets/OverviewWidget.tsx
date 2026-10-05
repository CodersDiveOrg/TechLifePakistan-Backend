import { Box, Flex, Grid, Typography } from '@strapi/design-system';
import { Widget } from '@strapi/strapi/admin';
import { Link } from 'react-router-dom';
import { listUrl, rupees } from './format';
import { useDashboard } from './useDashboard';

interface Overview {
  todayOrders: number;
  revenue30d: number;
  orders30d: number;
  openOrders: number;
  unpaidDelivered: number;
  products: number;
  pendingReviews: number;
  unreadMessages: number;
}

function Stat({ label, value, hint, to }: { label: string; value: string | number; hint?: string; to?: string }) {
  const body = (
    <Box padding={4} background="neutral100" hasRadius height="100%" width="100%">
      <Typography variant="sigma" textColor="neutral600" tag="p">
        {label}
      </Typography>
      <Typography variant="alpha" tag="p" textColor="neutral800">
        {value}
      </Typography>
      {hint && (
        <Typography variant="pi" textColor="neutral500">
          {hint}
        </Typography>
      )}
    </Box>
  );
  return to ? (
    <Link to={to} style={{ textDecoration: 'none', display: 'block', height: '100%', width: '100%' }}>
      {body}
    </Link>
  ) : (
    body
  );
}

export default function OverviewWidget() {
  const { data, loading, error } = useDashboard<Overview>('overview');
  if (loading) return <Widget.Loading />;
  if (error || !data) return <Widget.Error />;

  return (
    <Flex direction="column" alignItems="stretch" gap={3}>
      <Grid.Root gap={3} gridCols={2}>
        <Grid.Item col={1} s={2} alignItems="stretch">
          <Stat label="Revenue · 30 days" value={rupees(data.revenue30d)} hint={`${data.orders30d} orders (excl. cancelled)`} />
        </Grid.Item>
        <Grid.Item col={1} s={2} alignItems="stretch">
          <Stat label="Orders today" value={data.todayOrders} to={listUrl('api::order.order')} />
        </Grid.Item>
        <Grid.Item col={1} s={2} alignItems="stretch">
          <Stat
            label="Open orders"
            value={data.openOrders}
            hint="pending → shipped"
            to={listUrl('api::order.order', 'filters[$and][0][orderStatus][$in][0]=pending&filters[$and][0][orderStatus][$in][1]=confirmed&filters[$and][0][orderStatus][$in][2]=processing&filters[$and][0][orderStatus][$in][3]=shipped')}
          />
        </Grid.Item>
        <Grid.Item col={1} s={2} alignItems="stretch">
          <Stat
            label="Delivered, unpaid"
            value={data.unpaidDelivered}
            hint="COD to reconcile"
            to={listUrl('api::order.order', 'filters[$and][0][orderStatus][$eq]=delivered&filters[$and][1][paymentStatus][$eq]=unpaid')}
          />
        </Grid.Item>
        <Grid.Item col={1} s={2} alignItems="stretch">
          <Stat label="Reviews to approve" value={data.pendingReviews} to={listUrl('api::review.review')} />
        </Grid.Item>
        <Grid.Item col={1} s={2} alignItems="stretch">
          <Stat
            label="New messages"
            value={data.unreadMessages}
            to={listUrl('api::contact-message.contact-message', 'filters[$and][0][handled][$eq]=false')}
          />
        </Grid.Item>
      </Grid.Root>
      <Typography variant="pi" textColor="neutral500">
        {data.products} published products
      </Typography>
    </Flex>
  );
}
