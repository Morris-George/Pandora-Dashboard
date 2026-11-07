-- ERPNext sync (BRD 8A): stores come from Pandora POS Profiles, store staff from each profile's
-- user list. Accounts with source = 'erp' follow ERPNext: disabled there -> deactivated here,
-- moved to another POS Profile -> branches updated. Roles are never changed by the sync.

alter table branches add column erp_pos_profile text unique;
alter table profiles add column erp_synced_at timestamptz;
alter table tickets add column invoice_verified boolean not null default false; -- invoice found in ERPNext

create table erp_sync_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text not null check (trigger in ('cron', 'manual', 'login')),
  ok boolean,
  summary jsonb
);
alter table erp_sync_runs enable row level security;
create policy sync_runs_read on erp_sync_runs for select to authenticated using (has_role('admin'));

-- The sync only re-activates accounts it deactivated itself (an admin's manual deactivation sticks)
alter table profiles add column deactivated_by_sync boolean not null default false;

-- People the admin keeps out of the sync (e.g. senior management): never imported or re-activated
create table erp_sync_exclusions (
  email text primary key,
  reason text,
  created_by uuid references profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table erp_sync_exclusions enable row level security;
create policy exclusions_admin on erp_sync_exclusions for all to authenticated using (has_role('admin')) with check (has_role('admin'));
