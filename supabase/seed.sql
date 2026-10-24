-- Reference data (replace branch list with the real ERPNext warehouses)
insert into branches (code, name, erp_warehouse, is_hq) values
  ('HQ', 'HQ Repair Center', '[ERP warehouse]', true),
  ('CS', 'City Stars', '[ERP warehouse]', false),
  ('MOE', 'Mall of Egypt', '[ERP warehouse]', false);

insert into reports (key, label, is_financial) values
  ('transit', 'Items in transit', false),
  ('status', 'Tickets by status / TAT / SLA', false),
  ('warranty', 'Warranty ratio', false),
  ('revenue', 'Repair revenue & parts cost', true),
  ('pickup', 'Awaiting pickup / uncollected ageing', false),
  ('productivity', 'Technician productivity', false),
  ('audit', 'Audit trail', false);

-- Default report access (BRD 10.2); anything not listed = none
insert into report_access (report_key, role, level, updated_by) values
  ('transit', 'manager', 'view', null), ('transit', 'courier', 'view', null), ('transit', 'hq', 'view', null),
  ('transit', 'supervisor', 'view', null), ('transit', 'ops', 'export', null),
  ('status', 'associate', 'view', null), ('status', 'manager', 'view', null), ('status', 'hq', 'view', null),
  ('status', 'technician', 'view', null), ('status', 'supervisor', 'export', null), ('status', 'cs', 'view', null),
  ('status', 'finance', 'view', null), ('status', 'ops', 'export', null),
  ('warranty', 'manager', 'view', null), ('warranty', 'supervisor', 'view', null), ('warranty', 'finance', 'view', null),
  ('warranty', 'ops', 'export', null),
  ('revenue', 'finance', 'export', null), ('revenue', 'ops', 'export', null),
  ('pickup', 'associate', 'view', null), ('pickup', 'manager', 'export', null), ('pickup', 'cs', 'view', null),
  ('pickup', 'ops', 'view', null),
  ('productivity', 'supervisor', 'view', null), ('productivity', 'ops', 'export', null),
  ('audit', 'supervisor', 'view', null), ('audit', 'ops', 'export', null);
