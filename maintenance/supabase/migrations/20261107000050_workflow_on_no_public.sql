-- workflow_on: signed-in users only (PUBLIC grant removed)
revoke execute on function workflow_on(text) from public, anon;
grant execute on function workflow_on(text) to authenticated;
