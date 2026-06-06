# reqweave — Design Spec

- **Date:** 2026-06-06
- **Status:** Approved (design); pending spec review → implementation plan
- **Owner:** aks-builds
- **Working name:** `reqweave` (verified clear: npm, GitHub, domains, brand)

## 1. Summary

`reqweave` reads a service codebase and generates ready-to-import API test
collections for **every** major API client — covering not one request per
endpoint, but a curated-yet-thorough set of request **variants** per endpoint
(happy path, optional combinations, boundary/invalid values, per-response).
It removes the manual labor of hand-building API collections and keeps them in
lockstep with the source.

One source in → importable collections for every tool out.

## 2. Problem & goals

Developers waste hours hand-authoring API requests in Postman/Insomnia/etc.,
the collections drift from the code, and each tool needs its own format.

**Goals (M1):**
- Read ASP.NET Core REST APIs (controllers + minimal APIs) and produce a
  faithful, tool-agnostic model of every endpoint.
- Generate thorough request variants per endpoint, bounded so collections stay
  importable and usable.
- Emit native files for Postman v2.1, OpenAPI 3.1, Insomnia, Bruno, Hoppscotch,
  Thunder Client, and `.http`.
- Ship as a CLI/npm package, an Agent Skill, a Claude plugin (marketplace), and
  an MCP server.
- Be secure (no secret leakage, no network/telemetry, no code execution by
  default), robust (partial-failure tolerant), and deterministic.

**Non-goals (M1):** running the target service; live traffic capture; gRPC and
non-.NET languages (M3); IDE extensions (M2); contract/breaking-change diffing
(later); publishing public docs (later).

## 3. Users & primary use case

A .NET developer points `reqweave` at a repo or project and gets a folder of
importable collections plus per-tool environment templates. They import into
their tool of choice and start exercising the API immediately. Also consumable
by AI agents via the Skill/MCP ("generate a Postman collection for this
service").

## 4. Scope & milestones

- **M1 (this spec):** engine + .NET REST ingestion + variant engine + all 7
  exporters + CLI/npm + Agent Skill + Claude plugin/marketplace + MCP server +
  full repo scaffold/CI/rulesets/docs.
- **M2:** IDE extensions (VS Code first, then JetBrains) — thin clients over the
  engine; strictly downstream of a stable engine.
- **M3+:** additional source analyzers, each emitting the same IR — gRPC
  (`.proto`/service defs), Java/Spring, Node/Express, Python/FastAPI, Go.

M1 is large; the implementation plan will sub-phase it (engine core →
exporters → surfaces → scaffold), but all of M1 is in scope for the first ship.

## 5. Architecture

Two components bridged by a versioned **Universal IR**. The IR is the contract
that keeps the .NET-specific analysis isolated from everything downstream and
makes future language analyzers drop-in.

```
codebase ──► reqweave-analyzer (.NET / Roslyn) ──► Universal IR (JSON, versioned)
                                                        │  [validate: zod]
                                                        ▼
                                                variant engine (TS, pure)
                                                        │  per-endpoint variant sets
                                                        ▼
                                            exporter plugins (fan-out, TS)
        ┌──────────┬──────────┬──────────┬──────────┼──────────┬──────────┬────────┐
     postman    openapi    insomnia    bruno    hoppscotch  thunder    .http   + env templates
```

### 5.1 Components

- **`reqweave-analyzer` (.NET):** the only .NET component. Roslyn-based; emits
  IR JSON only. Shipped as a per-OS self-contained single-file binary fetched
  on demand by the CLI (or installable as a `dotnet tool`). Swappable per
  language in future milestones.
- **`reqweave` core (TypeScript/Node):** IR loader/validator, variant engine,
  exporter plugins, CLI, MCP server, and the Skill's executable scripts — all
  over one library. Where the npm/MCP/skill/marketplace ecosystem lives.

### 5.2 Module boundaries (each independently testable)

| Unit | Input → Output | Notes |
|---|---|---|
| `analyzer` (.NET) | repo/project path → IR JSON | partial-failure tolerant; swappable per language |
| `ir-schema` (shared, versioned) | — | the contract; zod + JSON-Schema |
| `variant-engine` (TS) | IR → variant sets | pure functions, deterministic |
| `exporters/<tool>` (TS) | IR + variants → files | one isolated module per tool |
| `surfaces`: `cli` / `mcp` / `skill` | → core lib | thin adapters, no business logic |

## 6. Universal IR (keystone)

Versioned JSON (`irVersion`). One document per service. Key shape:

- `service`: name, base path(s), detected API version(s), servers.
- `endpoints[]`: stable `id`, `method`, `routeTemplate`, `operationId`,
  `summary`, `tags`, `deprecated`.
  - `params[]`: `name`, `in` (`route|query|header|cookie`), `required`,
    `schema` (JSON-Schema subset), `constraints` (from validation attrs),
    `enumValues`, `example`.
  - `requestBody`: `contentType`, `schema` (resolved DTO → JSON-Schema, incl.
    generics/inheritance/nullability/polymorphism markers), `required`,
    `examples`.
  - `responses[]`: `status`, `contentType`, `schema`, `description`.
  - `auth`: scheme(s) (`bearer|apiKey|basic|oauth2|none`), location, scopes,
    whether required.
- `diagnostics[]`: per-endpoint warnings (`unresolvedType`, `ambiguousRoute`,
  `assumedConvention`) — analysis degrades, never crashes.
- `meta`: analyzer version, mode (`static|build`), source commit (if a repo),
  generation timestamp (injected, not derived, for determinism).

Resolution gaps emit `unresolved` markers + diagnostics rather than failing.

## 7. .NET ingestion (hybrid)

- **Static mode (default):** Roslyn `MSBuildWorkspace` when the SDK is present
  (best-effort semantic model without a full build), falling back to a
  syntax-only pass when no SDK is available. Extracts: attribute-routed
  controllers and `app.MapGet/Post/...` minimal APIs; route templates +
  prefixes + `[ApiVersion]`; verbs; `[From*]` parameter binding; DTO types →
  JSON-Schema (resolving generics, inheritance, `required`/nullable, enums);
  validation attributes (`[Required]`, `[Range]`, `[StringLength]`,
  `[MinLength]`/`[MaxLength]`, `[RegularExpression]`, `[EmailAddress]`, etc.);
  `[ProducesResponseType]`/return types → responses; `[Authorize]`/
  `[AllowAnonymous]` + configured schemes.
- **Build mode (opt-in, `--build`):** when the SDK + a buildable project are
  present, use ASP.NET `ApiExplorer` / generated OpenAPI for ground truth and
  reconcile with the static pass (build wins on conflict; differences recorded
  as diagnostics).
- **Degradation:** no SDK → syntax-only with explicit diagnostics; analyzer
  binary absent → CLI guides install or accepts an existing OpenAPI doc as the
  IR source.

## 8. Variant generation engine (differentiator)

Pure, deterministic functions over IR endpoints. Per endpoint it derives a
bounded-but-thorough set:

- **Presence variants:** required-only; all-optional-populated; each optional
  param toggled once.
- **Value classes (equivalence partitioning):** valid representative; invalid
  per constraint; **boundary values** from `[Range]`/length/regex; nullable
  null vs absent; each `enum` member; type-mismatch (where the tool can express
  it).
- **Auth variants:** authorized (with `{{token}}` placeholder) and, where an
  endpoint requires auth, an unauthorized variant (expects 401).
- **Response coverage:** one representative request per declared response
  status, named accordingly.
- **Combinatorial control:** **pairwise (covering array)** across parameters to
  cover interactions without explosion.
- **Depth knob:** `--depth minimal|standard|exhaustive`
  (~3-5 / ~5-20 / capped-exhaustive requests per endpoint). `exhaustive` is
  still capped with a logged note (no silent truncation).
- **Determinism:** seeded, stable ordering and value selection → identical
  output across runs (stable diffs), matching the cliproof determinism ethos.

Each variant carries: name, the param/body values, expected status (where
known), and provenance (which rule produced it) for explainability.

## 9. Exporters

A pluggable layer; each exporter implements
`export(ir, variants, options) → files[]` and is independently tested.

- **M1 set:** Postman Collection v2.1, OpenAPI 3.1, Insomnia (v4 export), Bruno
  (`.bru` files), Hoppscotch collection JSON, Thunder Client collection JSON,
  `.http` (REST Client / JetBrains http).
- **Conformance:** each output validated against the tool's published schema
  where one exists (Postman v2.1 JSON Schema, OpenAPI 3.1 schema, etc.); Postman
  output additionally smoke-run through **Newman** to prove importability.
- **Secrets/auth/env handling:** generated requests never embed secrets. Base
  URLs and tokens become variables (`{{baseUrl}}`, `{{bearerToken}}`); each
  exporter emits a matching environment template with empty secret slots. A
  redaction pass scrubs secret-looking values from any source-derived examples.

## 10. Distribution surfaces

- **CLI / npm:** `npx reqweave generate <path> --out <dir> --tools all
  --depth standard [--build] [--strict]`; plus `reqweave list-endpoints`,
  `reqweave inspect <endpoint>`. Thin over the core library.
- **Agent Skill:** `skills/reqweave/SKILL.md` (progressive disclosure) +
  `workflows/*.md` (discover, generate, choose-depth, secure-auth, per-tool
  import guides) + `scripts/` that shell to the CLI.
- **Claude plugin / marketplace:** `.claude-plugin/plugin.json` +
  `marketplace.json` (cliproof proves the pattern).
- **MCP server:** stdio server exposing read-only/codebase-safe tools
  (`list_endpoints`, `generate_collection`, `explain_variants`, `inspect`),
  writing only to the chosen output directory. Thin over the core library.

## 11. Security & robustness

- **No code execution by default** (static read only). Build mode is opt-in and
  limited to `dotnet build`/codegen. **No network and no telemetry** — the
  codebase stays local.
- **No secret leakage:** variables + per-tool env templates + redaction pass.
- **Partial-failure tolerant:** unresolved types/routes → diagnostics + IR
  markers, never a crash; one failing exporter never sinks the others;
  `--strict` promotes warnings to failures for CI use.
- **Supply chain:** SHA-pinned GitHub Actions, CodeQL, Dependabot, `SECURITY.md`,
  pinned/locked dependencies.
- **MCP safety:** no destructive operations; reads source, writes only to the
  output directory the caller specifies.

## 12. Testing strategy

- **Analyzer (.NET):** xUnit over fixture projects (attribute-routed
  controllers, minimal APIs, generics, inheritance, polymorphism, auth, API
  versioning, edge/broken cases) → assert IR.
- **Core (TS):** variant-engine unit tests (each depth, boundary derivation,
  pairwise coverage), **per-exporter conformance** (schema validation + Newman
  round-trip for Postman), CLI e2e, MCP tool tests.
- **Cross-cutting:** determinism test (byte-stable output across runs);
  no-network and no-dependency guards (cliproof-style); golden fixtures (a
  sample ASP.NET API → expected collections).

## 13. Repo scaffold & quality bar (cliproof parity)

Mirror cliproof's structure and apply every lesson learned there:

- `.github/`: 7 workflows — `ci` (matrix: Node + .NET), `codeql`, `freshness`,
  `integration` (real generate → import), `publish`, `release`, `auto-approve`
  (caller with `permissions: pull-requests: write`); plus `CODEOWNERS`,
  `dependabot.yml`, ISSUE/PR templates, media.
- `analyzer/` (.NET solution), `src/` (TS core), `bin/cli.js`, `skills/reqweave/`,
  `.claude-plugin/`, dual test suites, full docs (`README`, `CHANGELOG`,
  `CONTRIBUTING`, `SECURITY`, `CODE_OF_CONDUCT`, `LICENSE`),
  `.editorconfig`/`.gitattributes`/`.gitignore`/`.npmignore`.
- **Branch ruleset** on `main`: required status check is a **stable aggregate
  `test` gate** (not a matrix job name); 1 approving review; squash-only; linear
  history. Auto-approve caller grants `pull-requests: write`; the approver
  account has **write** access so its approval counts; **no `Co-Authored-By:
  Claude` trailers**, commits inherit the global git identity.

## 14. Success criteria (M1)

- Point `reqweave` at a real ASP.NET Core service → import the generated Postman
  collection via Newman with zero manual fixes and exercise endpoints.
- All 7 exporters produce schema-valid output for the golden fixture.
- Variant counts respect `--depth`; output is byte-stable across runs.
- Skill, MCP, CLI, and plugin all drive the same core and produce identical
  collections for the same input.
- CI/rulesets green end-to-end; auto-approve posts a counting approval.

## 15. Risks & open questions

- **Static schema fidelity** for complex generics/inheritance/polymorphism is
  the chief technical risk; mitigated by build-mode reconciliation + diagnostics.
- **Per-tool format drift** (Insomnia/Bruno/Hoppscotch/Thunder evolve); mitigate
  with pinned format versions + conformance tests + clear "format version" notes.
- **Analyzer binary distribution** (size, per-OS builds, on-demand fetch vs.
  `dotnet tool`) — to be finalized in the plan.
- **Pairwise vs. perceived completeness** — document exactly what `exhaustive`
  covers and caps, so "every possible usage" is honest, not misleading.
