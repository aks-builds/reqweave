# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Universal IR** contract (zod schema + generated JSON-Schema with a drift guard).
- **.NET static analyzer** (Roslyn, no build): ASP.NET Core attribute-routed
  controllers **and minimal APIs** (`app.MapGet/Post/Put/Delete/Patch`) → IR —
  routes, param binding, DTO→JSON-Schema with validation attributes/enums/
  collections/**base-class inheritance**/**record positional params**, responses
  (incl. HTTP-convention status inference when undeclared — POST→201, DELETE→204),
  auth (incl. `RequireAuthorization`), diagnostics.
- **Variant engine**: depth tiers (`minimal`/`standard`/`exhaustive`), pairwise
  coverage, boundary/invalid/auth/per-status variants, request-body enum and
  numeric-boundary field expansion (exhaustive), deterministic, capped.
- **7 native exporters**: Postman v2.1, OpenAPI 3.1, Insomnia, Bruno, Hoppscotch,
  Thunder Client, `.http` — each with a secret-safe environment template.
- **CLI** (`reqweave generate|list-endpoints|inspect`) chaining analyzer → engine
  → exporters, with an analyzer-runner (`--ir`/`$REQWEAVE_ANALYZER`/dev `dotnet`).
- **MCP server** (`reqweave-mcp`, dependency-free stdio): `list_endpoints`,
  `generate_collection`, `explain_variants`.
- **Agent Skill** (`skills/reqweave/`) + **Claude marketplace plugin** (`.claude-plugin/`).
- **Project scaffold & CI**: stable aggregate `test` gate, CodeQL (security-extended),
  Dependabot, integration (real generate→import + determinism), auto-approve.

- **Project config + `reqweave init`** (Bundle A): optional `reqweave.config.json`
  (tools/depth/baseUrl/out/service/tests/build); precedence defaults < config < flags.
- **OpenAPI examples** (Bundle A): request + response examples embedded in the spec.
- **Runnable test assertions** in collections (Bundle A): each request asserts
  the variant's expected status, content-type, and — in Postman — the response
  JSON-Schema (graceful fallback elsewhere). On by default; `--no-tests` /
  `tests:false` opts out.

### Security
- Fixed prototype-pollution and ReDoS findings in the exporters (CodeQL).
