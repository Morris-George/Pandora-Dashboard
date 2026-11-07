-- Bag (AWB) numbers are made automatically per store: AWB-<store code>-000001, like the ticket numbers.
-- The store code is the ticket prefix (e.g. CFC); a typed number is still accepted if one is sent.
alter table branches add column if not exists awb_serial integer not null default 0;

create or replace function next_awb(p_branch uuid) returns text
language plpgsql security definer set search_path = public as $$
declare p text; n integer;
begin
  update branches set awb_serial = awb_serial + 1 where id = p_branch
    returning coalesce(nullif(ticket_prefix, ''), code), awb_serial into p, n;
  return 'AWB-' || p || '-' || lpad(n::text, 6, '0');
end $$;
revoke execute on function next_awb(uuid) from public, anon, authenticated;

do $$
declare f text; src text;
begin
  foreach f in array array['create_outbound_batch', 'create_return_batch'] loop
    src := pg_get_functiondef(f::regproc);
    src := replace(src,
      'if coalesce(trim(p_seal), '''') = '''' then raise exception ''seal number is required'' using errcode = ''P0001''; end if;',
      'if coalesce(trim(p_seal), '''') = '''' then p_seal := next_awb(p_branch); end if;');
    if position('next_awb' in src) = 0 then raise exception 'patch did not apply to %', f; end if;
    execute src;
  end loop;
end $$;
