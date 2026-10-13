-- =====================================================================
-- AAL Subscription Dashboard: control plane (Supabase / PostgreSQL 15+)
-- Diturunkan dari desain docs/04-lisensi-langganan.md, disesuaikan untuk Supabase:
--   * akun admin memakai Supabase Auth (auth.users), bukan password_hash sendiri
--   * semua tabel RLS aktif; klien hanya bisa SELECT
--   * semua perubahan lewat fungsi RPC SECURITY DEFINER yang mengecek role
--   * admin wajib ganti password sebelum boleh membaca data apa pun
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

create type public.admin_role          as enum ('superadmin', 'sales', 'support', 'viewer');
create type public.tenant_status       as enum ('onboarding', 'active', 'suspended', 'terminated');
create type public.subscription_status as enum ('trial', 'active', 'cancelled');
create type public.device_kind         as enum ('pos', 'backoffice_mobile');

-- ---------------------------------------------------------------------
-- Admin platform
-- ---------------------------------------------------------------------
create table public.platform_admins (
  id                    uuid primary key references auth.users(id) on delete cascade,
  email                 text not null,
  full_name             text not null default '',
  role                  public.admin_role not null default 'viewer',
  is_active             boolean not null default true,
  must_change_password  boolean not null default true,
  password_changed_at   timestamptz,
  created_at            timestamptz not null default now()
);
create unique index uq_platform_admins_email on public.platform_admins (lower(email));

-- Pemeriksa akses yang dipakai semua policy & RPC.
create function public.current_admin_role() returns public.admin_role
language sql stable security definer set search_path = '' as $$
  select a.role
  from public.platform_admins a
  where a.id = auth.uid() and a.is_active and not a.must_change_password
$$;

create function public.has_admin_role(allowed public.admin_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_admin_role() = any(allowed), false)
$$;

create function public.require_admin_role(allowed public.admin_role[]) returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_admin_role(allowed) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

-- ---------------------------------------------------------------------
-- Paket, customer, langganan
-- ---------------------------------------------------------------------
create table public.plans (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  name            text not null,
  max_outlets     smallint not null check (max_outlets > 0),
  max_pos_devices smallint not null check (max_pos_devices > 0),
  max_users       smallint not null check (max_users > 0),
  features        jsonb not null default '{}',
  price_monthly   numeric(18,2) not null check (price_monthly >= 0),
  price_yearly    numeric(18,2),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

create sequence public.tenant_code_seq start 1;

create table public.tenants (
  id              uuid primary key default gen_random_uuid(),
  customer_code   text not null unique
                  default ('CUST-' || lpad(nextval('public.tenant_code_seq')::text, 5, '0')),
  business_name   text not null check (length(trim(business_name)) > 0),
  owner_name      text not null check (length(trim(owner_name)) > 0),
  owner_phone     text not null,
  owner_email     text,
  address         text,
  db_schema       text unique check (db_schema ~ '^t_[a-z0-9_]{1,60}$'),
  status          public.tenant_status not null default 'active',
  note            text,
  created_by      uuid not null references public.platform_admins(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenants(id),
  plan_id                  uuid not null references public.plans(id),
  status                   public.subscription_status not null default 'active',
  starts_at                timestamptz not null,
  ends_at                  timestamptz not null,
  grace_days               smallint not null default 7 check (grace_days between 0 and 30),
  max_outlets_override     smallint check (max_outlets_override > 0),
  max_pos_devices_override smallint check (max_pos_devices_override > 0),
  max_users_override       smallint check (max_users_override > 0),
  billing_cycle            text not null check (billing_cycle in ('monthly', 'yearly', 'custom')),
  price                    numeric(18,2) not null check (price >= 0),
  created_by               uuid not null references public.platform_admins(id),
  created_at               timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index ix_subs_tenant on public.subscriptions (tenant_id, ends_at desc);

-- License key: hanya hash yang disimpan. Key 100 bit acak, tampil sekali.
create table public.license_keys (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id),
  key_prefix    text not null,
  key_hash      text not null unique,
  issued_by     uuid not null references public.platform_admins(id),
  issued_at     timestamptz not null default now(),
  revoked_at    timestamptz,
  revoked_by    uuid references public.platform_admins(id),
  revoke_reason text
);
create unique index uq_license_active on public.license_keys (tenant_id) where revoked_at is null;

create table public.device_activations (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id),
  kind               public.device_kind not null default 'pos',
  device_fingerprint text not null,
  device_name        text not null,
  register_id        uuid,
  app_version        text,
  activated_at       timestamptz not null default now(),
  last_seen_at       timestamptz,
  deactivated_at     timestamptz,
  deactivated_by     uuid references public.platform_admins(id),
  deactivate_reason  text
);
create unique index uq_device_active on public.device_activations (tenant_id, device_fingerprint) where deactivated_at is null;

create table public.tenant_usage (
  tenant_id       uuid primary key references public.tenants(id),
  active_users    integer not null default 0,
  active_outlets  integer not null default 0,
  sales_30d       integer not null default 0,
  updated_at      timestamptz not null default now()
);

create table public.platform_audit_logs (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  admin_id    uuid references public.platform_admins(id),
  tenant_id   uuid references public.tenants(id),
  action      text not null,
  before_data jsonb,
  after_data  jsonb
);
create index ix_audit_tenant on public.platform_audit_logs (tenant_id, occurred_at desc);

create function public.forbid_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name;
end $$;

create trigger trg_platform_audit_immutable
  before update or delete on public.platform_audit_logs
  for each row execute function public.forbid_mutation();

-- ---------------------------------------------------------------------
-- View (security_invoker: RLS tabel dasar tetap berlaku)
-- ---------------------------------------------------------------------
-- Langganan berjalan per tenant: paket & kuota dari baris yang sedang berlaku,
-- masa aktif (ends_at) = akhir dari seluruh langganan yang sudah dibayar (termasuk perpanjangan).
create view public.v_tenant_entitlements with (security_invoker = true) as
with ranked as (
  select s.*,
         max(s.ends_at) over (partition by s.tenant_id) as paid_until,
         row_number() over (partition by s.tenant_id
                            order by (s.starts_at <= now()) desc, s.ends_at desc) as rn
  from public.subscriptions s
  where s.status <> 'cancelled'
)
select r.tenant_id,
       r.id                                                as subscription_id,
       p.code                                              as plan_code,
       p.name                                              as plan_name,
       r.starts_at,
       r.paid_until                                        as ends_at,
       r.paid_until + make_interval(days => r.grace_days)  as grace_until,
       case
         when now() < r.starts_at                                         then 'scheduled'
         when now() <= r.paid_until                                       then r.status::text
         when now() <= r.paid_until + make_interval(days => r.grace_days) then 'grace'
         else 'expired'
       end                                                 as effective_status,
       coalesce(r.max_outlets_override,     p.max_outlets)     as max_outlets,
       coalesce(r.max_pos_devices_override, p.max_pos_devices) as max_pos_devices,
       coalesce(r.max_users_override,       p.max_users)       as max_users,
       r.price,
       r.billing_cycle,
       p.features
from ranked r
join public.plans p on p.id = r.plan_id
where r.rn = 1;

create view public.v_admin_tenant_overview with (security_invoker = true) as
select t.id,
       t.customer_code,
       t.business_name,
       t.owner_name,
       t.owner_phone,
       t.status                          as tenant_status,
       e.plan_code,
       e.plan_name,
       case when t.status in ('suspended', 'terminated') then t.status::text
            else coalesce(e.effective_status, 'none') end as access_status,
       e.starts_at,
       e.ends_at,
       e.grace_until,
       (e.ends_at::date - current_date)  as days_left,
       coalesce(d.pos_active, 0)         as pos_devices_used,
       e.max_pos_devices,
       coalesce(u.active_users, 0)       as users_used,
       e.max_users,
       d.last_seen_at,
       coalesce(u.sales_30d, 0)          as sales_30d,
       e.price,
       e.billing_cycle,
       (lk.key_prefix)                   as license_key_prefix
from public.tenants t
left join public.v_tenant_entitlements e on e.tenant_id = t.id
left join (select tenant_id,
                  count(*) filter (where kind = 'pos') as pos_active,
                  max(last_seen_at)                     as last_seen_at
           from public.device_activations
           where deactivated_at is null
           group by tenant_id) d on d.tenant_id = t.id
left join public.tenant_usage u on u.tenant_id = t.id
left join public.license_keys lk on lk.tenant_id = t.id and lk.revoked_at is null;

-- ---------------------------------------------------------------------
-- Kuota device (dipakai License Service saat aktivasi POS)
-- ---------------------------------------------------------------------
create function public.enforce_device_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_max   integer;
  v_used  integer;
begin
  if new.kind <> 'pos' or new.deactivated_at is not null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext(new.tenant_id::text));
  select e.max_pos_devices into v_max
  from public.v_tenant_entitlements e
  join public.tenants t on t.id = e.tenant_id
  where e.tenant_id = new.tenant_id
    and e.effective_status in ('trial', 'active')
    and t.status = 'active';
  if v_max is null then
    raise exception 'LICENSE_INACTIVE';
  end if;
  select count(*) into v_used
  from public.device_activations
  where tenant_id = new.tenant_id and kind = 'pos' and deactivated_at is null and id <> new.id;
  if v_used >= v_max then
    raise exception 'DEVICE_QUOTA_EXCEEDED: % of % POS devices in use', v_used, v_max;
  end if;
  return new;
end $$;

create trigger trg_device_quota
  before insert or update of deactivated_at, kind on public.device_activations
  for each row execute function public.enforce_device_quota();

-- ---------------------------------------------------------------------
-- Ganti password wajib: flag hanya turun bila password di auth.users benar-benar berubah.
-- Tidak ada RPC untuk menurunkan flag secara manual.
-- ---------------------------------------------------------------------
create function public.on_auth_password_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    update public.platform_admins
       set must_change_password = false,
           password_changed_at  = now()
     where id = new.id;
  end if;
  return new;
end $$;

create trigger trg_auth_password_changed
  after update of encrypted_password on auth.users
  for each row execute function public.on_auth_password_changed();

-- Status login sendiri; satu-satunya data yang boleh dibaca sebelum ganti password.
create function public.my_admin_profile()
returns table (id uuid, email text, full_name text, role public.admin_role,
               is_active boolean, must_change_password boolean)
language sql stable security definer set search_path = '' as $$
  select a.id, a.email, a.full_name, a.role, a.is_active, a.must_change_password
  from public.platform_admins a
  where a.id = auth.uid()
$$;

-- ---------------------------------------------------------------------
-- RLS: hanya SELECT untuk admin aktif yang sudah ganti password.
-- ---------------------------------------------------------------------
alter table public.platform_admins     enable row level security;
alter table public.plans               enable row level security;
alter table public.tenants             enable row level security;
alter table public.subscriptions       enable row level security;
alter table public.license_keys        enable row level security;
alter table public.device_activations  enable row level security;
alter table public.tenant_usage        enable row level security;
alter table public.platform_audit_logs enable row level security;

create policy admins_read on public.platform_admins for select to authenticated
  using (public.has_admin_role(array['superadmin']::public.admin_role[]) or id = auth.uid());

create policy plans_read on public.plans for select to authenticated
  using (public.has_admin_role(array['superadmin','sales','support','viewer']::public.admin_role[]));
create policy tenants_read on public.tenants for select to authenticated
  using (public.has_admin_role(array['superadmin','sales','support','viewer']::public.admin_role[]));
create policy subs_read on public.subscriptions for select to authenticated
  using (public.has_admin_role(array['superadmin','sales','support','viewer']::public.admin_role[]));
create policy keys_read on public.license_keys for select to authenticated
  using (public.has_admin_role(array['superadmin','sales','support','viewer']::public.admin_role[]));
create policy devices_read on public.device_activations for select to authenticated
  using (public.has_admin_role(array['superadmin','sales','support','viewer']::public.admin_role[]));
create policy usage_read on public.tenant_usage for select to authenticated
  using (public.has_admin_role(array['superadmin','sales','support','viewer']::public.admin_role[]));
create policy audit_read on public.platform_audit_logs for select to authenticated
  using (public.has_admin_role(array['superadmin']::public.admin_role[]));

grant select on all tables in schema public to authenticated;

-- key_hash tidak pernah perlu dibaca klien.
revoke select on public.license_keys from anon, authenticated;
grant select (id, tenant_id, key_prefix, issued_by, issued_at, revoked_at, revoked_by, revoke_reason)
  on public.license_keys to authenticated;

-- Klien tidak menulis tabel langsung.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------
-- RPC (satu-satunya jalur tulis)
-- ---------------------------------------------------------------------
create function public.audit(p_tenant uuid, p_action text, p_before jsonb, p_after jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.platform_audit_logs (admin_id, tenant_id, action, before_data, after_data)
  values (auth.uid(), p_tenant, p_action, p_before, p_after)
$$;

create function public.create_tenant(
  p_business_name text, p_owner_name text, p_owner_phone text, p_owner_email text,
  p_address text, p_plan_code text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_billing_cycle text, p_price numeric, p_max_pos_devices_override smallint default null
) returns public.tenants
language plpgsql security definer set search_path = '' as $$
declare
  v_admin  uuid := public.require_admin_role(array['superadmin','sales']::public.admin_role[]);
  v_plan   uuid;
  v_tenant public.tenants;
begin
  select id into v_plan from public.plans where code = p_plan_code and is_active;
  if v_plan is null then raise exception 'PLAN_NOT_FOUND'; end if;

  insert into public.tenants (business_name, owner_name, owner_phone, owner_email, address, created_by)
  values (trim(p_business_name), trim(p_owner_name), trim(p_owner_phone), nullif(trim(p_owner_email), ''),
          nullif(trim(p_address), ''), v_admin)
  returning * into v_tenant;

  update public.tenants
     set db_schema = 't_' || lower(replace(v_tenant.customer_code, '-', '_'))
   where id = v_tenant.id
  returning * into v_tenant;

  insert into public.subscriptions (tenant_id, plan_id, starts_at, ends_at, billing_cycle, price,
                                    max_pos_devices_override, created_by)
  values (v_tenant.id, v_plan, p_starts_at, p_ends_at, p_billing_cycle, p_price,
          p_max_pos_devices_override, v_admin);

  perform public.audit(v_tenant.id, 'tenant.create', null, to_jsonb(v_tenant));
  return v_tenant;
end $$;

-- Perpanjangan = baris langganan baru, mulai dari akhir langganan berjalan (atau sekarang bila sudah lewat).
create function public.extend_subscription(
  p_tenant_id uuid, p_plan_code text, p_months integer, p_billing_cycle text, p_price numeric
) returns public.subscriptions
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := public.require_admin_role(array['superadmin','sales']::public.admin_role[]);
  v_plan  uuid;
  v_start timestamptz;
  v_sub   public.subscriptions;
begin
  if p_months is null or p_months < 1 or p_months > 36 then raise exception 'INVALID_MONTHS'; end if;
  select id into v_plan from public.plans where code = p_plan_code and is_active;
  if v_plan is null then raise exception 'PLAN_NOT_FOUND'; end if;
  if not exists (select 1 from public.tenants where id = p_tenant_id) then raise exception 'TENANT_NOT_FOUND'; end if;

  select greatest(max(ends_at), now()) into v_start
  from public.subscriptions where tenant_id = p_tenant_id and status <> 'cancelled';
  v_start := coalesce(v_start, now());

  insert into public.subscriptions (tenant_id, plan_id, starts_at, ends_at, billing_cycle, price, created_by)
  values (p_tenant_id, v_plan, v_start, v_start + make_interval(months => p_months), p_billing_cycle, p_price, v_admin)
  returning * into v_sub;

  perform public.audit(p_tenant_id, 'subscription.extend', null, to_jsonb(v_sub));
  return v_sub;
end $$;

create function public.set_tenant_status(p_tenant_id uuid, p_status public.tenant_status, p_note text)
returns public.tenants
language plpgsql security definer set search_path = '' as $$
declare
  v_admin  uuid := public.require_admin_role(array['superadmin']::public.admin_role[]);
  v_before public.tenants;
  v_after  public.tenants;
begin
  select * into v_before from public.tenants where id = p_tenant_id for update;
  if v_before.id is null then raise exception 'TENANT_NOT_FOUND'; end if;
  update public.tenants set status = p_status, note = coalesce(nullif(trim(p_note), ''), note), updated_at = now()
   where id = p_tenant_id returning * into v_after;
  perform public.audit(p_tenant_id, 'tenant.status', to_jsonb(v_before), to_jsonb(v_after));
  return v_after;
end $$;

-- Format: AAL-XXXXX-XXXXX-XXXXX-XXXXX (Crockford base32, 100 bit). Mengembalikan key asli SEKALI.
create function public.issue_license_key(p_tenant_id uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_admin    uuid := public.require_admin_role(array['superadmin']::public.admin_role[]);
  c_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes    bytea := extensions.gen_random_bytes(20);
  v_raw      text := '';
  v_key      text;
  i          integer;
begin
  if not exists (select 1 from public.tenants where id = p_tenant_id) then raise exception 'TENANT_NOT_FOUND'; end if;
  for i in 0..19 loop
    v_raw := v_raw || substr(c_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  v_key := 'AAL-' || substr(v_raw, 1, 5) || '-' || substr(v_raw, 6, 5) || '-'
                  || substr(v_raw, 11, 5) || '-' || substr(v_raw, 16, 5);

  update public.license_keys
     set revoked_at = now(), revoked_by = v_admin, revoke_reason = 'replaced'
   where tenant_id = p_tenant_id and revoked_at is null;

  insert into public.license_keys (tenant_id, key_prefix, key_hash, issued_by)
  values (p_tenant_id, substr(v_key, 1, 9), encode(extensions.digest(v_key, 'sha256'), 'hex'), v_admin);

  perform public.audit(p_tenant_id, 'license.issue', null, jsonb_build_object('key_prefix', substr(v_key, 1, 9)));
  return v_key;
end $$;

create function public.deactivate_device(p_device_id uuid, p_reason text) returns public.device_activations
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := public.require_admin_role(array['superadmin','support']::public.admin_role[]);
  v_dev   public.device_activations;
begin
  update public.device_activations
     set deactivated_at = now(), deactivated_by = v_admin, deactivate_reason = nullif(trim(p_reason), '')
   where id = p_device_id and deactivated_at is null
  returning * into v_dev;
  if v_dev.id is null then raise exception 'DEVICE_NOT_FOUND'; end if;
  perform public.audit(v_dev.tenant_id, 'device.deactivate', null, to_jsonb(v_dev));
  return v_dev;
end $$;

-- Fungsi internal tidak boleh dipanggil langsung dari klien.
revoke execute on all functions in schema public from public, anon;
revoke execute on function public.audit(uuid, text, jsonb, jsonb)       from authenticated;
revoke execute on function public.forbid_mutation()                      from authenticated;
revoke execute on function public.enforce_device_quota()                 from authenticated;
revoke execute on function public.on_auth_password_changed()             from authenticated;
grant  execute on function public.my_admin_profile()                     to authenticated;
grant  execute on function public.current_admin_role()                   to authenticated;
grant  execute on function public.has_admin_role(public.admin_role[])    to authenticated;
grant  execute on function public.create_tenant(text, text, text, text, text, text, timestamptz, timestamptz, text, numeric, smallint) to authenticated;
grant  execute on function public.extend_subscription(uuid, text, integer, text, numeric) to authenticated;
grant  execute on function public.set_tenant_status(uuid, public.tenant_status, text)     to authenticated;
grant  execute on function public.issue_license_key(uuid)                                to authenticated;
grant  execute on function public.deactivate_device(uuid, text)                          to authenticated;

-- ---------------------------------------------------------------------
-- Data awal paket (harga contoh, ubah sesuai keputusan)
-- ---------------------------------------------------------------------
insert into public.plans (code, name, max_outlets, max_pos_devices, max_users, features, price_monthly, price_yearly) values
  ('STARTER', 'Starter', 1, 2,  5,  '{"promo":false,"multi_outlet":false}', 150000, 1500000),
  ('PRO',     'Pro',     1, 5,  15, '{"promo":true,"multi_outlet":false}',  300000, 3000000),
  ('MULTI',   'Multi',   5, 15, 50, '{"promo":true,"multi_outlet":true}',   750000, 7500000);
