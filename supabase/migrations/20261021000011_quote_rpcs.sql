-- Quote approval (BRD 6.5). Customer Service records the customer's answer; quotation and
-- ticket status change together. A phone answer needs a call reference for the audit trail.

create or replace function respond_quote(p_ticket uuid, p_approve boolean, p_via text, p_call_ref text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare q quotations;
begin
  if not has_role('cs') then raise exception 'only Customer Service can record the answer' using errcode = '42501'; end if;
  if p_via not in ('link', 'phone_agent') then raise exception 'invalid channel' using errcode = 'P0001'; end if;
  if p_via = 'phone_agent' and coalesce(trim(p_call_ref), '') = '' then
    raise exception 'call reference is required for phone answers' using errcode = 'P0001';
  end if;
  select * into q from quotations where ticket_id = p_ticket and status = 'sent' order by sent_at desc limit 1 for update;
  if not found then raise exception 'no quote waiting for this ticket' using errcode = 'P0001'; end if;

  update quotations set status = case when p_approve then 'approved' else 'rejected' end,
    responded_at = now(), responded_via = p_via, call_reference = nullif(trim(p_call_ref), '')
    where id = q.id;
  perform transition_ticket(p_ticket, case when p_approve then 'in_repair' else 'quote_rejected' end::ticket_status, p_reason);
end $$;

revoke execute on function respond_quote(uuid, boolean, text, text, text) from public, anon;
grant execute on function respond_quote(uuid, boolean, text, text, text) to authenticated;

-- Quotations change only through the diagnosis / quote RPCs
drop policy if exists quotes_write on quotations;
