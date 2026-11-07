-- Item snapshot taken from ERPNext at intake (kept even if the ERP item changes later)
alter table tickets
  add column item_description text,
  add column item_barcode text,
  add column item_image text; -- ERPNext file path, served through /api/erp-image
create index on tickets (item_code);
