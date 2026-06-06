---
name: reqweave
description: Generate ready-to-import API test collections for every API client (Postman, OpenAPI 3.1, Insomnia, Bruno, Hoppscotch, Thunder Client, .http) directly from a service codebase, with exhaustive request variants per endpoint (happy path, boundaries, invalid input, per-status, auth). Use when the user wants to create or import API requests, build a Postman collection, generate an OpenAPI spec from code, exercise/test all endpoints of a service, or turn ASP.NET Core (.NET) controllers into importable API collections without hand-building requests.
---

# reqweave — code in, importable API collections out

Point reqweave at a service codebase; it reads the endpoints and emits native,
ready-to-import collections for every major API client — covering not one
request per endpoint but a **bounded-but-thorough set of variants** (required-
only, all-optional, boundary/invalid values, one per response status, and
unauthorized). No hand-building requests; no drift from the code.

## When to use
- "Make a Postman collection for this API / service."
- "Generate an OpenAPI spec from these controllers."
- "I want to test/exercise all the endpoints" (Insomnia, Bruno, Hoppscotch, Thunder Client, `.http`).
- Turn an ASP.NET Core (.NET), Node/TypeScript (NestJS/Express), Python (FastAPI/Flask), or Java (Spring Boot) REST codebase into importable API requests.

## Core principles (do not violate)
1. **Never fabricate endpoints or values.** reqweave reads the real source; if a type can't be resolved it emits a diagnostic, not a guess.
2. **Never commit secrets.** Generated requests use `{{placeholders}}`; secrets live in per-tool environment templates with blank values. Tell the user to fill them locally and keep them out of git.
3. **Stay local.** reqweave does no network calls and no telemetry; static analysis runs by default (no code execution).
4. **Deterministic output.** Re-running on unchanged source produces identical files (clean diffs).

## Quickstart
```bash
# all tools, standard depth, into ./reqweave-out
npx reqweave generate ./path/to/service --out ./reqweave-out --tools all --depth standard
```
Then import the generated files (see `workflows/importing.md`).

## Requirements
- Node.js ≥ 20 (the CLI).
- For .NET source: the .NET SDK (static analysis). No SDK? Point reqweave at an existing OpenAPI/IR via `--ir <file>`.

## Workflows (read the one you need)
- [`workflows/generate.md`](workflows/generate.md) — the main generate flow, flags, and outputs.
- [`workflows/choosing-depth.md`](workflows/choosing-depth.md) — pick `minimal` | `standard` | `exhaustive`.
- [`workflows/secure-auth.md`](workflows/secure-auth.md) — auth placeholders, env templates, keeping secrets safe.
- [`workflows/importing.md`](workflows/importing.md) — per-tool import steps.
- [`workflows/inspect.md`](workflows/inspect.md) — list endpoints and explain the variants before generating.

## Tools produced
Postman v2.1, OpenAPI 3.1, Insomnia v4, Bruno, Hoppscotch, Thunder Client, `.http` (REST Client / JetBrains) — each with a matching environment template.
