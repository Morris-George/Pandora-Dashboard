-- The customer agrees a maximum repair cost at the store (intake). After diagnosis a chargeable
-- quote within that amount goes straight to repair; a higher one goes to Quote approval as before.
alter table tickets add column if not exists agreed_amount numeric(12, 2) check (agreed_amount is null or agreed_amount >= 0);
alter table quotations drop constraint if exists quotations_responded_via_check;
alter table quotations add constraint quotations_responded_via_check check (responded_via in ('link', 'phone_agent', 'store_agreement'));
comment on column tickets.agreed_amount is 'Max repair cost (incl. VAT) the customer agreed at the store; null = no pre-agreement';

create or replace function apply_diagnosis(p_ticket uuid, p_warranty warranty_result, p_quote jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare sub numeric(12, 2); vat numeric(12, 2); agreed numeric(12, 2); within boolean;
begin
  update tickets set warranty_final = p_warranty, updated_at = now() where id = p_ticket;
  if p_warranty = 'under_warranty' then
    perform transition_ticket(p_ticket, 'in_repair');
  else
    select coalesce(sum((l->>'qty')::numeric * (l->>'price')::numeric), 0) into sub from jsonb_array_elements(p_quote) l;
    vat := round(sub * 0.14, 2); -- Egypt VAT
    select agreed_amount into agreed from tickets where id = p_ticket;
    within := agreed is not null and sub + vat <= agreed;
    insert into quotations (ticket_id, lines, subtotal, tax, total, status, sent_at, responded_at, responded_via)
      values (p_ticket, p_quote, sub, vat, sub + vat,
              case when within then 'approved' else 'sent' end, now(),
              case when within then now() end, case when within then 'store_agreement' end);
    update tickets set quote_total = sub + vat where id = p_ticket;
    if within then
      perform transition_ticket(p_ticket, 'in_repair', format('Within the %s EGP the customer agreed at the store', agreed));
    else
      perform transition_ticket(p_ticket, 'awaiting_customer_approval');
    end if;
  end if;
  update diagnoses set decided_at = now() where ticket_id = p_ticket;
end $$;
revoke execute on function apply_diagnosis(uuid, warranty_result, jsonb) from public, anon, authenticated;
