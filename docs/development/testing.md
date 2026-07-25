# Testing

Unit tests use Node’s built-in **`node:test`** and **`node:assert`**. There is no Vitest/Jest runner.

## Run tests

```bash
npm test
```

This **compiles first** (`tsc`), then runs `scripts/run-unit-tests.mjs` against compiled output under `dist/`.

```bash
npm run test:coverage   # c8 summary
npm run check           # typecheck only
npm run lint
```

Always compile (or rely on `npm test`) before expecting `*.test.ts` changes to execute — tests run from emitted JavaScript.

## Layout

Colocate `*.test.ts` next to the code under test (for example `src/assertions/assertions.test.ts`). Prefer pure domain tests without the VS Code host.

## Adapter coverage notes

| Layer | Guidance |
| --- | --- |
| Domain (parser, resolver, runner plans, OpenAPI pipeline) | Prefer thorough `node:test` coverage with fixtures |
| HTML / message parsers | Unit-test builders and `parse*Message` helpers |
| VS Code adapters (`*/vscode/`) | Keep thin; mock ports rather than launching the extension host for routine tests |
| Orchestrator | Use fake executor / history ports in `orchestration/*.test.ts` |

Do not add a second unit-test framework. Extension-host integration tests are out of scope for the default `npm test` script unless explicitly introduced later.

## Related

- [Development README](./README.md)
- [Architecture](../architecture/README.md)
