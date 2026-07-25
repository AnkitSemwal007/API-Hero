# Security Policy

## Supported versions

Security fixes are applied to the latest published Marketplace / GitHub release of **API Hero** (`ankitsemwal.api-hero`). Older versions may not receive backports.

## Reporting a vulnerability

If you discover a vulnerability—especially around **Secret Storage**, credential handling, auth profile resolution, or webview message handling—please **do not** open a public issue with exploit details.

Prefer one of:

1. GitHub **private vulnerability reporting** on [AnkitSemwal007/API-Hero](https://github.com/AnkitSemwal007/API-Hero) (if enabled), or  
2. Contact the maintainer via the email on the GitHub profile / Marketplace publisher page.

Include:

- Extension version
- VS Code version and OS
- Minimal reproduction (redact secrets)
- Impact assessment

We will acknowledge reports as soon as practical and coordinate disclosure after a fix is available.

## Security model (summary)

- Auth secrets belong in VS Code **Secret Storage**, not in committed `.api` files or settings JSON values marked secret.
- History and response presentation use **masked** URLs/values where sensitivity is known.
- Webviews use restrictive CSP (nonce) and validated message schemas.
- Literal credential sources in profiles are intentionally marked `unsafe` in configuration schema.

See also [SUPPORT.md](SUPPORT.md) and [docs/user/authentication.md](docs/user/authentication.md).
