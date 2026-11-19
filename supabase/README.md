# Mirsad backend foundation

This folder defines an initial Supabase backend (Postgres, Auth, and Row Level Security). Adding these files does not activate a live backend: a Supabase project must be created and the migration must be applied first.

## Roles
- chairman: Chairman of the Board; full platform authority.
- editor_in_chief: Editor-in-Chief (the same role as managing editor).
- reporter: Editors and journalists.
- audience: Public account, assigned automatically on public signup.

There is no separate managing-editor role. Public users cannot assign themselves a staff role or change account status.

## Included
- Profiles, staff role and suspension fields.
- Editorial article status model and server-side RPCs for creating, saving, submitting, approving, returning, rejecting, scheduling, publishing and archiving.
- Review history and chairman-only audit-log reading.
- Initial task and internal-notification tables.
- Public read access limited to published articles; staff-only access to internal material.

## Setup
1. Create a Supabase project owned by the platform owner.
2. Run migrations/0001_identity_editorial_core.sql in the Supabase SQL Editor.
3. Enable Email under Authentication providers and configure the production site URL and redirect URLs.
4. Keep public audience signup enabled. Never assign staff roles from user-supplied signup metadata.
5. Create the first chairman account in the Auth dashboard. Then, in the SQL Editor as the database owner, replace OWNER_EMAIL and run:
   UPDATE public.profiles p SET role='chairman', is_active=true
   FROM auth.users u WHERE p.user_id=u.id AND lower(u.email)=lower('OWNER_EMAIL');
   Do this once, manually, from a trusted admin session.
6. Invite the editor-in-chief and reporters through the Auth dashboard. The chairman assigns their roles using the protected set_profile_role RPC after they have registered.
7. The future browser client may use SUPABASE_URL and the public anon key. Never place the service_role key in the browser or repository.

## Not yet live
- No Supabase project has been created or connected.
- The migration has not been run against a live database and RLS has not been integration-tested.
- Task and notification tables are schema foundations; create/update/dispatch APIs are still to be added.
- The existing static site is not yet connected to Supabase Auth or these RPCs. Do not use the current GitHub-token admin login as a substitute for this backend.
