-- The technician (or supervisor) can mark a piece not repairable, at diagnosis or during repair; it then goes back to the store
update status_transitions set allowed_roles = '{technician,supervisor}' where from_status = 'under_diagnosis' and to_status = 'unrepairable';
insert into status_transitions (from_status, to_status, allowed_roles, requires_reason)
select s::ticket_status, 'unrepairable', '{technician,supervisor}', true from unnest(array['in_repair','awaiting_parts']) s
where not exists (select 1 from status_transitions where from_status = s::ticket_status and to_status = 'unrepairable');
