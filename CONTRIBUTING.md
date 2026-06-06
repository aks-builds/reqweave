# Contributing to reqweave

Thanks for your interest! reqweave is in early, phased development — please read
the [design spec](docs/superpowers/specs/2026-06-06-reqweave-design.md) and
[implementation plan](docs/superpowers/plans/2026-06-06-reqweave-implementation-plan.md)
first so changes land in the right phase.

## Development setup

Prerequisites: Node.js ≥ 20, .NET SDK 10.

```bash
npm install
npm run build
npm test

dotnet test analyzer/test/Reqweave.Analyzer.Tests
```

## Ground rules

- **Determinism:** generators must produce byte-stable output across runs (no
  wall-clock or random values baked into output; inject timestamps/seeds).
- **No network, no code execution by default:** the analyzer reads source;
  build-mode is opt-in. Never add telemetry.
- **No secret leakage:** never emit secrets — use variables + environment
  templates, and keep the redaction pass intact.
- **Tests required:** TS via `vitest`, .NET via `xUnit`. Exporters need
  per-tool conformance tests; the IR contract is the source of truth.

## Pull requests

1. Branch off `main`.
2. Keep PRs focused; update `CHANGELOG.md` under `[Unreleased]`.
3. Conventional commit messages (e.g. `feat(exporters): add Bruno exporter`).
4. CI must be green (the required `test` check) and the PR approved before merge.
   Merges are **squash** with linear history.

## Code of Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
