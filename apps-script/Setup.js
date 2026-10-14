/**
 * Jalankan sekali dari editor Apps Script (pilih fungsi setup, klik Run).
 * Sebelumnya isi Script Properties: SHEET_ID, ADMIN_EMAIL, ADMIN_TEMP_PASSWORD.
 * Membuat sheet + header, paket contoh, pepper password, dan akun superadmin pertama.
 * Aman dijalankan ulang: yang sudah ada tidak diubah.
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PASSWORD_PEPPER')) props.setProperty('PASSWORD_PEPPER', randomHex_(2));

  var ss = db_();
  Object.keys(TABLES).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(TABLES[name]);
      sh.setFrozenRows(1);
    }
  });

  if (readAll_('plans').length === 0) {
    [
      ['STARTER', 'Starter', 1, 2, 5, 150000, 1500000],
      ['PRO', 'Pro', 1, 5, 15, 300000, 3000000],
      ['MULTI', 'Multi', 5, 15, 50, 750000, 7500000],
    ].forEach(function (p) {
      insert_('plans', { id: Utilities.getUuid(), code: p[0], name: p[1], max_outlets: p[2], max_pos_devices: p[3], max_users: p[4], price_monthly: p[5], price_yearly: p[6], is_active: true });
    });
  }

  var email = props.getProperty('ADMIN_EMAIL');
  var temp = props.getProperty('ADMIN_TEMP_PASSWORD');
  if (email && temp && !findAdminByEmail_(email)) {
    createAdmin_(email, 'Superadmin', 'superadmin', temp);
    props.deleteProperty('ADMIN_TEMP_PASSWORD');
  }
  return 'Setup selesai';
}

/** Tambah admin lain dari editor: ubah argumen lalu Run. Admin baru wajib ganti password saat login pertama. */
function addAdmin(email, fullName, role, tempPassword) {
  createAdmin_(email, fullName, role, tempPassword);
  return 'Admin ' + email + ' dibuat';
}
