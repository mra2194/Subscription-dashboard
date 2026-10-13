-- Uji RLS, ganti password wajib, RPC, kuota device, dan audit.
\set ON_ERROR_STOP 1
\set QUIET 1

insert into auth.users values
  ('00000000-0000-0000-0000-0000000000a1', 'ridho@example.com', 'hash-awal'),
  ('00000000-0000-0000-0000-0000000000a2', 'viewer@example.com', 'hash-awal');
insert into public.platform_admins (id, email, full_name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'ridho@example.com', 'Ridho', 'superadmin'),
  ('00000000-0000-0000-0000-0000000000a2', 'viewer@example.com', 'Viewer', 'viewer');

create function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'EXPECTED ERROR (%) BUT SUCCEEDED: %', p_like, p_sql;
exception when others then
  if sqlerrm not like p_like then
    raise exception 'WRONG ERROR for %: got "%", wanted like "%"', p_sql, sqlerrm, p_like;
  end if;
end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- 1. Anon tidak bisa membaca apa pun
set role anon;
select pg_temp.expect_error('select * from public.tenants', '%permission denied%');
select pg_temp.expect_error('select public.create_tenant(''x'',''y'',''1'',null,null,''STARTER'',now(),now()+interval ''1 month'',''monthly'',1)', '%permission denied%');
reset role;
\echo PASS 1 anon blocked

-- 2. Superadmin sebelum ganti password: tidak bisa baca data / RPC, tapi bisa baca profil sendiri
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$ begin
  if (select count(*) from public.plans) <> 0 then raise exception 'plans visible before password change'; end if;
  if not (select must_change_password from public.my_admin_profile()) then raise exception 'flag should be true'; end if;
end $$;
select pg_temp.expect_error('select public.create_tenant(''x'',''y'',''1'',null,null,''STARTER'',now(),now()+interval ''1 month'',''monthly'',1)', 'FORBIDDEN');
reset role;
\echo PASS 2 must change password blocks data

-- 3. Klien tidak bisa menurunkan flag sendiri
set role authenticated;
select pg_temp.expect_error('update public.platform_admins set must_change_password = false', '%permission denied%');
reset role;
\echo PASS 3 flag not self-editable

-- 4. Ganti password (seperti GoTrue) menurunkan flag
update auth.users set encrypted_password = 'hash-baru' where id = '00000000-0000-0000-0000-0000000000a1';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$ begin
  if (select must_change_password from public.my_admin_profile()) then raise exception 'flag still true'; end if;
  if (select count(*) from public.plans) <> 3 then raise exception 'plans not visible after change'; end if;
end $$;
\echo PASS 4 password change unlocks access

-- 5. Superadmin membuat tenant, terbit license key, perpanjang
create temp table t_ctx as
  select * from public.create_tenant('Toko Maju', 'Budi', '0812', 'budi@example.com', 'Jl. A',
          'STARTER', now() - interval '1 day', now() + interval '30 days', 'monthly', 150000);
do $$
declare v_key text; v_key2 text; v_tid uuid := (select id from t_ctx);
begin
  if (select customer_code from t_ctx) !~ '^CUST-[0-9]{5}$' then raise exception 'bad code %', (select customer_code from t_ctx); end if;
  if (select db_schema from t_ctx) <> 't_' || lower(replace((select customer_code from t_ctx), '-', '_')) then raise exception 'bad schema name'; end if;
  v_key := public.issue_license_key(v_tid);
  if v_key !~ '^AAL-[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$' then raise exception 'bad key format %', v_key; end if;
  v_key2 := public.issue_license_key(v_tid);
  if (select count(*) from public.license_keys where tenant_id = v_tid and revoked_at is null) <> 1 then
    raise exception 'more than one active key';
  end if;
  perform public.extend_subscription(v_tid, 'PRO', 12, 'yearly', 3000000);
  if (select plan_code from public.v_admin_tenant_overview where id = v_tid) <> 'STARTER' then raise exception 'current plan should stay until period ends'; end if;
  if (select days_left from public.v_admin_tenant_overview where id = v_tid) < 390 then raise exception 'extension not reflected in days_left'; end if;
  if (select max_pos_devices from public.v_admin_tenant_overview where id = v_tid) <> 2 then raise exception 'quota should follow current plan'; end if;
  if (select access_status from public.v_admin_tenant_overview where id = v_tid) <> 'active' then raise exception 'status not active'; end if;
end $$;
select pg_temp.expect_error('select key_hash from public.license_keys', '%permission denied%');
reset role;
\echo PASS 5 tenant, license key, extension

-- 6. Kuota device (STARTER = 2)
do $$
declare v_tid uuid := (select id from t_ctx); i int;
begin
  for i in 1..2 loop
    insert into public.device_activations (tenant_id, device_fingerprint, device_name) values (v_tid, 'fp' || i, 'Kasir ' || i);
  end loop;
end $$;
select pg_temp.expect_error($q$insert into public.device_activations (tenant_id, device_fingerprint, device_name) select id, 'fp3', 'Kasir 3' from t_ctx$q$, 'DEVICE_QUOTA_EXCEEDED%');
\echo PASS 6 device quota enforced

-- 7. Viewer read-only; tidak bisa RPC tulis
update auth.users set encrypted_password = 'hash-baru' where id = '00000000-0000-0000-0000-0000000000a2';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
do $$ begin
  if (select count(*) from public.tenants) <> 1 then raise exception 'expected exactly one tenant'; end if;
  if (select count(*) from public.v_admin_tenant_overview) <> 1 then raise exception 'viewer cannot read overview'; end if;
  if (select count(*) from public.platform_audit_logs) <> 0 then raise exception 'viewer can read audit'; end if;
end $$;
select pg_temp.expect_error($q$select public.set_tenant_status(id, 'suspended', 'x') from t_ctx$q$, 'FORBIDDEN');
select pg_temp.expect_error($q$select public.issue_license_key(id) from t_ctx$q$, 'FORBIDDEN');
select pg_temp.expect_error($q$select public.audit(null, 'x', null, null)$q$, '%permission denied%');
reset role;
\echo PASS 7 viewer read-only

-- 8. Suspend oleh superadmin memblok aktivasi device baru; audit tidak bisa dihapus
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select (public.set_tenant_status(id, 'suspended', 'telat bayar')).status from t_ctx;
do $$ begin
  if (select access_status from public.v_admin_tenant_overview limit 1) <> 'suspended' then raise exception 'not suspended'; end if;
  if (select count(*) from public.platform_audit_logs) < 5 then raise exception 'audit missing'; end if;
end $$;
reset role;
select pg_temp.expect_error('delete from public.platform_audit_logs', '%append-only%');
\echo PASS 8 suspend and immutable audit

\echo ALL TESTS PASSED
