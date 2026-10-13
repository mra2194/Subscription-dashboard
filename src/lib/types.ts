import type { AccessStatus } from './format';

export type AdminRole = 'superadmin' | 'sales' | 'support' | 'viewer';

export interface AdminProfile {
  id: string;
  email: string;
  full_name: string;
  role: AdminRole;
  is_active: boolean;
  must_change_password: boolean;
}

export interface TenantOverview {
  id: string;
  customer_code: string;
  business_name: string;
  owner_name: string;
  owner_phone: string;
  tenant_status: string;
  plan_code: string | null;
  plan_name: string | null;
  access_status: AccessStatus;
  starts_at: string | null;
  ends_at: string | null;
  grace_until: string | null;
  days_left: number | null;
  pos_devices_used: number;
  max_pos_devices: number | null;
  users_used: number;
  max_users: number | null;
  last_seen_at: string | null;
  sales_30d: number;
  price: number | null;
  billing_cycle: string | null;
  license_key_prefix: string | null;
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  max_outlets: number;
  max_pos_devices: number;
  max_users: number;
  price_monthly: number;
  price_yearly: number | null;
}

export const canWrite = (role: AdminRole | undefined) => role === 'superadmin' || role === 'sales';
export const isSuperadmin = (role: AdminRole | undefined) => role === 'superadmin';
export const canManageDevices = (role: AdminRole | undefined) => role === 'superadmin' || role === 'support';
