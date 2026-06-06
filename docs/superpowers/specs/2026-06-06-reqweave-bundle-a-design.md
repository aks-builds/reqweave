# reqweave Bundle A — Runnable test suites + DX

- **Date:** 2026-06-06
- **Status:** Approved (design); implementing feature-by-feature
- **Part of:** the gap-fill roadmap **A → B → C → D** (A here; B fidelity, C breadth, D lifecycle each get their own spec→plan→build cycle).

Bundle A turns reqweave's importable collections into **runnable test suites** and
smooths everyday use. All changes are TypeScript (exporters/CLI) + the skill — no
analyzer or runtime changes. Each feature lands as its own green PR.

## Features

### A1 — Test-assertion generation (marquee)
The variant engine already computes an `expectedStatus` per variant; today no
exporter emits an assertion. Add `src/exporters/assertions.ts`:

```ts
interface AssertionSet { status: number; contentType?: string; jsonSchema?: JsonSchemaNode; }
function assertionsFor(ir: Ir, variant: RequestVariant): AssertionSet;
```
`assertionsFor` matches the variant's `expectedStatus` to the endpoint's response
to pull content-type and (for 2xx) the response schema. Each collection exporter
renders the set into its native test DSL, with **capability-based fallback**:

| Tool | status | content-type | response JSON-schema |
|---|---|---|---|
| Postman | `pm.response.to.have.status` | header includes | ✅ `pm.response.to.have.jsonSchema(schema)` |
| Thunder Client | `res-code` test | `res-header` test | ⬇ fallback |
| Bruno | `assert` block | `assert` block | ⬇ fallback |
| Hoppscotch | `pw.expect(status)` | `pw.expect(headers)` | ⬇ fallback |
| OpenAPI / .http | — (spec / no runner) | — | — |

On by default; `--no-tests` (CLI) / `tests:false` (export option / MCP arg) opts
out. Scripts are deterministic and secret-free.

### A2 — OpenAPI examples
Embed the happy-path variant's request body as an `example` on the operation's
`requestBody`, and a representative response example per declared response.

### A3 — Collection-level auth + tag folders
Emit auth once at the collection level (where the tool supports it: Postman,
Insomnia, Thunder, Bruno) instead of per-request headers; group requests into
folders by endpoint **tag** (fallback: endpoint id). Cleaner, navigable output.

### A4 — Project config + `reqweave init`
`reqweave.config.json` with `tools`, `depth`, `baseUrl`, `out`, `service`,
`exclude`, `tests`. The CLI loads it from the target/cwd; explicit flags override
config which overrides built-in defaults. `reqweave init` scaffolds a commented
config. JSON only (no new deps).

### A5 — `reqweave install`
Agent-agnostic skill installer (Claude, Cursor, Codex, OpenCode, Gemini,
Windsurf), mirroring cliproof's `bin` pattern — copies `skills/reqweave/` into
each detected agent's skills dir; `--only`/`--skip`/`--force`/`--dry-run`.

## Architecture decision
Shared, tool-agnostic `AssertionSet` computed once per variant + per-tool
renderers (the "what" is DRY; the "how" is per-tool, with graceful fallback) —
chosen over duplicating assertion logic in each exporter.

## Cross-cutting
- Determinism preserved (assertion scripts are pure functions of the IR/variant).
- Per-exporter isolation kept; one exporter failing can't sink others.
- Security: no secrets in scripts; placeholders only.
- Testing: unit tests for `assertionsFor` + each renderer + config load/precedence
  + `init`/`install`; existing conformance + determinism tests updated.

## Out of scope (later bundles)
Build-mode + prebuilt binaries (B), new source languages (C), contract-diff +
mock servers (D), IDE extensions (E).
