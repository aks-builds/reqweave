# reqweave Bundle B — Fidelity

- **Date:** 2026-06-06
- **Status:** Approved (design); implementing B3 → B1 → B2.
- **Roadmap:** A (shipped) → **B** → C (breadth) → D (lifecycle).

Bundle B raises analysis fidelity and removes the .NET-SDK requirement for npm
users. Three phased PRs, each green before the next.

## B3 — richer auth-scheme detection (first; analyzer-only)
Replace the blanket "any `[Authorize]` → bearer" assumption.
- New `AuthSchemeDetector` scans the source once for auth wiring:
  `AddJwtBearer` → bearer, `AddOAuth`/`AddOpenIdConnect` → oauth2,
  `Add*ApiKey*` → apiKey, `AddBasic*` → basic, and `AddAuthentication("scheme")`
  defaults.
- `[Authorize(AuthenticationSchemes="…")]` on method/class maps named schemes
  (Bearer/ApiKey/Basic/OAuth/OIDC) explicitly.
- Endpoints carry the detected scheme(s) (supports multiple). The
  `assumedConvention` diagnostic is emitted **only** when nothing is detected and
  we fall back to bearer.
- Used by both controller and minimal-API analyzers. xUnit fixtures.

## B1 — build-mode (`--build`) via OpenAPI-emit + importer
- **OpenAPI→IR importer** — new `src/ir/openapi-import.ts` (TypeScript, reusable):
  OpenAPI 3.x document → Universal IR (paths→endpoints, params, requestBody,
  responses, `securitySchemes`→auth). Exposed as **`--openapi <file>`** so reqweave
  can ingest *any* OpenAPI (a cheap breadth win), independent of build-mode.
- **Generation** — `analyzer-runner`, when `--build`, runs the project's own
  OpenAPI generator best-effort, in order: Swashbuckle (`dotnet swagger tofile`)
  → .NET built-in OpenAPI document → NSwag. Gated, opt-in code execution.
- **Reconciliation** — always run the static analyzer; when a build IR is
  available, reconcile: build/OpenAPI wins on conflicts, divergences recorded as
  `diagnostics`. Degrade to static (with a diagnostic) when no generator/SDK.
- Architecture: TypeScript owns OpenAPI→IR + reconciliation (testable without
  .NET); the .NET-specific generation stays in `analyzer-runner`.

## B2 — prebuilt per-OS analyzer binaries (esbuild-style)
- Release CI cross-builds self-contained single-file binaries
  (`dotnet publish -r <rid> -p:PublishSingleFile=true --self-contained`) for
  win-x64, linux-x64, linux-arm64, osx-x64, osx-arm64.
- Published as `@reqweave/analyzer-<platform>` packages, declared as
  `optionalDependencies`; `analyzer-runner` resolves the matching one via
  `require.resolve` at the **top** of its resolution order, then invokes it.
  Zero runtime network, offline, npm-integrity-verified.
- **Implementation + tests land green without publishing.** The actual npm
  publish of the platform packages is an outward action, done only on explicit
  approval.

## Resolution order (after B2)
`--ir` / `--openapi` → optional-package binary → `$REQWEAVE_ANALYZER` → dev
`dotnet run` → actionable error.

## Cross-cutting
- Determinism preserved; analysis stays no-network (binaries arrive at npm
  install time, not runtime); build-mode is the only (opt-in) code execution.
- Graceful degradation throughout (build→static, missing binary→`dotnet`/`--ir`).
- Security: self-contained binaries built in our release CI; npm integrity; no
  postinstall scripts.
- Testing: OpenAPI-importer + reconciliation + auth-detection unit tests;
  build-mode integration check on a Swashbuckle fixture; binary-resolution tests.

## Out of scope (later bundles)
C (new source languages), D (contract-diff + mock servers), E (IDE extensions).
