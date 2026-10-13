-- Stub minimal lingkungan Supabase untuk menguji migrasi di PostgreSQL biasa.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create schema extensions;
grant usage on schema auth, extensions, public to anon, authenticated;
create table auth.users (id uuid primary key, email text, encrypted_password text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated;
-- Supabase memberi hak default yang longgar; migrasi harus mempersempitnya sendiri.
alter default privileges in schema public grant all on tables    to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
