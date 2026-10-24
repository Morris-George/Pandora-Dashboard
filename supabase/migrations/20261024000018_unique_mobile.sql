-- One customer per mobile number, whatever format it was typed in:
-- +201001234567, 00201001234567, 201001234567 and 01001234567 are all stored as 01001234567.
create or replace function norm_mobile(m text) returns text language sql immutable as $$
  select case
    when d ~ '^(0020|20)1[0-9]{9}$' then '0' || right(d, 10)
    when d ~ '^1[0-9]{9}$' then '0' || d
    else d end
  from (select regexp_replace(coalesce(m, ''), '\D', '', 'g') as d) x
$$;

create or replace function customers_norm_mobile() returns trigger language plpgsql as $$
begin
  new.mobile := norm_mobile(new.mobile);
  return new;
end $$;

create trigger customers_mobile_norm before insert or update of mobile on customers
  for each row execute function customers_norm_mobile();

-- Existing rows (fails loudly if two customers already share a number in different formats)
update customers set mobile = norm_mobile(mobile) where mobile <> norm_mobile(mobile);
