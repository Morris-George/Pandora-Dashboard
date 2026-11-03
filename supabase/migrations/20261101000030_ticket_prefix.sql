-- Ticket numbers start with the store prefix (e.g. CFC-10051). The number stays one shared sequence.
alter table branches add column if not exists ticket_prefix text;

update branches set ticket_prefix = case code
  when 'CFC' then 'CFC'
  when 'CC-ALMAZA' then 'CCAlmaza'
  when 'CS' then 'C.Stars'
  when 'MOE' then 'MOE'
  when 'MALL-OF-ARABIA' then 'MOA'
  when 'POINT-90' then 'Point'
  when 'ALEX' then 'CCAlex'
  when 'ONLINE' then 'Online'
  when 'TRN' then 'TRN'
end;

create or replace function set_ticket_prefix() returns trigger language plpgsql security definer set search_path = public as $$
declare p text;
begin
  select ticket_prefix into p from branches where id = new.branch_id;
  if p is not null and new.ticket_no like 'MT-%' then
    new.ticket_no := p || '-' || substr(new.ticket_no, 4);
  end if;
  return new;
end $$;

drop trigger if exists tickets_prefix on tickets;
create trigger tickets_prefix before insert on tickets for each row execute function set_ticket_prefix();
