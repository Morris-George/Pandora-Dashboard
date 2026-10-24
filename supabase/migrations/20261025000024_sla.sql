-- SLA: target days per stage (Admin can edit). A ticket is overdue when it sits in a stage longer than its target.
create table if not exists sla_rules (
  status ticket_status primary key,
  max_days numeric(5, 1) not null check (max_days > 0),
  updated_by uuid references profiles (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table sla_rules enable row level security;
create policy sla_read on sla_rules for select to authenticated using (current_role_name() is not null);
create policy sla_admin on sla_rules for update to authenticated using (has_role('admin')) with check (has_role('admin'));
create trigger audit_sla_rules after insert or update on sla_rules for each row execute function audit_row();

insert into sla_rules (status, max_days, updated_by) values
  ('received_at_branch', 2, null), ('awaiting_dispatch', 1, null), ('in_transit_to_hq', 3, null),
  ('received_at_hq', 1, null), ('under_diagnosis', 3, null), ('awaiting_customer_approval', 5, null),
  ('in_repair', 7, null), ('awaiting_parts', 14, null), ('quality_check', 1, null),
  ('ready_to_return', 2, null), ('in_transit_to_branch', 3, null), ('ready_for_pickup', 30, null),
  ('quote_rejected', 2, null), ('unrepairable', 2, null)
on conflict (status) do nothing;

-- When the ticket entered its current stage (kept by the status history)
alter table tickets add column if not exists status_since timestamptz;
update tickets t set status_since = coalesce((select max(at) from status_history h where h.ticket_id = t.id), t.created_at)
  where status_since is null;

create or replace function stamp_status_since() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update tickets set status_since = new.at where id = new.ticket_id;
  return new;
end $$;
revoke execute on function stamp_status_since() from public, anon, authenticated;
drop trigger if exists status_history_since on status_history;
create trigger status_history_since after insert on status_history for each row execute function stamp_status_since();
create index if not exists tickets_status_since on tickets (status, status_since);

-- Due time of the current stage (null when the stage has no target)
create or replace function sla_due_at(p_status ticket_status, p_since timestamptz) returns timestamptz
language sql stable security definer set search_path = public as $$
  select p_since + make_interval(secs => (select max_days from sla_rules where status = p_status) * 86400)
$$;
revoke execute on function sla_due_at(ticket_status, timestamptz) from public, anon;
grant execute on function sla_due_at(ticket_status, timestamptz) to authenticated;
