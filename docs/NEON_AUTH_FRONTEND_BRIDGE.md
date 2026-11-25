# Mirsad frontend authentication and Android bridge — implementation contract

Status: implementation guide only. This file does not configure Neon, deploy services, or enable authentication.

## Current compatibility boundary

The current `index.html` still calls the legacy Worker routes `POST /login` and `POST /bootstrap`. The staged Worker does not implement either route. It expects Neon Auth-issued JWTs on protected routes, validated against the configured issuer, JWKS URL, and audience.

Do not point the current website at the staged Worker until the auth migration is complete. Keep the existing Pages/static website and legacy import Worker operational during the migration.

## Supported SDK direction

Use the official `@neondatabase/auth` package, bundled into the existing static-site build output. Pin an exact package version in a lockfile; do not load an unpinned CDN script in production.

The official SDK's Better Auth client exposes `signIn.email()`, `signUp.email()`, `signOut()`, and `getSession()`. Neon documents that the JWT is included as `session.access_token` in the returned session. The auth adapter factory is documented as:

```js
import { createAuthClient } from "@neondatabase/auth";

const auth = createAuthClient(NEON_AUTH_URL);
const result = await auth.signIn.email({ email, password });
const sessionResult = await auth.getSession();
const session = sessionResult?.data?.session ?? sessionResult?.session ?? null;
const jwt = session?.access_token ?? null;
```

Before wiring this into the production UI, add a small integration test against the exact pinned SDK version to confirm the concrete `getSession()` response shape. Never decode an unverified token to authorize a role; the Worker remains the authority for identity and roles.

## Required frontend behavior

1. Replace the legacy `/login` and `/bootstrap` calls with Neon Auth sign-in and sign-up flows. Public registration must never accept a role from the browser; all new profiles start as `audience`.
2. After sign-in, obtain the session JWT and call `Android.setSyncToken(jwt)` only inside the Android WebView. Do not store the JWT in `localStorage`, `sessionStorage`, IndexedDB, URLs, logs, or article records.
3. On sign-out, call `Android.setSyncToken("")` before/while signing out, then clear the UI session state.
4. For a saved draft in Android, enqueue a payload matching the Worker contract:
   `{id, t, b, cat, gov, src, srcUrl, img}` with operation kind `draft.save`.
   The native bridge generates a fresh operation UUID for every edit. Do not reuse the article ID as the operation ID; the server's idempotency receipt would replay the earlier save.
5. Acknowledge only `acknowledged` results. Keep `conflict` and `rejected` items visible to the user with a retry/edit path. Do not silently delete failed drafts.
6. Data-URL/base64 images are not synced by the current API. Preserve them locally and show an explicit attachment-pending state until a real upload API and object-storage bucket are implemented.
7. Use `GET /api/v1/me` to obtain the server-authoritative profile and role after sign-in. Do not infer staff permissions from browser state or user-editable profile fields.

## Required configuration (must come from the actual Neon/Cloudflare projects)

- Neon Auth URL for the correct Neon branch.
- Exact JWT issuer.
- Exact JWKS URL.
- Exact JWT audience configured for the API.
- Cloudflare Worker HTTPS base URL.
- Worker `ALLOWED_ORIGIN` matching the deployed website origin.
- Hyperdrive configuration and a least-privilege database login.

Do not invent these values or commit secrets. Keep the API base URL in the Android build environment as `MIRSAD_API_BASE_URL`; the debug APK built by CI without this variable intentionally has sync disabled.

## Security/release gates

- Confirm the SDK version and session response shape with automated tests.
- Test sign-in, sign-out, session refresh, expired token, wrong issuer, wrong audience, and unavailable JWKS.
- Verify Android bridge is exposed only to packaged trusted content. The current MainActivity restricts navigation to `file:///android_asset/` and sends ordinary web links outside the WebView; preserve this boundary.
- Test offline save, process restart, reconnect, duplicate delivery, server conflict, and attachment-pending states.
- Run a live end-to-end test against a non-production Neon branch and Worker before production deployment.
- Never publish a signed release until a deliberate signing-key migration is complete. The previously committed keystore remains in Git history and must be treated as compromised.

## Official SDK references

- https://github.com/neondatabase/neon-js/tree/main/packages/auth
- https://github.com/neondatabase/neon-js/blob/main/packages/auth/src/neon-auth.ts
- https://github.com/neondatabase/website/blob/main/content/docs/auth/authentication-flow.md
