-- Customer came without the original invoice / proof of purchase
alter table tickets add column no_invoice boolean not null default false;
alter table tickets add constraint no_invoice_means_no_invoice_data
  check (not no_invoice or (erp_sales_invoice is null and purchase_date is null));
