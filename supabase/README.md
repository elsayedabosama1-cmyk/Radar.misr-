# DEPRECATED — do not deploy

This directory contains an early Supabase-specific prototype retained only as historical reference. The project has approved Neon Postgres + Neon Managed Better Auth + Cloudflare Workers + Cloudflare R2 as its target backend.

**Do not create a Supabase project, do not run the migration in this directory, and do not connect the frontend to Supabase.** The SQL depends on Supabase Auth and Row Level Security and is not portable as-is.

The replacement architecture and migration plan are documented in docs/BACKEND_ARCHITECTURE.md. A provider-neutral PostgreSQL schema, Better Auth integration, Worker API, authorization policy layer, R2 media flow, and automated tests must be implemented and reviewed before any live deployment.

No Neon or Cloudflare project has been provisioned yet. No production credentials belong in this repository or in chat.
