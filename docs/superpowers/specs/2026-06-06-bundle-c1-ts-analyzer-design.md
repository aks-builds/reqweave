# Bundle C1 — TypeScript/Node source analyzer (Express + NestJS)

## Goal
Add a second source language to reqweave: a native, in-process static analyzer for
**Node/TypeScript** backends (Express + NestJS) that emits the existing Universal IR
(`IR_VERSION = 0.1.0`) and flows straight into the unchanged variant engine + 7
exporters + CLI/MCP. Zero external runtime/SDK — runs inside the Node process.

## Why the TS compiler API (not tree-sitter for C1)
- It is the language's canonical parser: accurate decorators, types, generics.
- Fully **synchronous** — no async-init ripple through the sync `analyze()` / CLI
  `run()` / MCP handlers.
- Lazy-loaded (`createRequire(__filename)("typescript")` inside the analyzer) so
  .NET / IR / OpenAPI runs never pay for it.
- tree-sitter (WASM) remains the plan for Python/Java/Go (C2–C4), where there is no
  native synchronous parser available in-process.

## Architecture (mirrors the .NET analyzer's units, in TS)
`src/analyzers/ts/`
- **source-index.ts** — parse all project `.ts`/`.tsx` files syntactically
  (`ts.createSourceFile`, no Program/type-checker), skipping `node_modules`,
  `dist`, build dirs. Index exported `interface` / `class` / `type` alias / `enum`
  declarations by name for cross-file DTO resolution (like `SourceIndex.cs`).
- **schema-mapper.ts** — TS type node → `JsonSchemaNode` (mirror `SchemaMapper.cs`):
  primitives (`string`/`number`→number, integer not distinguishable in TS so
  `number`; `boolean`), `T[]`/`Array<T>` → array, `Record<K,V>` →
  object+additionalProperties, union with `undefined`/optional `?` → `nullable`,
  string-literal unions → `enum`, `Date` → `{string, format:date-time}`, named
  types resolved via the index (cycle guard `MAX_DEPTH = 64`). Unknown → `{}` with
  an `unresolvedType` diagnostic.
- **nestjs.ts** — high-fidelity decorator extraction: classes decorated
  `@Controller('base')`; methods decorated `@Get/@Post/@Put/@Patch/@Delete(path?)`;
  params `@Param('id')` → route, `@Query('q')` → query, `@Headers('h')` → header,
  `@Body() dto: T` → request body (schema from `T` via the index); response status
  from `@HttpCode(n)` else method default (POST→201 else 200); response schema from
  the method return type (unwrap `Promise<T>`); auth from `@UseGuards(AuthGuard(...))`
  / `@ApiBearerAuth()` (bearer) — fallback assumed-bearer diagnostic.
- **express.ts** — imperative detection: `app.<method>(path, ...handlers)` and
  `router.<method>(...)` (incl. `express.Router()` instances and a base mount path
  when resolvable). Path params `:id` → `{id}`. Body/query are best-effort from
  handler usage (`req.body`, `req.query.x`, `req.params.x`); ambiguity →
  `assumedConvention` / `ambiguousRoute` diagnostics. Lower fidelity than NestJS by
  nature; never throws — emits diagnostics.
- **index.ts** — `analyzeTypeScript(sourcePath, opts): Ir`. Detect framework(s) by
  imports/decorators, run the matching extractor(s), merge endpoints (dedup by
  `METHOD routeTemplate`, unique ids via the existing `-2/-3` scheme), assemble IR
  (`meta.analyzerVersion = "ts-analyzer"`, `mode = "static"`,
  `generatedAt` from opts), and `validateIr` before returning.

## Route/id conventions (match existing)
- `routeTemplate`: leading `/`, `{param}` curly form; `:id`/`{id:int}` normalized.
- endpoint `id`: NestJS `Controller.method`; Express `method_slug(route)` (same slug
  rule as `openapi-import.ts`). Collisions deduped with `-2/-3`.

## Integration
- `AnalyzeOptions.language?: "auto" | "dotnet" | "ts"` (default `auto`).
- `analyze()` dispatch (after `irFile`/`openapiFile` short-circuits):
  - explicit `--lang ts` → `analyzeTypeScript`; `--lang dotnet` → .NET path.
  - `auto`: `.csproj`/`.sln` present → .NET; else `package.json`/`tsconfig.json` or
    any `.ts` files → TS; else fall through to the .NET resolver's error guidance.
  - Build-mode reconciliation (B1b) still applies on top of whichever static IR.
- CLI: `--lang <auto|dotnet|ts>` value flag; usage updated.
- MCP: `lang` added to `sourceProps`.

## Security / ethos (unchanged)
- **No code execution** — purely syntactic parse; never imports/runs target code.
- **No network**, deterministic output, bounded recursion (`MAX_DEPTH`), bounded
  file walk (skip heavy dirs). Never throws on weird source — degrades with
  diagnostics.

## Testing (Node matrix, no external toolchain — `typescript` is plain JS)
- Fixtures: `tests/fixtures/ts/nestjs/` (a `@Controller` + DTO + enum) and
  `tests/fixtures/ts/express/` (an app with `app.get`/`router.post`, `:id`).
- `tests/ts-analyzer.test.ts`: run `analyzeTypeScript` on both fixtures; assert
  endpoints, params (route/query), request body schema (resolved DTO), responses,
  auth, `validateIr` success, determinism (stable order).
- `tests/cli.e2e.test.ts`: `generate <nestjs-fixture> --lang ts` → collections
  written, exit 0 (fully in-process, no .NET).

## Out of scope (later)
- Express path-prefix inference across deep `app.use(router)` chains (best-effort
  only now). Full type-checker-based resolution (Program). C2–C4 languages.
