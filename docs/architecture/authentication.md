# Authentication architecture

## Pipeline and stage contracts

Authentication is an immutable runtime stage:

`RuntimeRequest -> variable resolver -> ResolvedRequest -> AuthenticationResolver -> AuthenticatedRequest -> RequestExecutor`

`ResolvedRequest` is an additive contract requiring variable-resolution
metadata. `AuthenticatedRequest` additionally requires
`authenticationStage: "authenticated"` and resolved authentication metadata.
The executor accepts only `AuthenticatedRequest`, so parser-built or unresolved
requests cannot cross its public type boundary.

Authentication core code has no VS Code, parser, executor, or transport
dependency. It receives a detached resolved request and returns a deeply frozen
detached request. JavaScript strings and Node buffers cannot be reliably
zeroized; the design prevents persistence and presentation rather than claiming
in-memory erasure.

## Providers and registry

`AuthenticationProviderRegistry` is created by extension composition and is not
a global singleton. Duplicate IDs are rejected. A provider publishes immutable
metadata and decorates headers or query data. Adding OAuth2, JWT refresh, AWS
Signature, Azure, or GCP support requires registering a provider and profile
schema; the resolver and executor do not change. Those providers and flows are
not implemented.

Implemented providers:

- `none`: performs no decoration and still produces `AuthenticatedRequest`.
- `basic`: reads username/password and emits UTF-8 RFC 7617-style Base64 in
  `Authorization`. Node encoding is behind `BasicEncoder`.
- `bearer`: emits `Authorization: Bearer ...`.
- `apiKey`: emits one validated custom header or appends one encoded query
  parameter.

Existing target headers (case-insensitive) and query names (decoded for
comparison) cause a safe conflict error. Authentication never silently
duplicates credentials. Header names must satisfy HTTP token grammar; header
values reject CR, LF, and NUL. Empty bearer/API-key values and unresolved
`{{...}}` placeholders are rejected.

Query decoration appends without reserializing the existing URL, preserving
encoded bytes, duplicate order, empty values, and fragments.

## Profiles, references, and precedence

`@auth profileName` is the source-visible reference syntax. No grammar change
is required. A request-level directive takes precedence over a document-level
directive, which takes precedence over the explicit session default selected by
`API Runner: Select Authentication Profile`. If none exists, `none` is used.
The picker does not edit `.api` files or persist a default.

Non-secret profile metadata lives in `apiRunner.authentication.profiles`:

```json
{
  "id": "service",
  "label": "Service account",
  "providerId": "basic",
  "username": { "kind": "variable", "name": "serviceUser" },
  "password": { "kind": "secret" }
}
```

Credential sources are:

- `{ "kind": "secret" }`
- `{ "kind": "variable", "name": "token" }`
- `{ "kind": "literal", "value": "...", "unsafe": true }`

Literal values are intentionally marked unsafe. Variable-derived values are
read from the already-resolved per-run variable snapshot and are never written
to secret storage. The `apiRunner.authentication.profiles` JSON schema enforces
this: a `literal` source requires both `value` and `unsafe: true`, and a
`variable` source requires `name`.

## Profile validation and duplicate policy

Raw profile configuration is normalized once by `validateAuthenticationProfiles`
into a single immutable snapshot of valid profiles plus structured, secret-free
issues (identifiers and field names only). The manager, the per-run resolution
context, and the language diagnostics all consume this same snapshot, so they
never independently reinterpret raw profiles.

Invalid entries are skipped deterministically rather than throwing, so one bad
entry can never break the picker, `capture`/`list`, or `none`/other valid
executions. Entries are rejected when their `id` is missing, empty, or
prototype-sensitive (`__proto__`, `prototype`, `constructor`), or when their
`providerId` is missing or not a string.

Duplicate-id policy: every entry sharing a colliding `id` is excluded (no
arbitrary shadowing winner) and a single `duplicate-id` issue is recorded. A
request selecting a duplicate or malformed id fails before transport with an
`INVALID_PROFILE` `AuthenticationError`; a request selecting an id that was
never configured fails with `MISSING_PROFILE`. Both carry names only.

## Secret lifecycle

`SecretStorageService` is the sole VS Code `SecretStorage` adapter.
`DefaultAuthenticationSecretRepository` provides get/store/delete without
enumeration. Stable keys use:

`apiRunner.auth.profile.<encoded-profile-id>.<encoded-field>`

Profile fields are fixed by provider metadata; profile configuration cannot
redirect secret reads to arbitrary keys. Removing a profile does not enumerate
or expose values; callers explicitly delete known fields during profile
lifecycle operations.

## Diagnostics and execution

Canonical parser and semantic diagnostics are combined with dynamic
authentication profile diagnostics in the language adapter, which consumes the
same validated snapshot described above. Missing profiles, duplicate profile
IDs, malformed/invalid profiles, and unsupported providers identify only
profile/provider names. Configuration/profile changes invalidate the cached
adapter once through the existing refresh registration, and stale async
availability diagnostics are dropped when the document version or adapter
changes. Missing secret fields are checked asynchronously during authentication
and block network execution.

Each run captures profile/default/variable context after variable resolution.
Secret reads and provider decoration happen once with abort checks before and
after asynchronous reads. Replacement and cancellation guards prevent stale
runs from updating UI.

## Security and presentation

Provider errors contain profile/provider/field identifiers only. Credential
values are excluded from resolved authentication metadata, diagnostics, logs,
status, and causes. Authentication query values are replaced with the standard
mask in `presentationUrl`; response summaries use that URL. Auth-added header
names are marked sensitive and stripped by the transport on cross-origin
redirects alongside Authorization, Cookie, and Proxy-Authorization.

Authentication does not inspect AST nodes, mutate requests, perform network
flows, refresh tokens, persist variable values, or render credentials.
