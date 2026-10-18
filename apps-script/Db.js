/**
 * Akses Google Sheet sebagai tabel. Baris 1 = header. Semua nilai dikembalikan sebagai objek.
 * Sheet hanya dibaca/ditulis oleh skrip ini; jangan bagikan Sheet ke orang lain.
 */

var TABLES = {
  admins: ['id', 'email', 'full_name', 'role', 'is_active', 'must_change_password', 'password_hash', 'password_salt', 'password_changed_at', 'created_at'],
  plans: ['id', 'code', 'name', 'max_outlets', 'max_pos_devices', 'max_users', 'price_monthly', 'price_yearly', 'is_active'],
  tenants: ['id', 'customer_code', 'business_name', 'owner_name', 'owner_phone', 'owner_email', 'address', 'status', 'note', 'created_by', 'created_at', 'updated_at'],
  subscriptions: ['id', 'tenant_id', 'plan_code', 'status', 'starts_at', 'ends_at', 'grace_days', 'max_pos_devices_override', 'billing_cycle', 'price', 'created_by', 'created_at'],
  license_keys: ['id', 'tenant_id', 'key_prefix', 'key_hash', 'issued_by', 'issued_at', 'revoked_at', 'revoked_by', 'revoke_reason'],
  devices: ['id', 'tenant_id', 'kind', 'device_fingerprint', 'device_name', 'app_version', 'activated_at', 'last_seen_at', 'deactivated_at', 'deactivated_by', 'deactivate_reason', 'token_hash', 'prev_token_hash'],
  usage: ['tenant_id', 'active_users', 'sales_30d', 'updated_at'],
  audit_log: ['occurred_at', 'admin_id', 'tenant_id', 'action', 'detail'],
};

function db_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('CONFIG: SHEET_ID belum diisi di Script Properties');
  return SpreadsheetApp.openById(id);
}

function sheet_(table) {
  var sh = db_().getSheetByName(table);
  if (!sh) throw new Error('CONFIG: sheet ' + table + ' tidak ada, jalankan setup()');
  return sh;
}

/**
 * Semua teks disimpan dengan awalan apostrof agar Sheets menyimpannya apa adanya:
 * mencegah formula injection (= + - @) dan konversi otomatis, mis. no HP "0812..." menjadi angka 812...
 * atau tanggal ISO menjadi Date. Apostrof tidak ikut terbaca oleh getValues().
 */
function cell_(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return "'" + value;
  return value;
}

function uncell_(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.charAt(0) === "'") return value.substring(1);
  return value;
}

function readAll_(table) {
  var cols = TABLES[table];
  var values = sheet_(table).getDataRange().getValues();
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var obj = { _row: r + 1 };
    var empty = true;
    for (var c = 0; c < cols.length; c++) {
      var v = uncell_(values[r][c]);
      if (v !== '' && v !== null && v !== undefined) empty = false;
      obj[cols[c]] = v === '' ? null : v;
    }
    if (!empty) rows.push(obj);
  }
  return rows;
}

function insert_(table, obj) {
  var cols = TABLES[table];
  sheet_(table).appendRow(cols.map(function (c) { return cell_(obj[c]); }));
  return obj;
}

function update_(table, row, changes) {
  var cols = TABLES[table];
  var sh = sheet_(table);
  Object.keys(changes).forEach(function (k) {
    var idx = cols.indexOf(k);
    if (idx < 0) throw new Error('Kolom tidak dikenal: ' + k);
    sh.getRange(row._row, idx + 1).setValue(cell_(changes[k]));
    row[k] = changes[k];
  });
  return row;
}

function public_(row, hidden) {
  var out = {};
  Object.keys(row).forEach(function (k) {
    if (k === '_row' || (hidden && hidden.indexOf(k) >= 0)) return;
    out[k] = row[k];
  });
  return out;
}

function nowIso_() {
  return new Date().toISOString();
}

function bool_(v) {
  return v === true || v === 'TRUE' || v === 'true';
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
