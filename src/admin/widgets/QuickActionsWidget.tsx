import { Box, Flex, Typography } from '@strapi/design-system';
import { Link } from 'react-router-dom';

const STOREFRONT = 'http://localhost:3000'; // shown as a link only; update when the store is deployed

const actions = [
  { label: 'Add a product', to: '/content-manager/collection-types/api::product.product/create' },
  { label: 'Manage orders', to: '/orders-manager' },
  { label: 'Create a coupon', to: '/content-manager/collection-types/api::coupon.coupon/create' },
  { label: 'Edit home banners', to: '/content-manager/collection-types/api::banner.banner' },
  { label: 'Store settings (contact, shipping)', to: '/content-manager/single-types/api::global.global' },
  { label: 'Approve reviews', to: '/content-manager/collection-types/api::review.review' },
];

export default function QuickActionsWidget() {
  return (
    <Flex direction="column" alignItems="stretch" gap={1}>
      {actions.map((a) => (
        <Link key={a.to} to={a.to} style={{ textDecoration: 'none' }}>
          <Box padding={2} hasRadius background="neutral100">
            <Typography textColor="primary600" fontWeight="semiBold">
              {a.label} →
            </Typography>
          </Box>
        </Link>
      ))}
      <Box paddingTop={2}>
        <Typography variant="pi" textColor="neutral500">
          Storefront:{' '}
          <a href={STOREFRONT} target="_blank" rel="noreferrer">
            {STOREFRONT}
          </a>
        </Typography>
      </Box>
    </Flex>
  );
}
