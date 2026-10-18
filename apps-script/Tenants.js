/** Customer, langganan, license key, device. Semua tulis lewat withLock_ dan tercatat di audit_log. */

var ALL_ROLES = ['superadmin', 'sales', 'support', 'viewer'];
var KEY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
var DAY_MS = 24 * 60 * 60 * 1000;

function audit_(adminId, tenantId, action, detail) {
  insert_('audit_log', {
    occurred_at: nowIso_(),
    admin_id: adminId,
    tenant_id: tenantId,
    action: action,
    detail: detail ? JSON.stringify(detail) : '',
  });
}

function requireText_(value, label, maxLen) {
  var v = String(value === null || value === undefined ? '' : value).trim();
  if (!v) throw new Error('VALIDATION: ' + label + ' wajib diisi');
  if (v.length > (maxLen || 200)) throw new Error('VALIDATION: ' + label + ' terlalu panjang');
  return v;
}

function optionalText_(value, maxLen) {
  var v = String(value === null || value === undefined ? '' : value).trim();
  return v ? v.slice(0, maxLen || 200) : null;
}

function plan_(code) {
  var p = readAll_('plans').filter(function (x) { return x.code === code && bool_(x.is_active); })[0];
  if (!p) throw new Error('PLAN_NOT_FOUND');
  return p;
}

function tenant_(id) {
  var t = readAll_('tenants').filter(function (x) { return x.id === id; })[0];
  if (!t) throw new Error('TENANT_NOT_FOUND');
  return t;
}

function addMonths_(date, months) {
  var d = new Date(date.getTime());
  d.setMonth(d.getMonth() + months);
  return d;
}

/** Paket & kuota dari langganan yang sedang berlaku; masa aktif = akhir semua langganan berantai. */
function entitlement_(tenantId, subs, plansByCode, now) {
  var mine = subs.filter(function (s) { return s.tenant_id === tenantId && s.status !== 'cancelled'; });
  if (!mine.length) return null;
  var paidUntil = mine.reduce(function (m, s) { return Math.max(m, new Date(s.ends_at).getTime()); }, 0);
  var started = mine.filter(function (s) { return new Date(s.starts_at).getTime() <= now; });
  var pool = started.length ? started : mine;
  var current = pool.sort(function (a, b) { return new Date(b.ends_at) - new Date(a.ends_at); })[0];
  var plan = plansByCode[current.plan_code] || {};
  var grace = Number(current.grace_days || 7);
  var status;
  if (now < new Date(current.starts_at).getTime()) status = 'scheduled';
  else if (now <= paidUntil) status = current.status;
  else if (now <= paidUntil + grace * DAY_MS) status = 'grace';
  else status = 'expired';
  return {
    plan_code: current.plan_code,
    plan_name: plan.name || current.plan_code,
    starts_at: current.starts_at,
    ends_at: new Date(paidUntil).toISOString(),
    grace_until: new Date(paidUntil + grace * DAY_MS).toISOString(),
    effective_status: status,
    max_pos_devices: Number(current.max_pos_devices_override || plan.max_pos_devices || 0) || null,
    max_users: Number(plan.max_users || 0) || null,
    price: Number(current.price),
    billing_cycle: current.billing_cycle,
  };
}

function overviewRows_() {
  var now = Date.now();
  var plansByCode = {};
  readAll_('plans').forEach(function (p) { plansByCode[p.code] = p; });
  var subs = readAll_('subscriptions');
  var devices = readAll_('devices');
  var keys = readAll_('license_keys');
  var usage = {};
  readAll_('usage').forEach(function (u) { usage[u.tenant_id] = u; });
  var today = new Date(Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd') + 'T00:00:00+07:00').getTime();

  return readAll_('tenants').map(function (t) {
    var e = entitlement_(t.id, subs, plansByCode, now);
    var active = devices.filter(function (d) { return d.tenant_id === t.id && !d.deactivated_at; });
    var pos = active.filter(function (d) { return d.kind === 'pos'; });
    var lastSeen = active.reduce(function (m, d) { return d.last_seen_at && d.last_seen_at > m ? d.last_seen_at : m; }, '');
    var key = keys.filter(function (k) { return k.tenant_id === t.id && !k.revoked_at; })[0];
    var u = usage[t.id] || {};
    var access = (t.status === 'suspended' || t.status === 'terminated') ? t.status : (e ? e.effective_status : 'none');
    return {
      id: t.id,
      customer_code: t.customer_code,
      business_name: t.business_name,
      owner_name: t.owner_name,
      owner_phone: t.owner_phone,
      tenant_status: t.status,
      plan_code: e ? e.plan_code : null,
      plan_name: e ? e.plan_name : null,
      access_status: access,
      starts_at: e ? e.starts_at : null,
      ends_at: e ? e.ends_at : null,
      grace_until: e ? e.grace_until : null,
      days_left: e ? Math.floor((new Date(e.ends_at).getTime() - today) / DAY_MS) : null,
      pos_devices_used: pos.length,
      max_pos_devices: e ? e.max_pos_devices : null,
      users_used: Number(u.active_users || 0),
      max_users: e ? e.max_users : null,
      last_seen_at: lastSeen || null,
      sales_30d: Number(u.sales_30d || 0),
      price: e ? e.price : null,
      billing_cycle: e ? e.billing_cycle : null,
      license_key_prefix: key ? key.key_prefix : null,
    };
  });
}

function listOverview_(token) {
  requireRole_(token, ALL_ROLES);
  return overviewRows_().sort(function (a, b) { return String(a.ends_at || '').localeCompare(String(b.ends_at || '')); });
}

function listPlans_(token) {
  requireRole_(token, ALL_ROLES);
  return readAll_('plans').filter(function (p) { return bool_(p.is_active); }).map(function (p) {
    return {
      id: p.id, code: p.code, name: p.name,
      max_outlets: Number(p.max_outlets), max_pos_devices: Number(p.max_pos_devices), max_users: Number(p.max_users),
      price_monthly: Number(p.price_monthly), price_yearly: p.price_yearly === null ? null : Number(p.price_yearly),
    };
  }).sort(function (a, b) { return a.price_monthly - b.price_monthly; });
}

function tenantDetail_(token, tenantId) {
  var admin = requireRole_(token, ALL_ROLES);
  var row = overviewRows_().filter(function (r) { return r.id === tenantId; })[0];
  if (!row) throw new Error('TENANT_NOT_FOUND');
  var plansByCode = {};
  readAll_('plans').forEach(function (p) { plansByCode[p.code] = p; });
  var byNewest = function (field) { return function (a, b) { return String(b[field]).localeCompare(String(a[field])); }; };
  return {
    tenant: row,
    subscriptions: readAll_('subscriptions').filter(function (s) { return s.tenant_id === tenantId; }).sort(byNewest('starts_at'))
      .map(function (s) { var o = public_(s); o.plan_name = (plansByCode[s.plan_code] || {}).name || s.plan_code; o.price = Number(s.price); return o; }),
    devices: readAll_('devices').filter(function (d) { return d.tenant_id === tenantId; }).sort(byNewest('activated_at'))
      .map(function (d) { return public_(d, ['device_fingerprint', 'token_hash', 'prev_token_hash']); }),
    license_keys: readAll_('license_keys').filter(function (k) { return k.tenant_id === tenantId; }).sort(byNewest('issued_at'))
      .map(function (k) { return public_(k, ['key_hash']); }),
    audit: admin.role === 'superadmin'
      ? readAll_('audit_log').filter(function (a) { return a.tenant_id === tenantId; }).sort(byNewest('occurred_at')).slice(0, 50)
          .map(function (a) { return { occurred_at: a.occurred_at, action: a.action }; })
      : [],
  };
}

function nextCustomerCode_() {
  var max = readAll_('tenants').reduce(function (m, t) {
    var n = Number(String(t.customer_code || '').replace('CUST-', ''));
    return isNaN(n) ? m : Math.max(m, n);
  }, 0);
  return 'CUST-' + ('0000' + (max + 1)).slice(-5);
}

function createTenant_(token, p) {
  var admin = requireRole_(token, ['superadmin', 'sales']);
  var plan = plan_(p.plan_code);
  var months = Number(p.months);
  if (!(months >= 1 && months <= 36)) throw new Error('INVALID_MONTHS');
  var start = new Date(p.starts_at);
  if (isNaN(start.getTime())) throw new Error('VALIDATION: tanggal mulai tidak valid');
  var cycle = ['monthly', 'yearly', 'custom'].indexOf(p.billing_cycle) >= 0 ? p.billing_cycle : 'monthly';
  var price = Number(p.price);
  if (!(price >= 0)) throw new Error('VALIDATION: harga tidak valid');

  var tenant = {
    id: Utilities.getUuid(),
    business_name: requireText_(p.business_name, 'Nama toko'),
    owner_name: requireText_(p.owner_name, 'Nama owner'),
    owner_phone: requireText_(p.owner_phone, 'No HP owner', 30),
    owner_email: optionalText_(p.owner_email, 120),
    address: optionalText_(p.address, 300),
    status: 'active',
    note: null,
    created_by: admin.id,
    created_at: nowIso_(),
    updated_at: nowIso_(),
  };
  return withLock_(function () {
    tenant.customer_code = nextCustomerCode_();
    insert_('tenants', tenant);
    insert_('subscriptions', {
      id: Utilities.getUuid(), tenant_id: tenant.id, plan_code: plan.code, status: 'active',
      starts_at: start.toISOString(), ends_at: addMonths_(start, months).toISOString(), grace_days: 7,
      max_pos_devices_override: null, billing_cycle: cycle, price: price, created_by: admin.id, created_at: nowIso_(),
    });
    audit_(admin.id, tenant.id, 'tenant.create', { customer_code: tenant.customer_code, plan: plan.code, months: months });
    return { id: tenant.id, customer_code: tenant.customer_code };
  });
}

function extendSubscription_(token, p) {
  var admin = requireRole_(token, ['superadmin', 'sales']);
  var plan = plan_(p.plan_code);
  tenant_(p.tenant_id);
  var months = Number(p.months);
  if (!(months >= 1 && months <= 36)) throw new Error('INVALID_MONTHS');
  var price = Number(p.price);
  if (!(price >= 0)) throw new Error('VALIDATION: harga tidak valid');
  var cycle = ['monthly', 'yearly', 'custom'].indexOf(p.billing_cycle) >= 0 ? p.billing_cycle : 'monthly';
  return withLock_(function () {
    var latestEnd = readAll_('subscriptions')
      .filter(function (s) { return s.tenant_id === p.tenant_id && s.status !== 'cancelled'; })
      .reduce(function (m, s) { return Math.max(m, new Date(s.ends_at).getTime()); }, 0);
    var start = new Date(Math.max(latestEnd, Date.now()));
    var sub = {
      id: Utilities.getUuid(), tenant_id: p.tenant_id, plan_code: plan.code, status: 'active',
      starts_at: start.toISOString(), ends_at: addMonths_(start, months).toISOString(), grace_days: 7,
      max_pos_devices_override: null, billing_cycle: cycle, price: price, created_by: admin.id, created_at: nowIso_(),
    };
    insert_('subscriptions', sub);
    audit_(admin.id, p.tenant_id, 'subscription.extend', { plan: plan.code, months: months, ends_at: sub.ends_at });
    return { ok: true, ends_at: sub.ends_at };
  });
}

function setTenantStatus_(token, p) {
  var admin = requireRole_(token, ['superadmin']);
  if (['active', 'suspended', 'terminated'].indexOf(p.status) < 0) throw new Error('VALIDATION: status tidak valid');
  return withLock_(function () {
    var t = tenant_(p.tenant_id);
    var before = t.status;
    update_('tenants', t, { status: p.status, note: optionalText_(p.note, 300) || t.note, updated_at: nowIso_() });
    audit_(admin.id, t.id, 'tenant.status', { from: before, to: p.status, note: optionalText_(p.note, 300) });
    return { ok: true, status: p.status };
  });
}

function newLicenseKey_() {
  var hex = randomHex_(2); // 256 bit acak dari dua UUID v4 (122 bit acak masing-masing)
  var raw = '';
  for (var i = 0; i < 20; i++) raw += KEY_ALPHABET.charAt(parseInt(hex.substr(i * 2, 2), 16) % 32);
  return 'AAL-' + raw.substr(0, 5) + '-' + raw.substr(5, 5) + '-' + raw.substr(10, 5) + '-' + raw.substr(15, 5);
}

function issueLicenseKey_(token, p) {
  var admin = requireRole_(token, ['superadmin']);
  tenant_(p.tenant_id);
  return withLock_(function () {
    readAll_('license_keys')
      .filter(function (k) { return k.tenant_id === p.tenant_id && !k.revoked_at; })
      .forEach(function (k) { update_('license_keys', k, { revoked_at: nowIso_(), revoked_by: admin.id, revoke_reason: 'replaced' }); });
    var key = newLicenseKey_();
    insert_('license_keys', {
      id: Utilities.getUuid(), tenant_id: p.tenant_id, key_prefix: key.substr(0, 9), key_hash: sha256Hex_(key),
      issued_by: admin.id, issued_at: nowIso_(), revoked_at: null, revoked_by: null, revoke_reason: null,
    });
    audit_(admin.id, p.tenant_id, 'license.issue', { key_prefix: key.substr(0, 9) });
    return { license_key: key };
  });
}

function deactivateDevice_(token, p) {
  var admin = requireRole_(token, ['superadmin', 'support']);
  return withLock_(function () {
    var d = readAll_('devices').filter(function (x) { return x.id === p.device_id && !x.deactivated_at; })[0];
    if (!d) throw new Error('DEVICE_NOT_FOUND');
    update_('devices', d, { deactivated_at: nowIso_(), deactivated_by: admin.id, deactivate_reason: optionalText_(p.reason, 200) });
    audit_(admin.id, d.tenant_id, 'device.deactivate', { device: d.device_name, reason: optionalText_(p.reason, 200) });
    return { ok: true };
  });
}

/** Dipakai License Service POS nanti: tolak device baru bila kuota penuh atau langganan tidak aktif. */
function assertDeviceQuota_(tenantId) {
  var t = tenant_(tenantId);
  var plansByCode = {};
  readAll_('plans').forEach(function (p) { plansByCode[p.code] = p; });
  var e = entitlement_(tenantId, readAll_('subscriptions'), plansByCode, Date.now());
  if (t.status !== 'active' || !e || ['trial', 'active'].indexOf(e.effective_status) < 0) {
    throw new Error('LICENSE_INACTIVE: ' + (t.status !== 'active' ? t.status : (e ? e.effective_status : 'none')));
  }
  var used = readAll_('devices').filter(function (d) { return d.tenant_id === tenantId && d.kind === 'pos' && !d.deactivated_at; }).length;
  if (used >= e.max_pos_devices) throw new Error('DEVICE_QUOTA_EXCEEDED: ' + used + ' of ' + e.max_pos_devices);
}
