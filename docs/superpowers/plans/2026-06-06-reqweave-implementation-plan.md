# reqweave — Implementation Plan (M1)

- **Date:** 2026-06-06
- **Spec:** [`docs/superpowers/specs/2026-06-06-reqweave-design.md`](../specs/2026-06-06-reqweave-design.md)
- **Status:** Draft for review

This plan sub-phases M1. Each phase is independently testable and lands behind
green CI. Build order respects the dependency graph: **IR contract first**, then
the analyzer that produces it and the engine that consumes it, then exporters,
then surfaces, then release.

## Dependency graph

```
P0 scaffold ─► P1 IR contract ─┬─► P2 analyzer(static) ─► P3 analyzer(build) ─┐
                               └─► P4 variant engine ─► P5 exporters ─────────┼─► P6 CLI ─┬─► P7 MCP
                                                                              │           ├─► P8 Skill + plugin
                                                                              └───────────┴─► P9 integration/release
```

## Repo layout (target)

```
reqweave/
├── analyzer/                 # .NET solution (Roslyn) -> emits IR JSON
│   ├── src/Reqweave.Analyzer/
│   └── test/Reqweave.Analyzer.Tests/   # xUnit + fixture API projects
├── src/                      # TypeScript core
│   ├── ir/                   # zod schema + JSON-Schema export (the contract)
│   ├── variants/             # pure variant engine
│   ├── exporters/            # one module per tool + shared interface
│   ├── analyzer-runner/      # locate/fetch/invoke the .NET analyzer binary
│   ├── cli/                  # commander-based CLI
│   └── mcp/                  # stdio MCP server
├── bin/cli.js                # npm bin entry
├── skills/reqweave/          # SKILL.md + workflows/ + scripts/
├── .claude-plugin/           # plugin.json + marketplace.json
├── tests/                    # TS integration + golden fixtures
├── docs/
└── .github/                  # workflows, templates, CODEOWNERS, dependabot
```

## Phase 0 — Repo bootstrap & quality bar
**Goal:** an empty-but-green repo with the full cliproof-grade scaffold, so every
later phase lands behind CI and the ruleset from day one.
- npm workspace; TypeScript + tsup/tsc build; vitest; eslint + prettier;
  `.editorconfig`/`.gitattributes`/`.gitignore`/`.npmignore`.
- .NET solution skeleton (`Reqweave.Analyzer` console + xUnit test project).
- `.github/`: `ci` (matrix Node 20/22 + .NET 8), `codeql`, `freshness`,
  `integration`, `publish`, `release`, `auto-approve` (caller with
  `permissions: pull-requests: write`); `CODEOWNERS`, `dependabot.yml`,
  ISSUE/PR templates.
- **Stable aggregate `test` gate** job (matrix jobs renamed `*-matrix`); branch
  ruleset on `main` (1 approval, squash-only, linear history, required check =
  `test`); approver account has write access; **no `Co-Authored-By` trailers**.
- Doc skeletons: `README`, `CHANGELOG`, `CONTRIBUTING`, `SECURITY`,
  `CODE_OF_CONDUCT`, `LICENSE`.
- **Done when:** CI green; ruleset active + auto-approve posts a counting
  approval; `npx reqweave --help` stub runs.

## Phase 1 — Universal IR contract
**Goal:** the versioned contract everything hangs off (spec §6).
- zod schema in `src/ir/` (+ generated JSON-Schema), `irVersion` field.
- Hand-authored sample IR documents as fixtures.
- **Done when:** zod validates/round-trips samples; schema published in-repo;
  unit tests cover required/optional fields and version handling.

## Phase 2 — .NET analyzer (static mode)
**Goal:** repo/project path → IR JSON, no build required (spec §7 static).
- Roslyn: controllers + minimal APIs; routes/prefixes/`[ApiVersion]`; verbs;
  `[From*]` binding; DTO→JSON-Schema (generics/inheritance/nullable/enums);
  validation attributes; `[ProducesResponseType]`/returns; auth attrs.
- `diagnostics[]` for unresolved types/ambiguous routes (never crash).
- xUnit over fixture API projects (controllers, minimal APIs, generics,
  inheritance, polymorphism, auth, versioning, broken/partial).
- **Done when:** golden fixture → expected IR (static); validates against P1 zod.

## Phase 3 — .NET analyzer (build mode, opt-in)
**Goal:** ground-truth fidelity behind `--build` (spec §7 build).
- ASP.NET `ApiExplorer`/generated OpenAPI; reconcile with static (build wins;
  diffs → diagnostics); graceful skip when SDK/build unavailable.
- **Done when:** build-mode IR matches-or-improves static for the fixture;
  reconciliation diffs surfaced as diagnostics.

## Phase 4 — Variant engine
**Goal:** pure, deterministic variant generation (spec §8).
- Presence variants; value classes + boundary derivation from constraints; auth
  present/absent; one-per-response-status; **pairwise** interaction coverage;
  `--depth minimal|standard|exhaustive` (exhaustive capped + logged); seeded
  determinism; per-variant provenance.
- **Done when:** unit tests per depth tier, boundary derivation, pairwise
  coverage, and byte-stable determinism across runs.

## Phase 5 — Exporters (all 7)
**Goal:** native output for every M1 tool (spec §9).
- Exporter interface `export(ir, variants, opts) -> files[]`; implement Postman
  v2.1, OpenAPI 3.1, Insomnia, Bruno, Hoppscotch, Thunder Client, `.http`.
- Variables + per-tool environment templates; redaction pass for secrets.
- Per-exporter conformance (schema validation; **Newman** import smoke for
  Postman). Pin per-tool format versions.
- **Done when:** golden IR → schema-valid output for all 7; Newman imports the
  Postman collection with zero manual fixes.

## Phase 6 — CLI
**Goal:** the primary surface (spec §10).
- commander CLI: `generate <path> --out --tools --depth [--build] [--strict]`,
  `list-endpoints`, `inspect <endpoint>`.
- `analyzer-runner`: locate/fetch the per-OS analyzer binary (or `dotnet tool`);
  degrade to existing-OpenAPI ingestion when absent.
- **Done when:** e2e on a fixture repo emits all collections + env templates;
  `--strict` fails on diagnostics.

## Phase 7 — MCP server
**Goal:** programmatic agent access (spec §10).
- stdio server exposing `list_endpoints`, `generate_collection`,
  `explain_variants`, `inspect`; writes only to the caller's out dir; no
  destructive ops.
- **Done when:** MCP tool tests pass; MCP output is byte-identical to CLI for
  the same input.

## Phase 8 — Agent Skill + Claude plugin/marketplace
**Goal:** AI-tool consumption (spec §10).
- `skills/reqweave/SKILL.md` (progressive disclosure) + `workflows/*.md`
  (discover, generate, choose-depth, secure-auth, per-tool import guides) +
  `scripts/` shelling to the CLI. `.claude-plugin/plugin.json` +
  `marketplace.json`. Packaging script.
- **Done when:** skill packages within depth limits; plugin manifest validates;
  skill drives the CLI to produce identical collections.

## Phase 9 — Integration, docs, release
**Goal:** ship.
- `integration` workflow: real ASP.NET fixture → generate → import (Newman) end
  to end. README quickstart + demo; `CHANGELOG`. `publish`/`release` wiring for
  npm + per-OS analyzer binaries (checksummed); SECURITY review.
- **Done when:** full CI + integration green; dry-run release produces the npm
  package and analyzer artifacts.

## Cross-cutting (every phase)
- Determinism (injected timestamps, seeded ordering); no-network + no-dep
  guards; security (no exec by default, no secret leakage); SHA-pinned actions;
  conventional commits; **no `Co-Authored-By: Claude` trailers**; commits
  inherit global git identity; PRs via the ruleset (squash, counting approval).

## Risks carried from spec §15
- Static schema fidelity for complex types (mitigate: build-mode reconcile).
- Per-tool format drift (mitigate: pinned versions + conformance tests).
- Analyzer binary distribution (finalize in P6: on-demand fetch vs `dotnet tool`).
- "exhaustive" honesty (document caps explicitly; never silently truncate).

## Suggested first step
Begin **Phase 0** (scaffold + CI + ruleset) so all subsequent work lands behind
a green gate, then **Phase 1** (IR contract) as the keystone.
