import { describe, expect, it } from 'vitest';
import { loadAppsScript } from './fakeAppsScript';

const ADMIN = 'ridho@example.com';
const TEMP = 'Sementara-2026';
const STRONG = 'Kopi-Susu-Gula-2026';

function setupEnv() {
  const env = loadAppsScript({ ADMIN_EMAIL: ADMIN, ADMIN_TEMP_PASSWORD: TEMP });
  env.run('setup');
  return env;
}

function loginAndChange(env: ReturnType<typeof setupEnv>) {
  const login = env.call({ action: 'login', email: ADMIN, password: TEMP });
  const token = login.data.token as string;
  expect(env.call({ action: 'changePassword', token, current_password: TEMP, new_password: STRONG }).ok).toBe(true);
  return token;
}

describe('setup', () => {
  it('creates tables, plans and a superadmin that must change password; removes the temp password property', () => {
    const env = setupEnv();
    expect([...env.ss.sheets.keys()]).toEqual(expect.arrayContaining(['admins', 'plans', 'tenants', 'subscriptions', 'license_keys', 'devices', 'audit_log']));
    expect(env.ss.getSheetByName('plans')!.rows.length).toBe(4);
    expect(env.properties.has('ADMIN_TEMP_PASSWORD')).toBe(false);
    expect(env.properties.get('PASSWORD_PEPPER')!.length).toBeGreaterThanOrEqual(32);
    const adminRow = env.ss.getSheetByName('admins')!.rows[1];
    expect(adminRow).not.toContain(TEMP);
    env.run('setup'); // idempoten
    expect(env.ss.getSheetByName('admins')!.rows.length).toBe(2);
  });
});

describe('login & forced password change', () => {
  it('rejects wrong password and locks out after 5 failures', () => {
    const env = setupEnv();
    for (let i = 0; i < 5; i++) expect(env.call({ action: 'login', email: ADMIN, password: 'salah' }).error).toBe('INVALID_LOGIN');
    expect(env.call({ action: 'login', email: ADMIN, password: TEMP }).error).toBe('LOCKED_OUT');
    env.advance(16 * 60 * 1000);
    expect(env.call({ action: 'login', email: ADMIN, password: TEMP }).ok).toBe(true);
  });

  it('blocks all data actions until the password is changed', () => {
    const env = setupEnv();
    const login = env.call({ action: 'login', email: ADMIN, password: TEMP });
    expect(login.data.profile.must_change_password).toBe(true);
    const token = login.data.token;
    expect(env.call({ action: 'overview', token }).error).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(env.call({ action: 'createTenant', token }).error).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(env.call({ action: 'me', token }).ok).toBe(true);
  });

  it('validates current and new password, then unlocks access', () => {
    const env = setupEnv();
    const token = env.call({ action: 'login', email: ADMIN, password: TEMP }).data.token;
    expect(env.call({ action: 'changePassword', token, current_password: 'salah', new_password: STRONG }).error).toBe('WRONG_CURRENT_PASSWORD');
    expect(env.call({ action: 'changePassword', token, current_password: TEMP, new_password: 'pendek' }).error).toMatch(/^WEAK_PASSWORD/);
    expect(env.call({ action: 'changePassword', token, current_password: TEMP, new_password: 'Ridho-Admin-2026' }).error).toMatch(/nama email/);
    const changed = env.call({ action: 'changePassword', token, current_password: TEMP, new_password: STRONG });
    expect(changed.data.profile.must_change_password).toBe(false);
    expect(env.call({ action: 'overview', token }).ok).toBe(true);
    expect(env.call({ action: 'login', email: ADMIN, password: TEMP }).error).toBe('INVALID_LOGIN');
    expect(env.call({ action: 'login', email: ADMIN, password: STRONG }).ok).toBe(true);
  });

  it('expires idle sessions after 30 minutes and supports logout', () => {
    const env = setupEnv();
    const token = loginAndChange(env);
    env.advance(29 * 60 * 1000);
    expect(env.call({ action: 'overview', token }).ok).toBe(true); // sliding
    env.advance(31 * 60 * 1000);
    expect(env.call({ action: 'overview', token }).error).toBe('UNAUTHENTICATED');
    const t2 = env.call({ action: 'login', email: ADMIN, password: STRONG }).data.token;
    env.call({ action: 'logout', token: t2 });
    expect(env.call({ action: 'overview', token: t2 }).error).toBe('UNAUTHENTICATED');
  });

  it('rejects requests without a valid token and unknown actions', () => {
    const env = setupEnv();
    expect(env.call({ action: 'overview' }).error).toBe('UNAUTHENTICATED');
    expect(env.call({ action: 'overview', token: 'palsu' }).error).toBe('UNAUTHENTICATED');
    expect(env.call({ action: 'dropEverything' }).error).toBe('UNKNOWN_ACTION');
  });
});

describe('customers, subscriptions, license keys', () => {
  it('creates a customer, issues a one-time key, extends, suspends, and audits', () => {
    const env = setupEnv();
    const token = loginAndChange(env);
    const created = env.call({
      action: 'createTenant', token, business_name: 'Toko Maju', owner_name: 'Budi', owner_phone: '+628123',
      owner_email: '', address: '=HYPERLINK("http://evil")', plan_code: 'STARTER', starts_at: new Date(Date.now() - 86400000).toISOString(),
      months: 1, billing_cycle: 'monthly', price: 150000,
    });
    expect(created.ok).toBe(true);
    expect(created.data.customer_code).toBe('CUST-00001');
    const id = created.data.id;

    // Formula injection dicegah, nilai tetap utuh saat dibaca
    for (const s of env.ss.sheets.values()) expect(s.formulas).toEqual([]);

    const key1 = env.call({ action: 'issueLicenseKey', token, tenant_id: id }).data.license_key;
    expect(key1).toMatch(/^AAL-[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/);
    const key2 = env.call({ action: 'issueLicenseKey', token, tenant_id: id }).data.license_key;
    expect(key2).not.toBe(key1);

    const detail = env.call({ action: 'tenantDetail', token, tenant_id: id }).data;
    expect(detail.license_keys.filter((k: any) => !k.revoked_at)).toHaveLength(1);
    expect(JSON.stringify(detail)).not.toContain('key_hash');
    expect(JSON.stringify(detail)).not.toContain(key2);
    expect(detail.tenant.owner_phone).toBe('+628123');

    expect(env.call({ action: 'extendSubscription', token, tenant_id: id, plan_code: 'PRO', months: 12, billing_cycle: 'yearly', price: 3000000 }).ok).toBe(true);
    const row = env.call({ action: 'overview', token }).data[0];
    expect(row.plan_code).toBe('STARTER'); // paket berjalan tetap sampai periodenya habis
    expect(row.days_left).toBeGreaterThan(380);
    expect(row.max_pos_devices).toBe(2);
    expect(row.access_status).toBe('active');

    expect(env.call({ action: 'setTenantStatus', token, tenant_id: id, status: 'suspended', note: 'telat bayar' }).ok).toBe(true);
    expect(env.call({ action: 'overview', token }).data[0].access_status).toBe('suspended');
    expect(() => env.run('assertDeviceQuota_', id)).toThrow('LICENSE_INACTIVE');

    const actions = env.call({ action: 'tenantDetail', token, tenant_id: id }).data.audit.map((a: any) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['tenant.create', 'license.issue', 'subscription.extend', 'tenant.status']));
  });

  it('enforces POS device quota', () => {
    const env = setupEnv();
    const token = loginAndChange(env);
    const id = env.call({ action: 'createTenant', token, business_name: 'A', owner_name: 'B', owner_phone: '1', plan_code: 'STARTER', starts_at: new Date().toISOString(), months: 1, billing_cycle: 'monthly', price: 1 }).data.id;
    const devices = env.ss.getSheetByName('devices')!;
    const add = (n: number) => devices.appendRow([`d${n}`, id, 'pos', `fp${n}`, `Kasir ${n}`, '1.0', new Date().toISOString(), '', '', '', '']);
    env.run('assertDeviceQuota_', id); add(1);
    env.run('assertDeviceQuota_', id); add(2);
    expect(() => env.run('assertDeviceQuota_', id)).toThrow('DEVICE_QUOTA_EXCEEDED: 2 of 2');
    expect(env.call({ action: 'deactivateDevice', token, device_id: 'd1', reason: 'rusak' }).ok).toBe(true);
    expect(() => env.run('assertDeviceQuota_', id)).not.toThrow();
  });

  it('enforces roles: viewer reads only, sales cannot suspend or issue keys', () => {
    const env = setupEnv();
    const token = loginAndChange(env);
    const id = env.call({ action: 'createTenant', token, business_name: 'A', owner_name: 'B', owner_phone: '1', plan_code: 'STARTER', starts_at: new Date().toISOString(), months: 1, billing_cycle: 'monthly', price: 1 }).data.id;
    env.run('addAdmin', 'viewer@example.com', 'V', 'viewer', 'Viewer-Temp-2026');
    env.run('addAdmin', 'sales@example.com', 'S', 'sales', 'Sales-Temp-2026');
    const vt = env.call({ action: 'login', email: 'viewer@example.com', password: 'Viewer-Temp-2026' }).data.token;
    env.call({ action: 'changePassword', token: vt, current_password: 'Viewer-Temp-2026', new_password: 'Lihat-Saja-2026x' });
    const st = env.call({ action: 'login', email: 'sales@example.com', password: 'Sales-Temp-2026' }).data.token;
    env.call({ action: 'changePassword', token: st, current_password: 'Sales-Temp-2026', new_password: 'Jualan-Laris-2026' });

    expect(env.call({ action: 'overview', token: vt }).data).toHaveLength(1);
    expect(env.call({ action: 'tenantDetail', token: vt, tenant_id: id }).data.audit).toEqual([]);
    expect(env.call({ action: 'createTenant', token: vt }).error).toBe('FORBIDDEN');
    expect(env.call({ action: 'extendSubscription', token: vt, tenant_id: id, plan_code: 'PRO', months: 1, price: 1 }).error).toBe('FORBIDDEN');
    expect(env.call({ action: 'issueLicenseKey', token: st, tenant_id: id }).error).toBe('FORBIDDEN');
    expect(env.call({ action: 'setTenantStatus', token: st, tenant_id: id, status: 'suspended' }).error).toBe('FORBIDDEN');
    expect(env.call({ action: 'extendSubscription', token: st, tenant_id: id, plan_code: 'PRO', months: 1, billing_cycle: 'monthly', price: 1 }).ok).toBe(true);
  });

  it('validates input and hides internal errors', () => {
    const env = setupEnv();
    const token = loginAndChange(env);
    expect(env.call({ action: 'createTenant', token, business_name: '', owner_name: 'B', owner_phone: '1', plan_code: 'STARTER', starts_at: new Date().toISOString(), months: 1, price: 1 }).error).toMatch(/^VALIDATION/);
    expect(env.call({ action: 'createTenant', token, business_name: 'A', owner_name: 'B', owner_phone: '1', plan_code: 'NOPE', starts_at: new Date().toISOString(), months: 1, price: 1 }).error).toBe('PLAN_NOT_FOUND');
    expect(env.call({ action: 'createTenant', token, business_name: 'A', owner_name: 'B', owner_phone: '1', plan_code: 'STARTER', starts_at: new Date().toISOString(), months: 99, price: 1 }).error).toBe('INVALID_MONTHS');
    env.properties.delete('SHEET_ID');
    expect(env.call({ action: 'overview', token }).error).toBe('SERVER_ERROR');
  });
});
