/**
 * Pintu tunggal ke data. Web App menerima POST JSON { action, token, ...params }.
 * Dikirim dengan Content-Type text/plain agar browser tidak mengirim preflight CORS.
 */

var ACTIONS = {
  login: function (b) { return login_(b.email, b.password); },
  logout: function (b) { return logout_(b.token); },
  me: function (b) { return { profile: profile_(requireSession_(b.token)) }; },
  changePassword: function (b) { return changePassword_(b.token, b.current_password, b.new_password); },
  overview: function (b) { return listOverview_(b.token); },
  plans: function (b) { return listPlans_(b.token); },
  tenantDetail: function (b) { return tenantDetail_(b.token, b.tenant_id); },
  createTenant: function (b) { return createTenant_(b.token, b); },
  extendSubscription: function (b) { return extendSubscription_(b.token, b); },
  setTenantStatus: function (b) { return setTenantStatus_(b.token, b); },
  issueLicenseKey: function (b) { return issueLicenseKey_(b.token, b); },
  deactivateDevice: function (b) { return deactivateDevice_(b.token, b); },
};

// Error yang aman ditampilkan ke klien; selain ini disamarkan.
var PUBLIC_ERRORS = /^(UNAUTHENTICATED|PASSWORD_CHANGE_REQUIRED|FORBIDDEN|INVALID_LOGIN|LOCKED_OUT|WRONG_CURRENT_PASSWORD|WEAK_PASSWORD|VALIDATION|PLAN_NOT_FOUND|TENANT_NOT_FOUND|DEVICE_NOT_FOUND|INVALID_MONTHS|LICENSE_INACTIVE|DEVICE_QUOTA_EXCEEDED|UNKNOWN_ACTION|BAD_REQUEST)/;

function handle_(raw) {
  var body;
  try {
    body = JSON.parse(raw || '{}');
  } catch (e) {
    return { ok: false, error: 'BAD_REQUEST' };
  }
  var fn = ACTIONS[body && body.action];
  if (!fn) return { ok: false, error: 'UNKNOWN_ACTION' };
  try {
    return { ok: true, data: fn(body) };
  } catch (e) {
    var msg = String((e && e.message) || e);
    if (PUBLIC_ERRORS.test(msg)) return { ok: false, error: msg };
    console.error(msg);
    return { ok: false, error: 'SERVER_ERROR' };
  }
}

function doPost(e) {
  var out = handle_(e && e.postData ? e.postData.contents : '');
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'aal-subscription' }))
    .setMimeType(ContentService.MimeType.JSON);
}
