# OpenAPI Import demo

1. Command Palette → **API Hero: Import OpenAPI Specification**
2. On the **Source** step, choose either:
   - **Local File** — browse to a JSON/YAML OpenAPI 3.x document under `examples/openapi/` or elsewhere; or
   - **URL** — paste a public OpenAPI 3.x HTTP(S) address, for example the
     [Swagger Petstore](https://petstore3.swagger.io/api/v3/openapi.json)
     (subject to upstream availability). The wizard fetches the document, then
     runs the same importer as local files.
3. Complete the wizard preview and write into a Collections folder.

Imported requests use the same `.api` serializer as the Request Editor.

**Notes:** Only OpenAPI 3.0 / 3.1 are supported (not Swagger 2.0). Authenticated
URLs and remote `$ref` fetching are not supported.
