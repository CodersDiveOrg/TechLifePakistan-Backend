export const rupees = (n: number) => `Rs. ${Math.round(n).toLocaleString('en-PK')}`;

export const ORDER_STATUS_TONE: Record<string, 'neutral' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger'> = {
  pending: 'warning',
  confirmed: 'primary',
  processing: 'secondary',
  shipped: 'primary',
  delivered: 'success',
  cancelled: 'danger',
  returned: 'neutral',
};

export const editUrl = (uid: string, documentId: string) => `/content-manager/collection-types/${uid}/${documentId}`;
export const listUrl = (uid: string, query = '') => `/content-manager/collection-types/${uid}${query ? `?${query}` : ''}`;
