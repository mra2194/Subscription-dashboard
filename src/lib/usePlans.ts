import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Plan } from './types';

export { priceFor } from './pricing';

export function usePlans(): Plan[] {
  const [plans, setPlans] = useState<Plan[]>([]);
  useEffect(() => {
    api<Plan[]>('plans').then(setPlans).catch(() => setPlans([]));
  }, []);
  return plans;
}
