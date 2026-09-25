-- 24 Sep 2026. Roster reminders and the "opened" record (Andy).
--
--  - agreement_opened_at: the first time the composer opens the signing page.
--    The roster-onboarding function sets it and notifies Andy and the requester.
--  - Two reminders, raised on read in track_my_notifications like overdue
--    invoices (there is no scheduler): an invite with no details after 7 days
--    (to whoever invited), and a sent agreement not signed after 7 days (to
--    whoever requested it, and to the signatory, andy@sequelsounds.com). Once
--    per team per person.
--
-- The function body below is the live one; the invoice-overdue loop is
-- unchanged from 0075.

alter table public.track_roster_onboarding add column if not exists agreement_opened_at timestamptz;

-- (track_my_notifications: see the live definition, applied as
-- 0083_roster_reminders on 24 Sep; read it with
-- select pg_get_functiondef('public.track_my_notifications'::regproc).)
