-- Who picks up each bag is chosen when it is packed (store manager for store bags, HQ for return bags):
--   courier       the Courier takes the sealed bag: checks the AWB number only
--   area_manager  the Area Manager checks every item in the bag, then takes it
-- The store's setting in Admin → Stores is only the default choice. The Workflow Courier switch off = Area Manager always.
alter table dispatch_batches add column if not exists pickup_by text check (pickup_by in ('courier', 'area_manager'));

do $$
declare f text; src text; col text;
begin
  foreach f in array array['create_outbound_batch', 'create_return_batch'] loop
    col := case when f = 'create_outbound_batch' then 'pickup_out' else 'pickup_return' end;
    src := pg_get_functiondef(f::regproc);
    -- new optional parameter (the old 3-argument call keeps working)
    src := replace(src, 'p_tickets uuid[])', 'p_tickets uuid[], p_pickup text DEFAULT NULL::text)');
    src := replace(src, '  return b;' || chr(10) || 'end',
      '  update dispatch_batches set pickup_by = case when not workflow_on(''' || case when f = 'create_outbound_batch' then 'courier_out' else 'courier_return' end || ''') then ''area_manager''' ||
      ' else coalesce(nullif(p_pickup, ''''), (select ' || col || ' from branches where id = p_branch), ''courier'') end where id = b.id returning * into b;' || chr(10) ||
      '  return b;' || chr(10) || 'end');
    if position('p_pickup text' in src) = 0 or position('pickup_by' in src) = 0 then raise exception 'patch did not apply to %', f; end if;
    execute 'drop function ' || f || '(uuid, text, uuid[])';
    execute src;
    execute 'revoke execute on function ' || f || '(uuid, text, uuid[], text) from public, anon';
    execute 'grant execute on function ' || f || '(uuid, text, uuid[], text) to authenticated';
  end loop;

  -- Pickup: follow the bag's choice; the Courier scans only the AWB of the sealed bag
  src := pg_get_functiondef('courier_pickup'::regproc);
  src := regexp_replace(src, 'by_courier := workflow_on\(.*?= ''courier'';', 'by_courier := coalesce(b.pickup_by, ''area_manager'') = ''courier'';');
  src := replace(src, '  if missing > 0 then raise exception', '  if missing > 0 and not by_courier then raise exception');
  if position('b.pickup_by' in src) = 0 or position('and not by_courier' in src) = 0 then raise exception 'patch did not apply to courier_pickup'; end if;
  execute src;
end $$;
