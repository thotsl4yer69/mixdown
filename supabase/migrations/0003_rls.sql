-- mixdown :: row-level security
--
-- This is a single-user app with no auth flow — the anon key is the only
-- credential, embedded in the app bundle, exactly like every other config
-- value in app.json. Enabling RLS with permissive policies for `anon` is
-- NOT a security boundary here (an unauthenticated key can't have one); it
-- exists so the tables aren't flagged by Supabase's linter as unprotected,
-- and so the policy shape is already in place the day you want real auth.
--
-- If you ever add a second user: replace every `using (true)` below with an
-- `owner_id = auth.uid()` check, add an owner_id column, and switch the
-- client off the anon key onto real sessions. Do that before sharing a URL
-- with anyone else.

alter table topic_buckets enable row level security;
alter table sources        enable row level security;
alter table items          enable row level security;
alter table interactions   enable row level security;
alter table seen           enable row level security;
alter table bandit_state   enable row level security;
alter table taste_vector   enable row level security;
alter table prefs          enable row level security;

create policy anon_all on topic_buckets for all to anon using (true) with check (true);
create policy anon_all on sources        for all to anon using (true) with check (true);
create policy anon_all on items          for all to anon using (true) with check (true);
create policy anon_all on interactions   for all to anon using (true) with check (true);
create policy anon_all on seen           for all to anon using (true) with check (true);
create policy anon_all on bandit_state   for all to anon using (true) with check (true);
create policy anon_all on taste_vector   for all to anon using (true) with check (true);
create policy anon_all on prefs          for all to anon using (true) with check (true);

grant execute on function get_feed        to anon;
grant execute on function absorb_taste    to anon;
grant execute on function due_sources     to service_role;
grant execute on function prune           to service_role;
