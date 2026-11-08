-- Return bags are sent by HQ: their AWB carries the HQ code (AWB-HQ-000001)
do $$
declare src text;
begin
  src := pg_get_functiondef('create_return_batch'::regproc);
  src := replace(src, 'p_seal := next_awb(p_branch);', 'p_seal := next_awb(coalesce((select id from branches where is_hq order by name limit 1), p_branch));');
  if position('where is_hq' in src) = 0 then raise exception 'patch did not apply'; end if;
  execute src;
end $$;
