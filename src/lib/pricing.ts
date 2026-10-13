import type { Plan } from './types';

export function priceFor(plan: Plan | undefined, cycle: string, months: number): number {
  if (!plan) return 0;
  if (cycle === 'yearly' && plan.price_yearly != null) return Number(plan.price_yearly) * Math.max(1, Math.round(months / 12));
  return Number(plan.price_monthly) * months;
}
