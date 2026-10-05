import { useEffect, useState } from 'react';
import { useFetchClient } from '@strapi/strapi/admin';

/** Loads JSON from one of the admin-only /store-dashboard endpoints (see src/bootstrap/dashboard.ts). */
export function useDashboard<T>(path: string) {
  const { get } = useFetchClient();
  const [state, setState] = useState<{ data?: T; error?: boolean; loading: boolean }>({ loading: true });

  useEffect(() => {
    let alive = true;
    get<T>(`/store-dashboard/${path}`)
      .then((res) => alive && setState({ data: res.data, loading: false }))
      .catch(() => alive && setState({ error: true, loading: false }));
    return () => {
      alive = false;
    };
  }, [get, path]);

  return state;
}
