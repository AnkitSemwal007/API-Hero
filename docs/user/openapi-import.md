# OpenAPI import

Import **OpenAPI 3.0.x / 3.1.x** (JSON or YAML) into workspace collections from a
**local file** or a **public HTTP(S) URL**. The importer never executes imported
HTTP operations; URL import only downloads the specification document.

## Run the wizard

1. **API Hero: Import OpenAPI Specification** (Collections toolbar or palette).
2. Choose the target workspace folder (skipped when only one folder is open).
3. On **Source**, pick **Local File** or **URL**:
   - **Local File** — Browse to a `.json` / `.yaml` / `.yml` specification.
   - **URL** — Enter an `http://` or `https://` address (for example
     `https://petstore3.swagger.io/api/v3/openapi.json`). The document is
     fetched, then converted with the **same** OpenAPI importer used for local
     files.
4. Confirm options in the preview step.
5. Review the summary (files written, environments/auth metadata patched).

Generated layout (typical):

```text
Collections/<api-slug>/…
Collections/<api-slug>/api-hero.collection.json
```

Requests are generated as `.api` files through the shared **request-source** model used by the Request Editor.

## Environments after import

OpenAPI `servers[]` become API Hero environments (primary `imported-<api-slug>`, plus up to four additional servers).

| Case | Behavior |
| --- | --- |
| **A — No active environment** | Import may activate the imported primary environment. |
| **B — An environment is already active** | The active environment is **preserved** (for example DummyJSON stays selected when you import OpenAI). Imported environments are still **created and selectable** afterward. |

Imported environments are always appended; import never deletes existing environments.

## Authentication / security schemes

Supported schemes map to profile metadata (secrets as placeholders). OAuth2 is not implemented as a live flow.

If document- or operation-level `security` names a scheme that is **missing** from `components.securitySchemes`, the importer emits a warning diagnostic and does **not** invent an auth profile. Import continues; valid schemes still import normally.

## Limits and behavior

- Max file / response size: `apiHero.import.maxFileBytes` (default 5 MiB).
- Local `#/` `$ref` resolution with depth/cycle caps; remote `$ref` is out of scope (not fetched over the network).
- Error diagnostics prevent writes and settings patches; warnings alone may still succeed.
- Swagger 2.0 and GraphQL **import** are not supported (GraphQL bodies from Postman/Insomnia remain best-effort stubs with warnings). Authored `@protocol graphql` requests are supported — see [GraphQL](./graphql.md).

## Postman Collection import

Import **Postman Collection v2 / v2.1** (local JSON file) through the same
`runImportPipeline` / `SpecificationImportProvider` path used by OpenAPI.

1. **API Hero: Import Postman Collection** (Collections toolbar or palette).
2. Choose the target workspace folder (skipped when only one folder is open).
3. Browse to a Postman Collection `.json` export.
4. Confirm options in the preview step (scripts and unsupported features appear
   as diagnostics — scripts are never executed or migrated).
5. Review the summary (files written, environments/auth metadata patched).

Secrets in names, descriptions, headers, and body examples are masked or
replaced with placeholders. Binary file bodies and GraphQL are best-effort
stubs with warnings.

## Insomnia export import

Import **Insomnia resource-based export JSON** (`__export_format` **3** or **4**,
or `_type: "export"` with a `resources` array) through the same shared pipeline
and wizard host as Postman (local file only).

1. **API Hero: Import Insomnia Export** (Collections toolbar or palette).
2. Choose the target workspace folder (skipped when only one folder is open).
3. Browse to an Insomnia `.json` export.
4. Confirm options in the preview step (scripts and unsupported features appear
   as diagnostics — scripts are never executed or migrated).
5. Review the summary (files written, environments/auth metadata patched).

### Supported

- Workspace → collection name
- `request_group` folders (nested)
- HTTP `request` resources (method, URL, query `parameters`, headers, body)
- Environments (`data` object variables; `{{ }}` / `{{ _.var }}` refs preserved)
- Authentication: bearer, basic, apiKey (secrets as placeholders)
- Descriptions on workspace / requests

### Unsupported (reported via diagnostics)

- Insomnia Document / YAML **v5**, HAR, and non–resource-based shapes
- `__export_format` other than 3 / 4
- Scripts (`preRequestScript`, `afterResponseScript`) — never executed
- Resource types: `cookie_jar`, `api_spec`, `grpc_request`, `websocket_request`,
  `socketio_request`, `mcp_request`, `proto_file`, `unit_test` /
  `unit_test_suite`, `mock`
- Auth types beyond bearer / basic / apiKey (oauth2, digest, hawk, …) —
  metadata-only `none` profiles where applicable
- Binary / file multipart bodies (stubs + warnings); GraphQL best-effort stub

## URL import security

- Only `http:` and `https:` URLs are accepted. Other schemes (`file:`, `ftp:`, `data:`, …) are rejected.
- Username/password embedded in the URL are rejected; no credentials or `Authorization` / `Cookie` headers are sent.
- Authenticated specification endpoints (HTTP 401/403) are not supported — use a public URL or a local file.
- Localhost, private, and link-local addresses are **allowed** on purpose: API Hero is a local Git-first client and developers often serve OpenAPI docs on `localhost`.
- Certificate verification is enabled. Redirects follow the Request Engine transport (non-http(s) redirect targets are rejected).

## Related

- [Collections](./collections.md)
- [Environments](./environments.md)
- [Authentication](./authentication.md)
- [Architecture: OpenAPI import](../architecture/openapi-import.md)
