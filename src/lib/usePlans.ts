import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import type { Plan } from './types';

export { priceFor } from './pricing';

export function usePlans(): Plan[] {
  const [plans, setPlans] = useState<Plan[]>([]);
  useEffect(() => {
    supabase
      .from('plans')
      .select('id, code, name, max_outlets, max_pos_devices, max_users, price_monthly, price_yearly')
      .eq('is_active', true)
      .order('price_monthly')
      .then(({ data }) => setPlans((data ?? []) as Plan[]));
  }, []);
  return plans;
}
