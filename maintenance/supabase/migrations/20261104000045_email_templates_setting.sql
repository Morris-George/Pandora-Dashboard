-- Customer email look and wording edited in Admin → Email design (empty = built-in)
insert into app_settings (key, value) values ('email_templates', '{}') on conflict (key) do nothing;
