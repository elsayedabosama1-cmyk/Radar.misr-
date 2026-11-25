# Mirsad integration staging

This branch stages the provider-neutral Neon/Cloudflare API and Android offline-draft queue on top of the current `main` website and news data.

## Included
- Neon PostgreSQL core schema and offline-sync migration.
- Cloudflare Worker API, including the idempotent `POST /api/v1/sync` endpoint.
- Android encrypted token storage, local outbox, and WorkManager sync worker.
- Debug APK build workflow and manually-triggered signed release workflow.
- Security and release guidance.
- Removal of the historical signing keystore from the current tree. This does not erase it from Git history or make the exposed signing identity safe.

## Deliberately preserved from current main
The current `index.html`, `sw.js`, news data, media, and existing Worker/import paths are preserved. The Android branch's older website bundle was not copied because it predates the current site and points at the obsolete `Radar.misr-` Pages URL.

## Not yet connected or production-ready
- The current website login flow is not compatible with the new Better Auth/JWT API contract. It still contains legacy login/bootstrap calls; do not point it at the new Worker.
- The Android bridge and outbox are present, but the current website does not yet call `Android.queueOperation` or hand a verified Better Auth access token to `Android.setSyncToken`.
- No Neon project, Better Auth tenant, Hyperdrive configuration, Worker secrets, or database migration has been provisioned/applied.
- No live authentication, authorization, sync, media upload, or end-to-end test has been run.
- Base64 image attachments are intentionally not synced; object-storage upload remains a separate implementation task.

## Validation expected from CI
- Apply every PostgreSQL migration in order to a clean PostgreSQL 16 service.
- Install backend dependencies and run the Worker syntax check.
- Build a debug APK without using the historical release keystore.

## Deployment gates
1. Implement and test the website Better Auth sign-in/session flow against the exact Neon Auth issuer, JWKS URL, and audience.
2. Connect website article/draft actions to the Worker API and Android outbox; preserve offline drafts and surface rejected/conflict states.
3. Add API tests for unauthenticated requests, audience/staff separation, reporter/editor/chairman permissions, editorial transitions, idempotent replay, and malformed payloads.
4. Provision Neon/Cloudflare using owner-controlled dashboards and private secrets. Never paste credentials into chat or commit them.
5. Decide the Android signing-key migration separately. The old key was committed historically; rotating it can prevent in-place app updates.
6. Only after all gates pass, review and merge this staging PR. Do not deploy from this branch.
