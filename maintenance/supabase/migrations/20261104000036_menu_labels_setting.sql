-- Menu names (Admin → Menu). The row must exist: admins may update app_settings but not insert into it.
insert into app_settings (key, value, updated_by) values ('menu_labels', '{}'::jsonb, null) on conflict (key) do nothing;
