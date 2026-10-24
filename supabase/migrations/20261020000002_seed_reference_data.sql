-- Reference data: reports, default report access per role, HQ repair center
insert into reports (key, label, is_financial) values
  ('transit', 'Items in transit', false),
  ('status', 'Tickets by status / TAT / SLA', false),
  ('warranty', 'Warranty ratio', false),
  ('revenue', 'Repair revenue & parts cost', true),
  ('pickup', 'Awaiting pickup / uncollected ageing', false),
  ('productivity', 'Technician productivity', false),
  ('audit', 'Audit trail', false)
on conflict (key) do nothing;

insert into report_access (report_key, role, level, updated_by)
select r.key, x.role::app_role, 'none', null from reports r cross join unnest(enum_range(null::app_role)) x(role)
on conflict do nothing;

update report_access ra set level = v.level::report_level from (values
  ('transit','manager','view'),('transit','courier','view'),('transit','hq','view'),('transit','supervisor','view'),('transit','ops','export'),
  ('status','associate','view'),('status','manager','view'),('status','hq','view'),('status','technician','view'),('status','supervisor','export'),
  ('status','cs','view'),('status','finance','view'),('status','ops','export'),
  ('warranty','manager','view'),('warranty','supervisor','view'),('warranty','finance','view'),('warranty','ops','export'),
  ('revenue','finance','export'),('revenue','ops','export'),
  ('pickup','associate','view'),('pickup','manager','export'),('pickup','cs','view'),('pickup','ops','view'),
  ('productivity','supervisor','view'),('productivity','ops','export'),
  ('audit','supervisor','view'),('audit','ops','export')
) v(report_key, role, level) where ra.report_key = v.report_key and ra.role = v.role::app_role;

insert into branches (code, name, erp_warehouse, is_hq) values ('HQ', 'HQ Repair Center', null, true)
on conflict (code) do nothing;
