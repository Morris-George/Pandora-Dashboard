-- Private bucket for ticket photos & signatures. Object path: <ticket_id>/<stage>-<n>.<ext>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ticket-media', 'ticket-media', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

create or replace function can_see_ticket(p_ticket uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from tickets t where t.id = p_ticket and can_see_branch(t.branch_id))
$$;
revoke execute on function can_see_ticket(uuid) from public, anon;
grant execute on function can_see_ticket(uuid) to authenticated;

create policy media_objects_read on storage.objects for select to authenticated
  using (bucket_id = 'ticket-media' and public.can_see_ticket(((storage.foldername(name))[1])::uuid));

create policy media_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'ticket-media'
              and public.has_role('associate', 'manager', 'hq', 'technician', 'supervisor')
              and public.can_see_ticket(((storage.foldername(name))[1])::uuid));
-- no update/delete policies: evidence photos are immutable

-- FR1: a ticket cannot leave draft without at least 2 intake photos
create or replace function transition_ticket(p_ticket uuid, p_to ticket_status, p_reason text default null)
returns tickets language plpgsql security definer set search_path = public as $$
declare t tickets; rule status_transitions;
begin
  select * into t from tickets where id = p_ticket for update;
  if not found or not can_see_branch(t.branch_id) then raise exception 'ticket not found' using errcode = 'P0002'; end if;
  select * into rule from status_transitions where from_status = t.status and to_status = p_to;
  if not found then raise exception 'transition % -> % is not allowed', t.status, p_to using errcode = 'P0001'; end if;
  if not (current_role_name() = any (rule.allowed_roles)) then
    insert into audit_log (entity, entity_id, action, new_value) values ('tickets', p_ticket::text, 'denied_transition', jsonb_build_object('from', t.status, 'to', p_to));
    raise exception 'role % may not perform % -> %', current_role_name(), t.status, p_to using errcode = '42501';
  end if;
  if rule.requires_reason and coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required for % -> %', t.status, p_to using errcode = 'P0001'; end if;
  if t.status = 'draft' and p_to = 'received_at_branch'
     and (select count(*) from ticket_media where ticket_id = p_ticket and stage = 'intake') < 2 then
    raise exception 'at least 2 intake photos are required' using errcode = 'P0001';
  end if;
  insert into status_history (ticket_id, from_status, to_status, reason) values (p_ticket, t.status, p_to, p_reason);
  update tickets set status = p_to, updated_at = now() where id = p_ticket returning * into t;
  return t;
end $$;
