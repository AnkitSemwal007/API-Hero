# API Hero project package (`.apihero`)

A **project package** is a single portable file for an API Hero project. It is not a request file and it does not replace Git. Use it to export, import, back up, or move a project between machines.

User-facing files use the `.apihero` extension, for example `My-API-Project.apihero`. You do not unzip the file or work with a `.zip` name.

## Export Project

1. Open an API Hero project folder (it must contain `.apihero/config.json`).
2. Run **API Hero: Export Project**.
3. In a multi-root workspace, choose the folder to export.
4. Choose a destination. API Hero writes `*.apihero`.

## Import Project

1. Run **API Hero: Import Project**.
2. Select a `.apihero` file.
3. API Hero validates the package, manifest, contents, and paths.
4. Choose a destination folder.
5. If that folder already has an API Hero project, confirm **Overwrite** (or cancel). Overwrite replaces only package-owned roots: the Collections directory and tracked `.apihero` documents (`config.json`, `workspace.json`, `environments/`, `auth/`). Unrelated files and folders in the destination stay. `.apihero/local/` is kept.
6. API Hero restores the project and offers to open the folder.

Import never writes outside the selected folder. Unsafe paths are rejected.

## Package format v1

Application version (for example 2.12.0) is not the package format version.

| Concept | v1 value |
| --- | --- |
| Format identifier | `apihero-project` |
| Kind | `project` |
| Format version | `1` |

Unsupported `formatVersion` values fail closed. v1 does not migrate older or newer packages.

The file is an archive that contains:

- `manifest.json` — identity, format version, project name, creation time, API Hero version (informational), collections directory, and SHA-256 checksums for every packaged file
- `project/` — the project snapshot

## Manifest

Typical fields:

- `format`, `kind`, `formatVersion`
- `projectName`
- `createdAt`
- `apiHeroVersion` (informational; not used for compatibility)
- `collectionsDirectory` (single relative segment, usually `Collections`)
- `files` — `{ "path", "sha256" }` for each payload file under `project/`

Every payload file must be listed. Extra archive entries or checksum mismatches fail import.

## Supported project artifacts

Included:

- `.api` request files (including nested collection folders)
- Collections (`Collections/`, markers, collection variables). Other files under Collections (for example `.env` or keys) are not packed.
- `.apihero/config.json`
- `.apihero/workspace.json` (workspace variables and active environment)
- `.apihero/environments/*.json`
- `.apihero/auth/profiles.json` (profile metadata only)
- Legacy `.api` files outside `Collections/` (same relative paths)

Excluded:

- `.apihero/local/` (secret overlays and migration backup)
- `.apihero/cache/` and `.apihero/history/`
- Request history (extension storage)
- VS Code Secret Storage credential values
- User-global variables and editor settings
- `.git`, `node_modules`, `.vscode`
- Scenarios (not part of the current product surface)

`projectId` in `config.json` is preserved.

## Secret handling

Packages never include unredacted credentials.

- Sensitive environment, workspace, and collection variable values are stored empty (same as Git-tracked project files).
- Auth profile literals are stored as `{ "kind": "secret" }`. Real tokens stay in Secret Storage and are not packed.
- Sensitive HTTP headers in `.api` files (`Authorization`, `Cookie`, `X-Api-Key`, …), including disabled `#` / `//` header lines, become placeholders such as `{{token}}`.
- `@sensitive-variable` values are stored empty.
- URL userinfo and common secret query parameters are redacted.

After import, re-enter secrets locally (Secret Storage and `.apihero/local/`).

## Import validation

Before any files are written, API Hero checks:

- The package can be opened
- The manifest exists and is valid
- `format` / `kind` / `formatVersion` are supported
- Listed files exist, hashes match, and no extra entries are present
- Paths are relative, stay under `project/`, and cannot escape the destination (`../`, absolute paths, drive letters)

Invalid, corrupt, or unsafe packages fail with a short error. Stack traces are not the user-facing message.

## Limitations

- v1 is VS Code only (no Desktop, CLI, or MCP package commands).
- Export is a sanitized snapshot, not a bit-identical backup of secret values.
- Overwrite replaces packaged Collections and tracked `.apihero` documents; it does not merge two projects or delete unrelated destination files.
- Import validates the archive, manifest, checksums, and paths before writing. Content is staged under `.apihero/.pkg-import/` first. If a write fails after package-owned roots are replaced, the destination can be incomplete; the operation is not a single filesystem transaction.
- Scenarios are not exported or imported.
- Package signing, encryption, and cloud sync are not included.
