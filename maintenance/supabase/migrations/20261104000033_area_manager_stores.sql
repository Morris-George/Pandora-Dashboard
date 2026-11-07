-- Area managers see and collect only the stores assigned to them in Admin (user_branches),
-- e.g. one area manager for Alex, MOE and MOA.
create or replace function can_see_branch(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when is_real_admin() then true
    when coalesce((select is_training from branches where id = b), false) <> is_training_user() then false
    when has_role('associate', 'manager', 'courier') then in_my_branch(b)
    when has_role('hq', 'technician', 'supervisor', 'cs', 'finance', 'ops') then true
    else false
  end
$$;

create or replace function courier_pickup(p_batch uuid, p_seal text, p_scanned text[])
returns dispatch_batches language plpgsql security definer set search_path = public as $$
declare b dispatch_batches; missing int;
begin
  if not has_role('courier') then raise exception 'only an area manager can collect batches' using errcode = '42501'; end if;
  select * into b from dispatch_batches where id = p_batch for update;
  if not found or not can_see_branch(b.branch_id) then raise exception 'batch not found' using errcode = 'P0002'; end if;
  if b.status <> 'in_transit' then raise exception 'batch is not in transit' using errcode = 'P0001'; end if;
  if b.courier_id is not null then raise exception 'batch already collected' using errcode = 'P0001'; end if;
  if upper(trim(coalesce(p_seal, ''))) <> upper(b.seal_no) then
    insert into audit_log (entity, entity_id, action, new_value)
      values ('dispatch_batches', p_batch::text, 'seal_mismatch', jsonb_build_object('entered', p_seal));
    raise exception 'seal number does not match' using errcode = 'P0001';
  end if;
  select count(*) into missing from batch_items bi join tickets t on t.id = bi.ticket_id
    where bi.batch_id = p_batch and not (upper(t.ticket_no) = any (select upper(trim(s)) from unnest(p_scanned) s));
  if missing > 0 then raise exception 'scan every item before collecting (% missing)', missing using errcode = 'P0001'; end if;

  update batch_items set scanned_out = true where batch_id = p_batch;
  update tickets set held_by = auth.uid(), held_since = now() where id in (select ticket_id from batch_items where batch_id = p_batch);
  update dispatch_batches set courier_id = auth.uid(), picked_up_at = now() where id = p_batch returning * into b;
  insert into audit_log (entity, entity_id, action, new_value)
    values ('dispatch_batches', p_batch::text, 'custody_to_area_manager', jsonb_build_object('items', (select count(*) from batch_items where batch_id = p_batch)));
  return b;
end $$;

-- The training area manager covers the training store
insert into user_branches (user_id, branch_id)
  select p.id, b.id from profiles p, branches b
  where p.role = 'courier' and p.is_training and b.code = 'TRN'
  on conflict do nothing;
