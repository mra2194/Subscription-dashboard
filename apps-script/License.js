/**
 * License API untuk aplikasi kasir (POS). Tidak memakai sesi admin.
 *
 * activateDevice: Customer ID + license key + sidik jari device -> device terdaftar + token lisensi.
 * refreshDevice : token lama -> token baru (dipanggil POS tiap jam saat online), sekalian lapor pemakaian.
 *
 * Token = base64url(payload JSON) + "." + base64url(tanda tangan RSA-SHA256).
 * POS memverifikasi tanda tangan dengan public key yang tertanam di aplikasi, sehingga bisa jalan offline
 * sampai `exp`. Server tidak perlu memverifikasi RSA: ia mencocokkan hash token dengan yang tersimpan.
 */

var TOKEN_TTL_HOURS = 72;
var MAX_FAILED_ACTIVATIONS = 10;
var ACTIVATION_LOCKOUT_SECONDS = 15 * 60;
var HOUR_MS = 60 * 60 * 1000;

function signingKey_() {
  var k = PropertiesService.getScriptProperties().getProperty('LICENSE_SIGNING_KEY');
  if (!k || k.indexOf('BEGIN PRIVATE KEY') < 0) throw new Error('CONFIG: LICENSE_SIGNING_KEY belum diisi (PKCS#8 PEM)');
  return k.replace(/\\n/g, '\n');
}

function b64url_(bytesOrText) {
  return Utilities.base64EncodeWebSafe(bytesOrText).replace(/=+$/, '');
}

function activeEntitlement_(tenant) {
  var plansByCode = {};
  readAll_('plans').forEach(function (p) { plansByCode[p.code] = p; });
  var e = entitlement_(tenant.id, readAll_('subscriptions'), plansByCode, Date.now());
  var usable = tenant.status === 'active' && e && ['trial', 'active', 'grace'].indexOf(e.effective_status) >= 0;
  if (!usable) throw new Error('LICENSE_INACTIVE: ' + (tenant.status !== 'active' ? tenant.status : (e ? e.effective_status : 'none')));
  return e;
}

/** Terbitkan token baru untuk device dan simpan hash-nya (token lama tetap diterima sekali untuk toleransi jaringan). */
function issueDeviceToken_(tenant, device, e) {
  var now = Date.now();
  var exp = Math.min(now + TOKEN_TTL_HOURS * HOUR_MS, new Date(e.grace_until).getTime());
  var payload = {
    v: 1,
    cc: tenant.customer_code,
    tid: tenant.id,
    did: device.id,
    plan: e.plan_code,
    max_pos: e.max_pos_devices,
    max_users: e.max_users,
    status: e.effective_status,
    paid_until: e.ends_at,
    iat: Math.floor(now / 1000),
    exp: Math.floor(exp / 1000),
    jti: randomHex_(1),
  };
  var body = b64url_(JSON.stringify(payload));
  var sig = b64url_(Utilities.computeRsaSha256Signature(body, signingKey_()));
  var token = body + '.' + sig;
  update_('devices', device, { token_hash: sha256Hex_(token), prev_token_hash: device.token_hash || null, last_seen_at: nowIso_() });
  return { device_token: token, expires_at: new Date(exp).toISOString(), status: e.effective_status, paid_until: e.ends_at };
}

function activateDevice_(b) {
  var code = String(b.customer_code || '').trim().toUpperCase();
  var cache = CacheService.getScriptCache();
  var failKey = 'actfail:' + code;
  var fails = Number(cache.get(failKey) || 0);
  if (fails >= MAX_FAILED_ACTIVATIONS) throw new Error('LOCKED_OUT');

  var tenant = readAll_('tenants').filter(function (t) { return t.customer_code === code; })[0];
  var keyHash = sha256Hex_(String(b.license_key || '').trim().toUpperCase());
  var key = tenant && readAll_('license_keys').filter(function (k) { return k.tenant_id === tenant.id && !k.revoked_at; })[0];
  if (!tenant || !key || !safeEqual_(keyHash, key.key_hash)) {
    cache.put(failKey, String(fails + 1), ACTIVATION_LOCKOUT_SECONDS);
    if (tenant) audit_(null, tenant.id, 'device.activate_failed', { reason: 'invalid_key' });
    throw new Error('INVALID_LICENSE');
  }
  cache.remove(failKey);

  var fingerprint = requireText_(b.device_fingerprint, 'Sidik jari device', 128);
  var name = requireText_(b.device_name, 'Nama device', 80);
  var kind = b.kind === 'backoffice_mobile' ? 'backoffice_mobile' : 'pos';

  return withLock_(function () {
    var e = activeEntitlement_(tenant);
    var existing = readAll_('devices').filter(function (d) {
      return d.tenant_id === tenant.id && d.device_fingerprint === fingerprint && !d.deactivated_at;
    })[0];
    var device = existing;
    if (!device) {
      if (kind === 'pos') assertDeviceQuota_(tenant.id);
      device = insert_('devices', {
        id: Utilities.getUuid(), tenant_id: tenant.id, kind: kind, device_fingerprint: fingerprint, device_name: name,
        app_version: optionalText_(b.app_version, 20), activated_at: nowIso_(), last_seen_at: nowIso_(),
        deactivated_at: null, deactivated_by: null, deactivate_reason: null, token_hash: null, prev_token_hash: null,
      });
      device = readAll_('devices').filter(function (d) { return d.id === device.id; })[0];
      audit_(null, tenant.id, 'device.activate', { device: name, kind: kind });
    }
    var out = issueDeviceToken_(tenant, device, e);
    out.device_id = device.id;
    return out;
  });
}

function refreshDevice_(b) {
  var token = String(b.device_token || '');
  var parts = token.split('.');
  if (parts.length !== 2) throw new Error('INVALID_TOKEN');
  var payload;
  try {
    payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0] + '==='.slice((parts[0].length + 3) % 4))).getDataAsString());
  } catch (err) {
    throw new Error('INVALID_TOKEN');
  }
  return withLock_(function () {
    var device = readAll_('devices').filter(function (d) { return d.id === payload.did; })[0];
    var h = sha256Hex_(token);
    if (!device || !(safeEqual_(h, String(device.token_hash || '')) || safeEqual_(h, String(device.prev_token_hash || '')))) {
      throw new Error('INVALID_TOKEN');
    }
    if (device.deactivated_at) throw new Error('DEVICE_REVOKED');
    var tenant = tenant_(device.tenant_id);
    var e = activeEntitlement_(tenant);

    if (b.app_version) update_('devices', device, { app_version: optionalText_(b.app_version, 20) });
    if (b.usage && typeof b.usage === 'object') recordUsage_(tenant.id, b.usage);
    return issueDeviceToken_(tenant, device, e);
  });
}

function recordUsage_(tenantId, usage) {
  var row = readAll_('usage').filter(function (u) { return u.tenant_id === tenantId; })[0];
  var values = {
    active_users: Math.max(0, Math.floor(Number(usage.active_users) || 0)),
    sales_30d: Math.max(0, Math.floor(Number(usage.sales_30d) || 0)),
    updated_at: nowIso_(),
  };
  if (row) update_('usage', row, values);
  else insert_('usage', { tenant_id: tenantId, active_users: values.active_users, sales_30d: values.sales_30d, updated_at: values.updated_at });
}
