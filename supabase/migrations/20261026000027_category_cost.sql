-- Fault category -> ERPNext service item and its standard cost (before VAT), editable by the Super Admin
alter table fault_categories
  add column if not exists erp_item_code text,
  add column if not exists erp_item_name text,
  add column if not exists cost numeric(12,2) check (cost is null or cost >= 0),
  add column if not exists cost_source text check (cost_source in ('erp', 'manual'));
