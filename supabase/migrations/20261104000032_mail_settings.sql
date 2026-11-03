-- Mail server settings, edited in Admin → Email. One row. RLS on with no policies and no grants:
-- only the server (service role) reads it, so the password never reaches a browser.
create table if not exists mail_settings (
  id boolean primary key default true check (id),
  host text, port int, username text, password text,
  from_name text, from_email text,
  paused boolean not null default true,
  updated_by uuid references profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table mail_settings enable row level security;
revoke all on mail_settings from anon, authenticated;
