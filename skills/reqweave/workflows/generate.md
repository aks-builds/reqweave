# Workflow: generate collections

The main flow. Turns a service codebase into importable collections.

```bash
reqweave generate <path> [options]
```

## Options
| Flag | Default | Meaning |
|---|---|---|
| `--out DIR` | `reqweave-out` | Output directory. |
| `--tools all\|a,b` | `all` | Subset, e.g. `postman,openapi`. |
| `--depth LEVEL` | `standard` | `minimal` \| `standard` \| `exhaustive` (see choosing-depth). |
| `--base-url URL` | `http://localhost:5000` | Default value written into env templates. |
| `--service NAME` | derived from path | Service/collection name. |
| `--build` | off | Build-mode analysis for higher fidelity (needs the .NET SDK + a buildable project). |
| `--strict` | off | Fail the run if the analyzer emits any diagnostics. |
| `--ir FILE` | — | Skip the analyzer and use an existing IR JSON (or an OpenAPI you've converted). |

## Steps
1. **Confirm the target.** Ask which service path and which tools the user actually uses (default to `all` if unsure — it's cheap).
2. **Run `generate`.** Prefer `--depth standard`. Use `--out` inside the repo (e.g. `./reqweave-out`) or a scratch dir.
3. **Report the summary.** reqweave prints `N endpoints -> M variants -> K files`. Surface any diagnostics; suggest `--build` if schemas look thin.
4. **Hand off to import.** Point the user at `workflows/importing.md` for their tool, and at `workflows/secure-auth.md` to fill secrets.

## Output layout
```
<out>/
  postman/<service>.postman_collection.json  + .postman_environment.json
  openapi/<service>.openapi.json
  insomnia/<service>.insomnia.json
  bruno/bruno.json + *.bru + environments/Local.bru
  hoppscotch/<service>.hoppscotch-collection.json + -environment.json
  thunder-client/<service>.thunder-collection.json + -environment.json
  http/<service>.http + http-client.env.json
```

Output is deterministic — safe to commit and diff. Add `<out>/` to `.gitignore` if you don't want it tracked.
