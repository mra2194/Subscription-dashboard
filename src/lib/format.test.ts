import { describe, expect, it } from 'vitest';
import { isCountedAsRevenue, monthlyValue } from './format';
import { priceFor } from './pricing';

describe('revenue helpers', () => {
  it('normalises yearly price to monthly', () => {
    expect(monthlyValue(1_200_000, 'yearly')).toBe(100_000);
    expect(monthlyValue(150_000, 'monthly')).toBe(150_000);
    expect(monthlyValue(null, 'monthly')).toBe(0);
  });
  it('counts only active and grace customers', () => {
    expect(isCountedAsRevenue('active')).toBe(true);
    expect(isCountedAsRevenue('grace')).toBe(true);
    expect(isCountedAsRevenue('suspended')).toBe(false);
    expect(isCountedAsRevenue('expired')).toBe(false);
  });
  it('prices plans by cycle', () => {
    const plan = { id: '1', code: 'STARTER', name: 'Starter', max_outlets: 1, max_pos_devices: 2, max_users: 5, price_monthly: 150000, price_yearly: 1500000 };
    expect(priceFor(plan, 'monthly', 3)).toBe(450000);
    expect(priceFor(plan, 'yearly', 12)).toBe(1500000);
    expect(priceFor(undefined, 'monthly', 1)).toBe(0);
  });
});
