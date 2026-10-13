-- =====================================================================
-- POS Toko Sembako: Skema Control Plane (Lisensi & Langganan)
-- Target  : PostgreSQL 16, database terpisah: `platform`
-- Status  : draf Fase 2, 13/10/2026. Lihat 04-lisensi-langganan.md
-- Isi     : data milik AAL (Pak Ridho): customer/tenant, paket,
--           langganan, license key, aktivasi device, invoice, audit.
--           Data operasional toko TIDAK ada di sini (lihat 02-oracle-schema.sql,
--           satu schema PostgreSQL per tenant).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE tenant_status       AS ENUM ('onboarding', 'active', 'suspended', 'terminated');
CREATE TYPE subscription_status AS ENUM ('trial', 'active', 'grace', 'suspended', 'cancelled', 'expired');
CREATE TYPE device_kind         AS ENUM ('pos', 'backoffice_mobile');
CREATE TYPE invoice_status      AS ENUM ('draft', 'issued', 'paid', 'void', 'overdue');

-- ---------------------------------------------------------------------
-- Admin platform (Pak Ridho & tim AAL)
-- ---------------------------------------------------------------------
CREATE TABLE platform_admins (
  id             uuid PRIMARY KEY,
  email          citext NOT NULL UNIQUE,
  full_name      varchar(120) NOT NULL,
  password_hash  text NOT NULL,          -- Argon2id
  totp_secret_enc text,                  -- 2FA wajib untuk admin platform
  role           varchar(20) NOT NULL CHECK (role IN ('superadmin','sales','support','viewer')),
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Paket langganan
-- ---------------------------------------------------------------------
CREATE TABLE plans (
  id              uuid PRIMARY KEY,
  code            varchar(30) NOT NULL UNIQUE,     -- STARTER, PRO, MULTI
  name            varchar(80) NOT NULL,
  max_outlets     smallint NOT NULL CHECK (max_outlets > 0),
  max_pos_devices smallint NOT NULL CHECK (max_pos_devices > 0),  -- kuota kasir (device)
  max_users       smallint NOT NULL CHECK (max_users > 0),        -- akun aktif (semua role)
  features        jsonb NOT NULL DEFAULT '{}',     -- {"promo":false,"multi_outlet":false,"qris_dynamic":false}
  price_monthly   numeric(18,2) NOT NULL CHECK (price_monthly >= 0),
  price_yearly    numeric(18,2),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Customer (tenant)
-- ---------------------------------------------------------------------
CREATE SEQUENCE tenant_code_seq START 1;

CREATE TABLE tenants (
  id              uuid PRIMARY KEY,
  customer_code   varchar(20) NOT NULL UNIQUE
                  DEFAULT ('CUST-' || lpad(nextval('tenant_code_seq')::text, 5, '0')),  -- Customer ID
  business_name   varchar(160) NOT NULL,
  owner_name      varchar(120) NOT NULL,
  owner_phone     varchar(30) NOT NULL,
  owner_email     citext,
  address         text,
  npwp            varchar(30),
  db_schema       varchar(63) NOT NULL UNIQUE CHECK (db_schema ~ '^t_[a-z0-9_]{1,60}$'),
  status          tenant_status NOT NULL DEFAULT 'onboarding',
  note            text,
  created_by      uuid NOT NULL REFERENCES platform_admins(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Langganan. Riwayat disimpan: perpanjangan = baris baru, bukan edit tanggal.
-- Override kuota per customer (mis. bonus 1 kasir) tanpa membuat paket baru.
-- ---------------------------------------------------------------------
CREATE TABLE subscriptions (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  plan_id              uuid NOT NULL REFERENCES plans(id),
  status               subscription_status NOT NULL,
  starts_at            timestamptz NOT NULL,
  ends_at              timestamptz NOT NULL,
  grace_days           smallint NOT NULL DEFAULT 7 CHECK (grace_days BETWEEN 0 AND 30),
  max_outlets_override     smallint CHECK (max_outlets_override > 0),
  max_pos_devices_override smallint CHECK (max_pos_devices_override > 0),
  max_users_override       smallint CHECK (max_users_override > 0),
  billing_cycle        varchar(10) NOT NULL CHECK (billing_cycle IN ('monthly','yearly','custom')),
  price                numeric(18,2) NOT NULL CHECK (price >= 0),  -- harga yang disepakati
  created_by           uuid NOT NULL REFERENCES platform_admins(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX ix_subs_tenant ON subscriptions(tenant_id, ends_at DESC);
CREATE INDEX ix_subs_expiring ON subscriptions(ends_at) WHERE status IN ('trial','active','grace');

-- Kuota efektif & status langganan berjalan per tenant
CREATE VIEW v_tenant_entitlements AS
SELECT DISTINCT ON (s.tenant_id)
       s.tenant_id,
       s.id AS subscription_id,
       p.code AS plan_code,
       s.status,
       s.starts_at,
       s.ends_at,
       s.ends_at + make_interval(days => s.grace_days) AS grace_until,
       COALESCE(s.max_outlets_override,     p.max_outlets)     AS max_outlets,
       COALESCE(s.max_pos_devices_override, p.max_pos_devices) AS max_pos_devices,
       COALESCE(s.max_users_override,       p.max_users)       AS max_users,
       p.features
FROM subscriptions s
JOIN plans p ON p.id = s.plan_id
WHERE s.status <> 'cancelled' AND s.starts_at <= now()
ORDER BY s.tenant_id, s.ends_at DESC;

-- ---------------------------------------------------------------------
-- License key. Disimpan hanya hash-nya; key asli ditampilkan sekali saat dibuat.
-- Format tampil: AAL-XXXXX-XXXXX-XXXXX-XXXXX (Crockford base32, 100 bit acak)
-- ---------------------------------------------------------------------
CREATE TABLE license_keys (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  key_prefix    varchar(12) NOT NULL,           -- "AAL-7KQ2M" untuk identifikasi di dashboard
  key_hash      text NOT NULL UNIQUE,           -- SHA-256 + pepper server
  issued_by     uuid NOT NULL REFERENCES platform_admins(id),
  issued_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  revoked_by    uuid REFERENCES platform_admins(id),
  revoke_reason text
);
-- Satu key aktif per tenant
CREATE UNIQUE INDEX uq_license_active ON license_keys(tenant_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------
-- Aktivasi device. Jumlah baris aktif kind='pos' <= max_pos_devices.
-- ---------------------------------------------------------------------
CREATE TABLE device_activations (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  kind               device_kind NOT NULL DEFAULT 'pos',
  device_fingerprint varchar(128) NOT NULL,     -- hash ID hardware + install ID
  device_name        varchar(80) NOT NULL,      -- "Kasir 1 - Sunmi V2"
  register_id        uuid,                      -- registers.id di schema tenant
  app_version        varchar(20),
  activated_at       timestamptz NOT NULL DEFAULT now(),
  activated_by_user  varchar(120),              -- username owner/manager di tenant
  last_seen_at       timestamptz,
  last_ip            inet,
  token_expires_at   timestamptz,               -- masa berlaku token offline terakhir
  deactivated_at     timestamptz,
  deactivated_by     varchar(120),
  deactivate_reason  text
);
CREATE UNIQUE INDEX uq_device_active ON device_activations(tenant_id, device_fingerprint) WHERE deactivated_at IS NULL;
CREATE INDEX ix_device_tenant_active ON device_activations(tenant_id, kind) WHERE deactivated_at IS NULL;

-- Penegakan kuota di level DB (lapis kedua setelah API), aman dari race condition.
CREATE FUNCTION enforce_device_quota() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_max   integer;
  v_used  integer;
BEGIN
  IF NEW.kind <> 'pos' OR NEW.deactivated_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.tenant_id::text));
  SELECT max_pos_devices INTO v_max
  FROM v_tenant_entitlements
  WHERE tenant_id = NEW.tenant_id AND status IN ('trial','active') AND now() < ends_at;
  IF v_max IS NULL THEN
    RAISE EXCEPTION 'LICENSE_INACTIVE: tenant % has no active subscription', NEW.tenant_id;
  END IF;
  SELECT count(*) INTO v_used
  FROM device_activations
  WHERE tenant_id = NEW.tenant_id AND kind = 'pos' AND deactivated_at IS NULL
    AND id <> NEW.id;
  IF v_used >= v_max THEN
    RAISE EXCEPTION 'DEVICE_QUOTA_EXCEEDED: % of % POS devices in use', v_used, v_max;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_device_quota
  BEFORE INSERT OR UPDATE OF deactivated_at, kind ON device_activations
  FOR EACH ROW EXECUTE FUNCTION enforce_device_quota();

-- ---------------------------------------------------------------------
-- Pemakaian akun (sinkron dari tenant tiap ada perubahan user)
-- ---------------------------------------------------------------------
CREATE TABLE tenant_usage (
  tenant_id       uuid PRIMARY KEY REFERENCES tenants(id),
  active_users    integer NOT NULL DEFAULT 0,
  active_outlets  integer NOT NULL DEFAULT 0,
  sales_30d       integer NOT NULL DEFAULT 0,   -- jumlah transaksi, untuk melihat customer aktif/tidak
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Tagihan langganan (pembayaran manual/transfer di MVP)
-- ---------------------------------------------------------------------
CREATE TABLE invoices (
  id              uuid PRIMARY KEY,
  number          varchar(30) NOT NULL UNIQUE,
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id),
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  amount          numeric(18,2) NOT NULL CHECK (amount >= 0),
  status          invoice_status NOT NULL DEFAULT 'draft',
  due_date        date NOT NULL,
  paid_at         timestamptz,
  payment_ref     varchar(80),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  CHECK (status <> 'paid' OR paid_at IS NOT NULL)
);

-- ---------------------------------------------------------------------
-- Log validasi lisensi (untuk deteksi penyalahgunaan) & audit admin
-- ---------------------------------------------------------------------
CREATE TABLE license_checks (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     uuid REFERENCES tenants(id),
  device_id     uuid REFERENCES device_activations(id),
  checked_at    timestamptz NOT NULL DEFAULT now(),
  result        varchar(30) NOT NULL,   -- ok, expired, grace, suspended, quota_exceeded, invalid_key, revoked
  ip            inet,
  app_version   varchar(20)
);
CREATE INDEX ix_license_checks_tenant ON license_checks(tenant_id, checked_at DESC);

CREATE TABLE platform_audit_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  admin_id    uuid REFERENCES platform_admins(id),
  tenant_id   uuid REFERENCES tenants(id),
  action      varchar(60) NOT NULL,   -- tenant.create, subscription.extend, license.revoke, device.deactivate, ...
  before_data jsonb,
  after_data  jsonb,
  ip          inet
);

CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;

CREATE TRIGGER trg_platform_audit_immutable
  BEFORE UPDATE OR DELETE ON platform_audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------------
-- View untuk dashboard Pak Ridho
-- ---------------------------------------------------------------------
CREATE VIEW v_admin_tenant_overview AS
SELECT t.customer_code,
       t.business_name,
       t.owner_name,
       t.owner_phone,
       t.status                       AS tenant_status,
       e.plan_code,
       e.status                       AS subscription_status,
       e.starts_at,
       e.ends_at,
       e.grace_until,
       (e.ends_at::date - current_date) AS days_left,
       COALESCE(d.pos_active, 0)      AS pos_devices_used,
       e.max_pos_devices,
       COALESCE(u.active_users, 0)    AS users_used,
       e.max_users,
       d.last_seen_at,
       u.sales_30d
FROM tenants t
LEFT JOIN v_tenant_entitlements e ON e.tenant_id = t.id
LEFT JOIN (SELECT tenant_id,
                  count(*) FILTER (WHERE kind = 'pos') AS pos_active,
                  max(last_seen_at)                     AS last_seen_at
           FROM device_activations
           WHERE deactivated_at IS NULL
           GROUP BY tenant_id) d ON d.tenant_id = t.id
LEFT JOIN tenant_usage u ON u.tenant_id = t.id;
