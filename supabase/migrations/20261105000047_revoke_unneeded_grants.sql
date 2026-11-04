-- Security advisor: the ticket-number trigger function and workflow_on need no direct API access by visitors
revoke execute on function set_ticket_prefix() from public, anon, authenticated;
revoke execute on function workflow_on(text) from anon;
