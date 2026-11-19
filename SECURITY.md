# Security notes

## Immediate precautions

- Never commit personal access tokens, passwords, private keys, or Android signing keystores.
- The historical Android signing keystore and its password were previously committed to this repository. Treat that signing identity as compromised.
- Removing the keystore from the current branch does not erase it from Git history. History cleanup and key rotation require a separate, deliberate operation and a backup.
- A replacement Android signing key may prevent users with the old app from installing updates over their existing installation. Confirm the update strategy before rotating the key.

## Current application architecture

The existing browser-based admin flow uses a GitHub personal access token to write repository data. Session storage reduces persistence after the browser session ends, but it does not make a browser-held token safe against XSS or a compromised device.

This is not a substitute for a backend authentication system. Before production multi-user access, implement server-side authentication, role-based authorization, secure sessions, audit logging, and a database. Enforce every permission on the server, not only in the interface.

## Reporting

Do not publish credentials in issues or discussions. Rotate any credential that may have been exposed.
