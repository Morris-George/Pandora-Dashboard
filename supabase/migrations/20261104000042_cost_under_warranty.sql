-- A cost can be quoted even when the item is under warranty (e.g. misuse, extras the customer asks for).
-- Under warranty + cost lines → a quote goes to the customer, like out of warranty.
do $$
declare src text;
begin
  src := pg_get_functiondef('apply_diagnosis'::regproc);
  src := replace(src, 'if p_warranty = ''under_warranty'' then',
                      'if p_warranty = ''under_warranty'' and coalesce(jsonb_array_length(p_quote), 0) = 0 then');
  execute src;
  src := pg_get_functiondef('submit_diagnosis'::regproc);
  src := replace(src, 'case when p_warranty = ''out_of_warranty'' then p_quote end', 'nullif(p_quote, ''[]''::jsonb)');
  execute src;
end $$;
