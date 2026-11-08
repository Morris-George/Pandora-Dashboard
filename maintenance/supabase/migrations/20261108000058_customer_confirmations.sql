-- The customer confirms from the WhatsApp link: the intake receipt (item + agreed cost) and, later, collecting the item
alter table tickets add column if not exists customer_confirmed_intake_at timestamptz, add column if not exists customer_confirmed_pickup_at timestamptz;
