import { generateKeyPairSync, createVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadAppsScript } from './fakeAppsScript';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const ADMIN = 'ridho@example.com';
const STRONG = 'Kopi-Susu-Gula-2026';

function world(plan = 'STARTER') {
  const env = loadAppsScript({ ADMIN_EMAIL: ADMIN, ADMIN_TEMP_PASSWORD: 'Sementara-2026', LICENSE_SIGNING_KEY: privateKey });
  env.run('setup');
  const t0 = env.call({ action: 'login', email: ADMIN, password: 'Sementara-2026' }).data.token;
  env.call({ action: 'changePassword', token: t0, current_password: 'Sementara-2026', new_password: STRONG });
  const token = t0;
  const tenant = env.call({ action: 'createTenant', token, business_name: 'Toko', owner_name: 'Budi', owner_phone: '1', plan_code: plan,
    starts_at: new Date(Date.now() - 86400000).toISOString(), months: 1, billing_cycle: 'monthly', price: 1 }).data;
  const key = env.call({ action: 'issueLicenseKey', token, tenant_id: tenant.id }).data.license_key as string;
  const activate = (fp: string, extra: Record<string, unknown> = {}) =>
    env.call({ action: 'activateDevice', customer_code: tenant.customer_code, license_key: key, device_fingerprint: fp, device_name: `Kasir ${fp}`, app_version: '1.0.0', ...extra });
  return { env, token, tenant, key, activate };
}

function decode(deviceToken: string) {
  const [body, sig] = deviceToken.split('.');
  const ok = createVerify('RSA-SHA256').update(body).verify(publicKey, Buffer.from(sig, 'base64url'));
  return { ok, payload: JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) };
}

describe('POS license API', () => {
  it('activates a device and returns a token the POS can verify offline with the public key', () => {
    const { activate, tenant } = world();
    const res = activate('fp1');
    expect(res.ok).toBe(true);
    const { ok, payload } = decode(res.data.device_token);
    expect(ok).toBe(true);
    expect(payload).toMatchObject({ v: 1, cc: tenant.customer_code, plan: 'STARTER', max_pos: 2, status: 'active' });
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(72 * 3600);
  });

  it('rejects a tampered token signature', () => {
    const { activate } = world();
    const t = activate('fp1').data.device_token as string;
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ ...decode(t).payload, max_pos: 99 })).toString('base64url');
    expect(createVerify('RSA-SHA256').update(forged).verify(publicKey, Buffer.from(sig, 'base64url'))).toBe(false);
    expect(body).not.toBe(forged);
  });

  it('rejects wrong key and locks out after 10 failures', () => {
    const { env, tenant, activate } = world();
    for (let i = 0; i < 10; i++) {
      expect(env.call({ action: 'activateDevice', customer_code: tenant.customer_code, license_key: 'AAL-XXXXX-XXXXX-XXXXX-XXXXX', device_fingerprint: 'x', device_name: 'x' }).error).toBe('INVALID_LICENSE');
    }
    expect(activate('fp1').error).toBe('LOCKED_OUT');
    env.advance(16 * 60 * 1000);
    expect(activate('fp1').ok).toBe(true);
    expect(env.call({ action: 'activateDevice', customer_code: 'CUST-99999', license_key: 'x', device_fingerprint: 'x', device_name: 'x' }).error).toBe('INVALID_LICENSE');
  });

  it('enforces device quota, reuses the same device, and frees a slot on deactivation', () => {
    const { env, token, activate } = world();
    const first = activate('fp1');
    expect(activate('fp2').ok).toBe(true);
    expect(activate('fp3').error).toBe('DEVICE_QUOTA_EXCEEDED: 2 of 2');
    expect(activate('fp1').data.device_id).toBe(first.data.device_id); // install ulang di device yang sama tidak makan kuota
    expect(env.call({ action: 'overview', token }).data[0].pos_devices_used).toBe(2);
    env.call({ action: 'deactivateDevice', token, device_id: first.data.device_id, reason: 'rusak' });
    expect(activate('fp3').ok).toBe(true);
  });

  it('rotates tokens on refresh, tolerates one lost response, records usage', () => {
    const { env, token, activate } = world();
    const t1 = activate('fp1').data.device_token;
    const r2 = env.call({ action: 'refreshDevice', device_token: t1, usage: { active_users: 3, sales_30d: 420 } });
    expect(r2.ok).toBe(true);
    const t2 = r2.data.device_token;
    expect(t2).not.toBe(t1);
    // Respon refresh hilang di jaringan: POS mencoba lagi dengan token lama, masih diterima sekali
    const r3 = env.call({ action: 'refreshDevice', device_token: t1 });
    expect(r3.ok).toBe(true);
    // Setelah dua rotasi, token pertama tidak berlaku
    env.call({ action: 'refreshDevice', device_token: r3.data.device_token });
    expect(env.call({ action: 'refreshDevice', device_token: t1 }).error).toBe('INVALID_TOKEN');
    const row = env.call({ action: 'overview', token }).data[0];
    expect(row.users_used).toBe(3);
    expect(row.sales_30d).toBe(420);
    expect(env.call({ action: 'refreshDevice', device_token: 'abc.def' }).error).toBe('INVALID_TOKEN');
    expect(env.call({ action: 'refreshDevice', device_token: '' }).error).toBe('INVALID_TOKEN');
  });

  it('blocks refresh for revoked devices and suspended customers, and caps token expiry at the grace period', () => {
    const { env, token, tenant, activate } = world();
    const a = activate('fp1').data;
    const b = activate('fp2').data;
    env.call({ action: 'deactivateDevice', token, device_id: a.device_id, reason: 'hilang' });
    expect(env.call({ action: 'refreshDevice', device_token: a.device_token }).error).toBe('DEVICE_REVOKED');

    env.call({ action: 'setTenantStatus', token, tenant_id: tenant.id, status: 'suspended', note: 'telat bayar' });
    expect(env.call({ action: 'refreshDevice', device_token: b.device_token }).error).toBe('LICENSE_INACTIVE: suspended');
    expect(activate('fp9').error).toBe('LICENSE_INACTIVE: suspended');

    env.call({ action: 'setTenantStatus', token, tenant_id: tenant.id, status: 'active' });
    const r = env.call({ action: 'refreshDevice', device_token: b.device_token });
    expect(r.ok).toBe(true);
    // Langganan 1 bulan: token tidak pernah melewati akhir masa tenggang
    expect(new Date(r.data.expires_at).getTime()).toBeLessThanOrEqual(new Date(env.call({ action: 'overview', token }).data[0].grace_until).getTime());
  });

  it('never exposes token hashes or fingerprints to the dashboard', () => {
    const { env, token, tenant, activate } = world();
    activate('fp-secret', { device_name: 'Kasir Depan' });
    const detail = JSON.stringify(env.call({ action: 'tenantDetail', token, tenant_id: tenant.id }).data);
    expect(detail).not.toContain('token_hash');
    expect(detail).not.toContain('fp-secret');
  });

  it('reports a config error (masked) when the signing key is missing', () => {
    const { env, activate } = world();
    env.properties.delete('LICENSE_SIGNING_KEY');
    expect(activate('fp1').error).toBe('SERVER_ERROR');
  });
});
