-- Ticket numbers: each store has its own serial, e.g. CFC-000001, MOE-000001.
alter table branches add column if not exists ticket_serial integer not null default 0;

create or replace function set_ticket_prefix() returns trigger
language plpgsql security definer set search_path = public as $$
declare p text; n integer;
begin
  if new.ticket_no like 'MT-%' then
    update branches set ticket_serial = ticket_serial + 1 where id = new.branch_id
      returning coalesce(nullif(ticket_prefix, ''), code), ticket_serial into p, n;
    if p is not null then new.ticket_no := p || '-' || lpad(n::text, 6, '0'); end if;
  end if;
  return new;
end $$;
