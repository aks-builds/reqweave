# Workflow: choosing variant depth

`--depth` controls how many request variants reqweave generates per endpoint.
All tiers are capped so collections stay importable, not bloated (capping is
reported in the run notes — never silent).

| Depth | Per endpoint | Use when |
|---|---|---|
| `minimal` | 1 — happy path (required params, valid values) | A quick smoke collection; you just want one working request each. |
| `standard` (default) | ~5–20 — happy path, all-optional, **unauthorized (401)** for `[Authorize]`, one per declared error status (400/403/404), and min/max **boundaries** | Most cases. Good coverage without noise. |
| `exhaustive` | capped (≤64) — adds **pairwise** over optional-param presence and one variant per **enum** member | You want to probe interactions and edge cases thoroughly. |

Guidance:
- Default to **standard**. Move to **exhaustive** only when the user explicitly wants thorough edge-case coverage, and warn that collections get larger.
- "exhaustive" is still **capped** — reqweave reports when it caps an endpoint; it never silently truncates.
- Variant names carry **provenance** (e.g. `unauthorized`, `boundary-max`, `invalid-input`) so the user can see why each request exists. Use `reqweave inspect` (see inspect.md) to preview them.
