# reqweave

> Read your service code; get ready-to-import API collections for **every** testing tool — with exhaustive request variants per endpoint.

`reqweave` statically analyzes a service codebase and generates native,
ready-to-import collections for **Postman, OpenAPI 3.1, Insomnia, Bruno,
Hoppscotch, Thunder Client, and `.http`** — covering not one request per
endpoint, but a curated-yet-thorough set of request **variants** (happy path,
all-optional, boundary/invalid values, one per response status, unauthorized).
No more hand-building API requests, and no more collections drifting from code.

**One source in → importable collections for every tool out.**

> [!NOTE]
> **Status: M1 (ASP.NET Core REST) is functional.** Build-mode fidelity and
> minimal-API/gRPC/other-language analyzers are on the roadmap. See the
> [design spec](docs/superpowers/specs/2026-06-06-reqweave-design.md) and
> [implementation plan](docs/superpowers/plans/2026-06-06-reqweave-implementation-plan.md).

## Quick start

```bash
# all tools, standard depth, into ./reqweave-out
npx reqweave generate ./path/to/service --out ./reqweave-out --tools all --depth standard
```

Then import the generated files into your tool and start hitting the API.

```
./reqweave-out/
  postman/<svc>.postman_collection.json  (+ environment)
  openapi/<svc>.openapi.json
  insomnia/<svc>.insomnia.json
  bruno/  (bruno.json + *.bru + environments/Local.bru)
  hoppscotch/, thunder-client/  (collection + environment)
  http/<svc>.http  (+ http-client.env.json)
```

## Commands

| Command | Purpose |
|---|---|
| `reqweave generate <path>` | Generate collections. Flags: `--out`, `--tools all\|a,b`, `--depth minimal\|standard\|exhaustive`, `--base-url`, `--service`, `--build`, `--build-openapi FILE`, `--openapi FILE`, `--strict`, `--ir FILE`. |
| `reqweave list-endpoints <path>` | List discovered endpoints. |
| `reqweave inspect <path> <id>` | Show the variants for one endpoint (with provenance). |

### Variant depth
- `minimal` — happy path only.
- `standard` (default) — happy path, all-optional, unauthorized (401) for `[Authorize]`, one per declared error status, min/max boundaries.
- `exhaustive` — adds pairwise over optional-param presence and per-enum-member variants. Capped (reported in notes — never silent).

## Consumption surfaces
- **CLI / npm** — `npx reqweave …` (above).
- **MCP server** — `reqweave-mcp` (stdio): tools `list_endpoints`, `generate_collection`, `explain_variants` for any MCP-capable agent.
- **Agent Skill** — `skills/reqweave/` (progressive disclosure) for Claude and other agents.
- **Claude marketplace plugin** — `.claude-plugin/`.

## Requirements
- **Node.js ≥ 20** for the CLI/MCP.
- For analyzing **.NET source**: either a **prebuilt analyzer binary** (no SDK) or the **.NET SDK**. Resolution order:
  - `--ir <file>` / `--openapi <file>` — use an existing IR / OpenAPI doc (no analyzer at all).
  - `REQWEAVE_ANALYZER` — an explicit analyzer binary/dll you point at.
  - **Prebuilt, per-OS package** `@reqweave/analyzer-<platform>-<arch>` — a self-contained native binary installed automatically (as an optional dependency, os/cpu-gated) and **checksum-verified before it runs**. No .NET SDK needed.
  - The **.NET SDK** (`dotnet run` the analyzer) — the dev/source fallback.

## Design principles
- **No code execution by default** — static read; `--build` is opt-in.
- **No network, no telemetry** — your code stays local.
- **Never leak secrets** — `{{placeholders}}` + env templates with blank secret slots + a redaction pass.
- **Deterministic** — byte-stable output for clean diffs.

## Architecture

A .NET (Roslyn) **analyzer** reads the codebase and emits a versioned, tool-
agnostic **Universal IR**. A TypeScript **core** consumes that IR and owns the
variant engine, all exporters, the CLI, and the MCP server — so each future
language analyzer is a drop-in that emits the same IR.

```
codebase ─► reqweave-analyzer (.NET/Roslyn) ─► Universal IR (JSON) ─► variant engine ─► exporters ─► every tool
```

## Development

```bash
npm install        # builds dist/ via the prepare hook
npm run build      # tsc
npm test           # vitest

dotnet test analyzer/test/Reqweave.Analyzer.Tests   # .NET analyzer
```

## License

[MIT](LICENSE.md)
