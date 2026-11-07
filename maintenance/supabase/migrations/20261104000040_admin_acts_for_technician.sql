-- Super Admin viewing as Technician can work on any technician's ticket (testing alone, covering for a technician).
do $$
declare src text;
begin
  src := pg_get_functiondef('complete_repair(uuid, jsonb)'::regprocedure);
  src := replace(src, 't.assigned_technician is distinct from auth.uid() then',
                      '(t.assigned_technician is distinct from auth.uid() and not is_admin_account()) then');
  execute src;
  src := pg_get_functiondef('submit_diagnosis'::regproc);
  src := replace(src, '(has_role(''technician'') and t.assigned_technician = auth.uid())',
                      '(has_role(''technician'') and (t.assigned_technician = auth.uid() or is_admin_account()))');
  execute src;
end $$;
