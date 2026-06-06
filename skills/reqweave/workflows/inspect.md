# Workflow: inspect before generating

Preview what reqweave found and what it would generate — useful to sanity-check
routing/auth/schemas before producing files.

## List endpoints
```bash
reqweave list-endpoints <path>
```
Prints `METHOD route (id)` for every discovered endpoint, plus a diagnostic count.

## Explain one endpoint's variants
```bash
reqweave inspect <path> <endpointId> [--depth standard|minimal|exhaustive]
```
Prints each variant with its expected status and **provenance** tags, e.g.:
```
GET /api/Pets/{id}  (Pets.GetById)
  - happy path              [200]  {required-only}
  - all optional populated  [200]  {all-optional}
  - unauthorized            [401]  {unauthorized}
  - not found               [404]  {not-found}
  - id = minimum            [200]  {boundary-min}
```

## Tips
- If endpoints are missing or schemas look thin, try `--build` (build-mode, needs the .NET SDK) for ground-truth fidelity.
- Diagnostics (`unresolvedType`, `assumedConvention`, …) explain anything reqweave had to approximate. Use `--strict` on `generate` to fail when any are present.
- No .NET SDK available? Generate from an existing OpenAPI/IR with `--ir <file>`.
