-- Courier handover: the courier confirms collecting a sealed batch (seal number must match),
-- so every batch shows who carried it and when.
alter table dispatch_batches
  add column if not exists courier_id uuid references profiles (id),
  add column if not exists picked_up_at timestamptz;

create or replace function courier_pickup(p_batch uuid, p_seal text)
returns dispatch_batches language plpgsql security definer set search_path = public as $$
declare b dispatch_batches;
begin
  if not has_role('courier') then raise exception 'only a courier can collect batches' using errcode = '42501'; end if;
  select * into b from dispatch_batches where id = p_batch for update;
  if not found then raise exception 'batch not found' using errcode = 'P0002'; end if;
  if b.status <> 'in_transit' then raise exception 'batch is not in transit' using errcode = 'P0001'; end if;
  if b.courier_id is not null then raise exception 'batch already collected' using errcode = 'P0001'; end if;
  if upper(trim(coalesce(p_seal, ''))) <> upper(b.seal_no) then
    insert into audit_log (entity, entity_id, action, new_value)
      values ('dispatch_batches', p_batch::text, 'seal_mismatch', jsonb_build_object('entered', p_seal));
    raise exception 'seal number does not match' using errcode = 'P0001';
  end if;
  update dispatch_batches set courier_id = auth.uid(), picked_up_at = now() where id = p_batch returning * into b;
  return b;
end $$;
revoke execute on function courier_pickup(uuid, text) from public, anon;
grant execute on function courier_pickup(uuid, text) to authenticated;

-- Receipt layout (logo, contact, terms, fields); edited in Admin
insert into app_settings (key, value, updated_by) values ('receipt', '{}'::jsonb, null) on conflict (key) do nothing;

-- Trigger function: never called directly (security advisor)
revoke execute on function queue_customer_email() from public, anon, authenticated;
