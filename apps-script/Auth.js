/**
 * Akun admin, password, dan sesi.
 * Password: HMAC-SHA256 berulang dengan salt per user + pepper di Script Properties (bukan di Sheet).
 */

var HASH_ITERATIONS = 2000;
var SESSION_TTL_SECONDS = 30 * 60;
var MAX_FAILED_LOGINS = 5;
var LOCKOUT_SECONDS = 15 * 60;
var MIN_PASSWORD_LENGTH = 12;
var ROLES = ['superadmin', 'sales', 'support', 'viewer'];

function pepper_() {
  var p = PropertiesService.getScriptProperties().getProperty('PASSWORD_PEPPER');
  if (!p || p.length < 32) throw new Error('CONFIG: PASSWORD_PEPPER belum diisi, jalankan setup()');
  return p;
}

function hex_(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function sha256Hex_(text) {
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));
}

function randomHex_(uuidCount) {
  var out = '';
  for (var i = 0; i < uuidCount; i++) out += Utilities.getUuid().replace(/-/g, '');
  return out;
}

function hashPassword_(password, salt) {
  var key = pepper_() + salt;
  var h = password;
  for (var i = 0; i < HASH_ITERATIONS; i++) {
    h = hex_(Utilities.computeHmacSha256Signature(h, key));
  }
  return h;
}

function safeEqual_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function passwordProblems_(next, current, email) {
  var problems = [];
  if (typeof next !== 'string' || next.length < MIN_PASSWORD_LENGTH) problems.push('Minimal ' + MIN_PASSWORD_LENGTH + ' karakter.');
  if (!/[a-z]/.test(next)) problems.push('Harus ada huruf kecil.');
  if (!/[A-Z]/.test(next)) problems.push('Harus ada huruf besar.');
  if (!/[0-9]/.test(next)) problems.push('Harus ada angka.');
  if (next === current) problems.push('Tidak boleh sama dengan password lama.');
  var local = String(email || '').split('@')[0].toLowerCase();
  if (local.length >= 3 && String(next).toLowerCase().indexOf(local) >= 0) problems.push('Tidak boleh memuat nama email.');
  return problems;
}

function findAdminByEmail_(email) {
  var e = String(email || '').trim().toLowerCase();
  return readAll_('admins').filter(function (a) { return String(a.email).toLowerCase() === e; })[0] || null;
}

function profile_(admin) {
  return {
    id: admin.id,
    email: admin.email,
    full_name: admin.full_name || '',
    role: admin.role,
    is_active: bool_(admin.is_active),
    must_change_password: bool_(admin.must_change_password),
  };
}

function createAdmin_(email, fullName, role, tempPassword) {
  if (ROLES.indexOf(role) < 0) throw new Error('Role tidak valid');
  if (findAdminByEmail_(email)) throw new Error('Email admin sudah terdaftar');
  var salt = randomHex_(2);
  return insert_('admins', {
    id: Utilities.getUuid(),
    email: String(email).trim().toLowerCase(),
    full_name: fullName || '',
    role: role,
    is_active: true,
    must_change_password: true,
    password_hash: hashPassword_(tempPassword, salt),
    password_salt: salt,
    password_changed_at: null,
    created_at: nowIso_(),
  });
}

function startSession_(admin) {
  var token = randomHex_(2);
  CacheService.getScriptCache().put('sess:' + sha256Hex_(token), admin.id, SESSION_TTL_SECONDS);
  return token;
}

/** Mengembalikan admin aktif dari token, memperpanjang sesi (sliding expiry). */
function requireSession_(token) {
  if (!token || typeof token !== 'string') throw new Error('UNAUTHENTICATED');
  var cache = CacheService.getScriptCache();
  var key = 'sess:' + sha256Hex_(token);
  var adminId = cache.get(key);
  if (!adminId) throw new Error('UNAUTHENTICATED');
  var admin = readAll_('admins').filter(function (a) { return a.id === adminId; })[0];
  if (!admin || !bool_(admin.is_active)) {
    cache.remove(key);
    throw new Error('UNAUTHENTICATED');
  }
  cache.put(key, adminId, SESSION_TTL_SECONDS);
  return admin;
}

/** Sesi + sudah ganti password + role diizinkan. Dipakai semua aksi data. */
function requireRole_(token, allowed) {
  var admin = requireSession_(token);
  if (bool_(admin.must_change_password)) throw new Error('PASSWORD_CHANGE_REQUIRED');
  if (allowed.indexOf(admin.role) < 0) throw new Error('FORBIDDEN');
  return admin;
}

function login_(email, password) {
  var cache = CacheService.getScriptCache();
  var failKey = 'fail:' + sha256Hex_(String(email || '').trim().toLowerCase());
  var fails = Number(cache.get(failKey) || 0);
  if (fails >= MAX_FAILED_LOGINS) throw new Error('LOCKED_OUT');
  var admin = findAdminByEmail_(email);
  // Hash tetap dihitung walau email tidak ada, supaya waktu respon tidak membocorkan email terdaftar.
  var computed = hashPassword_(String(password || ''), admin ? admin.password_salt : 'no-such-user');
  var ok = !!admin && bool_(admin.is_active) && safeEqual_(computed, admin.password_hash);
  if (!ok) {
    cache.put(failKey, String(fails + 1), LOCKOUT_SECONDS);
    audit_(admin ? admin.id : null, null, 'auth.login_failed', { email: String(email || '').slice(0, 120) });
    throw new Error('INVALID_LOGIN');
  }
  cache.remove(failKey);
  audit_(admin.id, null, 'auth.login', null);
  return { token: startSession_(admin), profile: profile_(admin) };
}

function logout_(token) {
  if (token) CacheService.getScriptCache().remove('sess:' + sha256Hex_(token));
  return { ok: true };
}

function changePassword_(token, currentPassword, newPassword) {
  var admin = requireSession_(token);
  if (!safeEqual_(hashPassword_(String(currentPassword || ''), admin.password_salt), admin.password_hash)) {
    throw new Error('WRONG_CURRENT_PASSWORD');
  }
  var problems = passwordProblems_(newPassword, currentPassword, admin.email);
  if (problems.length) throw new Error('WEAK_PASSWORD: ' + problems.join(' '));
  return withLock_(function () {
    var salt = randomHex_(2);
    update_('admins', admin, {
      password_hash: hashPassword_(newPassword, salt),
      password_salt: salt,
      must_change_password: false,
      password_changed_at: nowIso_(),
    });
    audit_(admin.id, null, 'auth.password_changed', null);
    return { profile: profile_(admin) };
  });
}
