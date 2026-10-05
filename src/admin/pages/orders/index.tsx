import { Route, Routes } from 'react-router-dom';
import { OrderDetail } from './OrderDetail';
import { OrdersList } from './OrdersList';

/** "Orders" manager page (sidebar link registered in src/admin/app.tsx). */
export default function OrdersManagerPage() {
  return (
    <Routes>
      <Route index element={<OrdersList />} />
      <Route path=":id" element={<OrderDetail />} />
    </Routes>
  );
}
