# Mirsad backend architecture (approved direction)

## Decision

Mirsad will use a free-tier-first, portable backend:
- Neon Postgres: primary relational database.
- Neon Managed Better Auth: authentication and session identity stored alongside the Postgres data.
- Cloudflare Workers: server-side API and authorization boundary.
- Neon Object Storage: news images and uploaded media (5 GB free allowance per project).
- Cloudflare Pages / Workers Static Assets: public website and application assets, selected after inspecting the existing frontend.

Do not create a Supabase project or apply the legacy Supabase migration. Files in supabase/ are historical reference material only until replaced by provider-neutral SQL and API code.

## Non-negotiable cost controls
- Use only provider Free plans.
- Do not enable paid plans, paid add-ons, paid AI APIs, or automatic upgrades.
- Do not add a payment card or billing method as part of setup.
- Never describe a service as guaranteed free forever or unlimited.
- Track Neon compute/storage/transfer and Cloudflare Workers/R2 quotas.
- If a quota is reached, fail safely or pause affected non-critical work rather than silently opting into paid usage.
- Before enabling any feature whose overage can create charges, verify account-level billing controls and obtain explicit owner approval. No such approval is currently given.

## Free-tier planning baseline (verify again at account setup)
The provider's published limits can change. Planning baseline recorded on 2026-11-19:
- Neon Free: up to 100 projects; 100 CU-hours per project per month; 1 GB Postgres storage per project; Managed Better Auth included up to 60,000 monthly active users.
- Cloudflare Workers Free: 100,000 requests per day; 10 ms CPU time per invocation.
- Neon Object Storage Standard free allowance: 10 GB-month storage, 1 million Class A operations/month, 10 million Class B operations/month, and no egress charge.

These are quotas, not unlimited capacity or a service-level guarantee. R2 usage above its free allowance can be billable if billing is enabled; do not enable billing or attach a payment method without explicit owner approval.

## Application security model
The browser must never connect to Neon with a database credential. All protected operations go through the Cloudflare Worker API. The Worker validates the Better Auth session and enforces authorization server-side for every request.

Roles (no separate managing-editor role):
- chairman: highest authority over accounts, editorial workflow, content, reports and audit history.
- editor_in_chief: runs editorial review and may suspend reporters/editors, but cannot suspend or demote the chairman.
- reporter: drafts and submits stories; cannot approve or publish their own stories.
- audience: public account, isolated from staff routes and internal material.

Public visitors may read published articles without signing in. Audience accounts are separate from staff accounts. Public signup must never accept a client-supplied staff role.

Every Worker route must apply authentication and role checks before database mutations. Use parameterized SQL, strict input validation, rate limiting for authentication and public write endpoints, secure cookie/session settings, CSRF protection where applicable, and an append-only audit trail for sensitive actions. Never expose database URLs, auth secrets, R2 credentials, or privileged tokens to the browser.

## Editorial workflow
Preserve the approved statuses: draft, submitted_for_review, in_review, changes_requested, approved, scheduled, published, rejected, archived.

Reporters can create/edit their own drafts and submit them for review. The editor-in-chief reviews and returns, approves, rejects, schedules, or publishes according to policy. Chairman retains full override authority. All decisions and account status changes are audited with actor, timestamp, entity, and before/after values.

## Migration plan
1. Inspect the existing frontend and identify the current build/runtime before choosing Pages versus Workers Static Assets.
2. Replace Supabase-specific auth references with Better Auth session verification in the Worker.
3. Port the schema to provider-neutral PostgreSQL. Remove dependencies on auth.users, auth.uid(), Supabase grants, and Supabase RLS roles.
4. Keep authorization in a dedicated server-side policy layer and Worker endpoints; do not trust client-side role flags.
5. Implement account provisioning safely: the first chairman is established through a one-time owner-controlled bootstrap procedure; staff accounts are invited/approved; audience signup remains open.
6. Implement article, review, task, notification, source-management, media and audit APIs.
7. Store media in R2 using private upload authorization and public delivery only for approved/published assets.
8. Add automated tests for role boundaries, article state transitions, suspension rules, public isolation, upload authorization, and audit coverage.
9. Run migrations and end-to-end tests only after the owner creates provider accounts and configures credentials privately.

## Secrets and configuration
Use Cloudflare Worker secrets/environment bindings for the Neon database connection string (server-side only), Better Auth secret and trusted origin configuration, and R2 bucket bindings/credentials as appropriate.

Do not commit credentials, tokens, environment files, database URLs, or signing keys. Do not ask the owner to paste secret values into chat. The owner should enter them directly into the provider dashboard or approved secret manager.

## Current implementation status
This decision document does not mean a live Neon or Cloudflare project exists. No provider account has been connected, no database has been provisioned, and no migration has been applied. The old Supabase migration is not production-ready and must not be run. The existing GitHub PR and main branch remain untouched; this work is isolated on a dedicated branch until reviewed.