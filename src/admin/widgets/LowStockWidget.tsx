import { Badge, Box, Flex, Typography } from '@strapi/design-system';
import { Widget } from '@strapi/strapi/admin';
import { Link } from 'react-router-dom';
import { editUrl } from './format';
import { useDashboard } from './useDashboard';

interface LowStock {
  documentId: string;
  name: string;
  sku: string;
  stock: number;
  threshold: number;
}

export default function LowStockWidget() {
  const { data, loading, error } = useDashboard<LowStock[]>('low-stock');
  if (loading) return <Widget.Loading />;
  if (error || !data) return <Widget.Error />;
  if (data.length === 0) return <Widget.NoData>All products are above their low-stock threshold.</Widget.NoData>;

  return (
    <Flex direction="column" alignItems="stretch" gap={1}>
      {data.map((p) => (
        <Link key={p.documentId} to={editUrl('api::product.product', p.documentId)} style={{ textDecoration: 'none' }}>
          <Box padding={2} hasRadius background="neutral0" borderColor="neutral150" borderStyle="solid" borderWidth="1px">
            <Flex justifyContent="space-between" gap={2}>
              <Flex direction="column" alignItems="flex-start">
                <Typography fontWeight="semiBold" textColor="neutral800" ellipsis>
                  {p.name}
                </Typography>
                <Typography variant="pi" textColor="neutral600">
                  {p.sku} · alert at {p.threshold}
                </Typography>
              </Flex>
              <Badge backgroundColor={p.stock === 0 ? 'danger100' : 'warning100'} textColor={p.stock === 0 ? 'danger700' : 'warning700'}>
                {p.stock === 0 ? 'Out of stock' : `${p.stock} left`}
              </Badge>
            </Flex>
          </Box>
        </Link>
      ))}
    </Flex>
  );
}
