-- Lost item / short bag alert recipients (Admin → Lost item alerts)
insert into app_settings (key, value) values ('alerts', '{}') on conflict (key) do nothing;
