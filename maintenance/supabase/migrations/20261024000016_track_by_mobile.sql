-- Customers identify themselves on /track with ticket number + their mobile number.
-- p_last4 now takes the full mobile (compared on the last 9 digits, so 010…, +2010… and 2010… all match);
-- a 4-digit value still works for older links.
create or replace function track_lookup(p_ticket_no text, p_last4 text)
returns text language plpgsql security definer set search_path = public as $$
declare tok text; mob text; k text := upper(trim(p_ticket_no));
  given text := regexp_replace(coalesce(p_last4, ''), '\D', '', 'g'); ok boolean;
begin
  if public_throttled(k) then raise exception 'too many attempts, try again later' using errcode = 'P0001'; end if;
  select t.tracking_token, regexp_replace(c.mobile, '\D', '', 'g') into tok, mob from tickets t join customers c on c.id = t.customer_id
    where upper(t.ticket_no) = k and t.status <> 'draft';
  ok := tok is not null and (
    (length(given) = 4 and right(mob, 4) = given) or
    (length(given) >= 9 and right(mob, 9) = right(given, 9)));
  insert into public_attempts (key, ok) values (k, ok);
  return case when ok then tok end;
end $$;
