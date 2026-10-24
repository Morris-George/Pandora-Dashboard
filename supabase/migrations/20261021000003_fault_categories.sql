-- Fault categories managed by System Admin (replaces the hard-coded check constraint).
-- Categories are deactivated, never deleted, so old tickets keep their category.

create table fault_categories (
  name text primary key check (length(trim(name)) between 2 and 60),
  requires_comment boolean not null default false,
  active boolean not null default true,
  is_system boolean not null default false, -- 'Other' cannot be removed
  sort_order int not null default 100,
  updated_by uuid references profiles (id) default auth.uid(),
  updated_at timestamptz not null default now()
);

insert into fault_categories (name, requires_comment, is_system, sort_order) values
  ('Broken clasp', false, false, 10),
  ('Broken chain', false, false, 20),
  ('Missing stone', false, false, 30),
  ('Tarnish / discoloration', false, false, 40),
  ('Sizing', false, false, 50),
  ('Other', true, true, 999);

alter table tickets drop constraint if exists tickets_fault_category_check;
alter table tickets drop constraint if exists other_fault_needs_comment;
alter table tickets add constraint tickets_fault_category_fkey
  foreign key (fault_category) references fault_categories (name) on update cascade;

-- New tickets: category must be active; comment required where the category says so
create or replace function check_fault_category() returns trigger
language plpgsql security definer set search_path = public as $$
declare fc fault_categories;
begin
  select * into fc from fault_categories where name = new.fault_category;
  if tg_op = 'INSERT' or new.fault_category is distinct from old.fault_category then
    if not fc.active then
      raise exception 'fault category "%" is no longer in use', new.fault_category using errcode = 'P0001';
    end if;
  end if;
  if fc.requires_comment and length(trim(coalesce(new.fault_notes, ''))) = 0 then
    raise exception 'a comment is required for fault category "%"', new.fault_category using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function check_fault_category() from public, anon, authenticated;
create trigger tickets_fault_category before insert or update of fault_category, fault_notes on tickets
  for each row execute function check_fault_category();

-- System categories cannot be deactivated or renamed
create or replace function protect_system_category() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.is_system and (new.active = false or new.name <> old.name or new.is_system = false) then
    raise exception 'system category "%" cannot be removed or renamed', old.name using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function protect_system_category() from public, anon, authenticated;
create trigger fault_categories_protect before update on fault_categories
  for each row execute function protect_system_category();

create trigger audit_fault_categories after insert or update on fault_categories
  for each row execute function audit_row();

alter table fault_categories enable row level security;
create policy fault_categories_read on fault_categories for select to authenticated
  using (current_role_name() is not null);
create policy fault_categories_admin_insert on fault_categories for insert to authenticated
  with check (has_role('admin') and is_system = false);
create policy fault_categories_admin_update on fault_categories for update to authenticated
  using (has_role('admin')) with check (has_role('admin'));
-- no delete policy: deactivate instead
