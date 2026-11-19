# Android release process

## Debug builds

The `Build APK` workflow builds a debug APK and uploads it as a short-lived Actions artifact. It does not create a GitHub Release.

## Signed release builds

The `Release signed APK` workflow is manually triggered. Configure these GitHub Actions repository secrets first:

- `MIRSAD_KEYSTORE_BASE64`: base64-encoded Android signing keystore
- `MIRSAD_KEYSTORE_PASSWORD`
- `MIRSAD_KEY_ALIAS`
- `MIRSAD_KEY_PASSWORD`

The keystore must be created and stored securely outside the repository. Do not commit it.

**Important:** the old signing keystore and password were exposed in the repository. Do not assume a replacement key can update already-installed copies of the app. Decide the signing-key migration strategy before publishing a replacement-signed release.
