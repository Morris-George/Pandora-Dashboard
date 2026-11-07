-- WhatsApp message templates edited in Admin → WhatsApp messages (empty = built-in text)
insert into app_settings (key, value) values ('wa_templates', '{}') on conflict (key) do nothing;
