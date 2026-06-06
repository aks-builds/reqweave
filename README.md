# reqweave

> Read your service code; get ready-to-import API collections for **every** testing tool — with exhaustive request variants per endpoint.

`reqweave` statically analyzes a service codebase and generates native,
ready-to-import collections for Postman, OpenAPI, Insomnia, Bruno, Hoppscotch,
Thunder Client, and `.http` — covering not one request per endpoint, but a
curated-yet-thorough set of request **variants** (happy path, optional
combinations, boundary/invalid values, one per response status). No more hand-
building API requests, and no more collections drifting from the code.

**One source in → importable collections for every tool out.**

> [!NOTE]
> **Status: early development (Phase 0 — scaffold).** The engine, analyzer, and
> exporters are being built phase by phase. See the
> [design spec](docs/superpowers/specs/2026-06-06-reqweave-design.md) and the
> [implementation plan](docs/superpowers/plans/2026-06-06-reqweave-implementation-plan.md).

## What it will do (M1)

- **Read ASP.NET Core REST** APIs (attribute-routed controllers + minimal APIs),
  static-first via Roslyn, with optional build-mode (ApiExplorer) for ground truth.
- **Generate thorough request variants** per endpoint, bounded by a
  `--depth minimal|standard|exhaustive` knob (pairwise interaction coverage so
  collections stay importable, not bloated).
- **Export natively** to Postman v2.1, OpenAPI 3.1, Insomnia, Bruno, Hoppscotch,
  Thunder Client, and `.http`, plus per-tool environment templates.
- **Ship everywhere**: CLI/npm, an Agent Skill, a Claude marketplace plugin, and
  an MCP server.

## Quick start (planned)

```bash
npx reqweave generate ./path/to/service --out ./collections --tools all --depth standard
```

Then import the generated files into your tool of choice and start hitting the API.

## Architecture

A .NET (Roslyn) **analyzer** reads the codebase and emits a versioned, tool-
agnostic **Universal IR**. A TypeScript **core** consumes that IR and owns the
variant engine, all exporters, the CLI, the MCP server, and the Skill — so each
future language analyzer is a drop-in that emits the same IR.

```
codebase ─► reqweave-analyzer (.NET/Roslyn) ─► Universal IR (JSON) ─► variant engine ─► exporters ─► every tool
```

## Design principles

- **No code execution by default** — static read; build-mode is opt-in.
- **No network, no telemetry** — your code stays local.
- **Never leak secrets** — variables + env templates + redaction.
- **Deterministic** — byte-stable output for clean diffs.

## Development

```bash
npm install
npm run build      # tsc
npm test           # vitest

dotnet test analyzer/test/Reqweave.Analyzer.Tests   # .NET analyzer
```

## License

[MIT](LICENSE.md)
