-- Each store chooses who picks up its bags, per trip: the Courier or the Area Manager (Admin → Stores).
-- The two Courier switches in Admin → Workflow stay on; off would mean the Area Manager everywhere.
alter table branches add column if not exists pickup_out text not null default 'courier' check (pickup_out in ('courier', 'area_manager'));
alter table branches add column if not exists pickup_return text not null default 'courier' check (pickup_return in ('courier', 'area_manager'));

update app_settings set value = coalesce(value, '{}'::jsonb) || '{"courier_out": true, "courier_return": true}'::jsonb where key = 'workflow';

do $$
declare src text;
begin
  src := pg_get_functiondef('courier_pickup'::regproc);
  src := replace(src,
    'by_courier := workflow_on(case when b.direction = ''outbound'' then ''courier_out'' else ''courier_return'' end);',
    'by_courier := workflow_on(case when b.direction = ''outbound'' then ''courier_out'' else ''courier_return'' end)
    and (select case when b.direction = ''outbound'' then pickup_out else pickup_return end from branches where id = b.branch_id) = ''courier'';');
  if position('pickup_out' in src) = 0 then raise exception 'patch did not apply'; end if;
  execute src;
end $$;
