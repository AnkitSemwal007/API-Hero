# OpenAPI import

Import **OpenAPI 3.0.x / 3.1.x** (JSON or YAML) into workspace collections. The importer never executes HTTP.

## Run the wizard

1. **API Hero: Import OpenAPI Specification** (Collections toolbar or palette).
2. Choose the specification file and target workspace folder.
3. Confirm options in the **OpenAPI import wizard**.
4. Review the summary (files written, environments/auth metadata patched).

Generated layout (typical):

```text
Collections/<api-slug>/…
Collections/<api-slug>/api-hero.collection.json
```

Requests are generated as `.api` files through the shared **request-source** model used by the Request Editor.

## Limits and behavior

- Max file size: `apiRunner.import.maxFileBytes` (default 5 MiB).
- Local `#/` `$ref` resolution with depth/cycle caps; remote `$ref` is out of scope.
- Auth schemes map to profile metadata (secrets as placeholders). OAuth2 is not implemented as a live flow.
- Error diagnostics prevent writes and settings patches; warnings alone may still succeed.
- Swagger 2.0, Postman, Insomnia, and GraphQL import are not supported.

## Related

- [Collections](./collections.md)
- [Environments](./environments.md)
- [Authentication](./authentication.md)
- [Architecture: OpenAPI import](../architecture/openapi-import.md)
