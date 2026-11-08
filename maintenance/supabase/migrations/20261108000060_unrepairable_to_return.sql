-- A not-repairable piece goes straight to the return list (the same person who marked it moves it on)
update status_transitions set allowed_roles = '{technician,supervisor}' where from_status = 'unrepairable' and to_status = 'ready_to_return';
