# Release guide (manual Marketplace upload)

API Hero is released with **`npm run package`** (local `@vscode/vsce` via `scripts/package-vsix.mjs`) and a **manual upload** in the [Visual Studio Marketplace publisher portal](https://marketplace.visualstudio.com/manage).

**Do not use `vsce publish` in this environment** (PAT / publish auth issues). Packaging and portal upload only. Do not introduce CI/CD for publishing.

Extension ID: `ankitsemwal.api-hero` · Publisher: `ankitsemwal`

For a longer pre-flight checklist, see [docs/release/marketplace-readiness.md](docs/release/marketplace-readiness.md) and (when present) [docs/release/v1.0-release-checklist.md](docs/release/v1.0-release-checklist.md).

---

## Prerequisites

- Node.js + npm installed
- Repo dependencies: `npm install`
- VS Code 1.90+ for local VSIX install smoke tests
- Access to the Marketplace publisher account for `ankitsemwal`

---

## Step-by-step

### 1. Version bump

Update `version` in `package.json` (semver). Align any version mentions in `README.md` if they are hardcoded.

### 2. Update CHANGELOG

Add a Keep a Changelog section for the new version in `CHANGELOG.md` (Added / Changed / Fixed as appropriate).

### 3. Run lint

```bash
npm run lint
```

### 4. Run tests

```bash
npm test
```

(Or rely on the full `npm run package` pipeline below, which runs tests after a clean build.)

### 5. Build

```bash
npm run build
```

Equivalent to `npm run compile` (`tsc -p ./`).

### 6. Package the VSIX

Preferred one-shot (clean → build → test → VSIX into `release/`):

```bash
npm run package
```

This runs:

1. `npm run clean` — remove `dist/`
2. `npm run build` — TypeScript compile
3. `npm test` — compile + unit tests
4. `node ./scripts/package-vsix.mjs` — produce `release/api-hero-<version>.vsix` via local `@vscode/vsce`

`vscode:prepublish` also compiles when vsce packages; that is expected.

Output path: **`release/api-hero-<version>.vsix`**. The repo root should not contain `.vsix` files. The `release/` folder is gitignored.

**Do not run `vsce publish` / `npx @vscode/vsce publish`.**

### 7. Verify VSIX locally

1. Confirm the `.vsix` file size looks reasonable (no multi‑MB accidental bloat from docs/tests/source maps/backups).
2. Install from VSIX:

   ```bash
   code --install-extension release/api-hero-<version>.vsix
   ```

   Or in VS Code: **Extensions** → **⋯** → **Install from VSIX…**
3. Smoke-test: create/open a `.api` request → run → response → History; spot-check Env/Auth managers and Collections.

### 8. Upload via Marketplace publisher portal

1. Open [https://marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage)
2. Select publisher **ankitsemwal** → extension **API Hero**
3. Upload `release/api-hero-<version>.vsix` (manual update / new version)
4. Wait for validation / publishing to complete

### 9. Verify listing

- Marketplace page shows the new version, icon, gallery banner, and README
- Description, categories, and keywords still match shipped scope
- Install from Marketplace on a clean VS Code profile and re-run a short smoke test

### 10. Create Git tag

After the Marketplace version is live (or when you are ready to mark the source release):

```bash
git tag -a v<version> -m "API Hero v<version>"
git push origin v<version>
```

Only push when you intend to publish the tag remotely.

### 11. Publish GitHub Release

On GitHub: create a Release for tag `v<version>`, paste the CHANGELOG section (or [docs/release/v2.5.0-release-notes.md](docs/release/v2.5.0-release-notes.md) when shipping 2.5.0), and attach `release/api-hero-<version>.vsix` if desired.

---

## npm scripts (packaging)

| Script | Purpose |
| --- | --- |
| `npm run clean` | Delete `dist/` |
| `npm run build` | Compile TypeScript (`tsc`) |
| `npm run lint` | ESLint on `src/**/*.ts` |
| `npm test` | Compile + unit tests |
| `npm run package` | **clean → build → test → VSIX in `release/`** |

---

## What stays out of the VSIX

`.vscodeignore` excludes tests, coverage, `src/`, docs, examples, `release/`, source maps, git/agent metadata, `.vsix` / backup bundles, Marketplace listing media under `images/marketplace/**`, and maintainer files such as `RELEASE.md`. Runtime must still include `dist/`, `package.json`, `LICENSE`, `README.md`, `CHANGELOG.md`, extension chrome icons (`images/icon.png`, `images/api-*.svg`, `images/execution-*.svg`), `language-configuration.json`, `syntaxes/`, and `snippets/`. Listing screenshots use Cloudinary CDN URLs in the README (see [docs/release/marketplace-assets.md](docs/release/marketplace-assets.md)).
