-- Contact line at the bottom of the customer tracking page (Admin → Customer page contact)
insert into app_settings (key, value) values ('customer_contact', '{}') on conflict (key) do nothing;
