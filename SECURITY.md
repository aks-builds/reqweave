# Security Policy

## Reporting a vulnerability

Please report security issues privately via GitHub's
[private vulnerability reporting](https://github.com/aks-builds/reqweave/security/advisories/new)
rather than opening a public issue. We aim to acknowledge reports within a few
business days.

## Security model

reqweave is designed to be safe to point at untrusted-but-local source:

- **No code execution by default.** The analyzer performs static analysis only.
  Build-mode (`--build`) is opt-in and limited to `dotnet build`/codegen.
- **No network access and no telemetry.** The codebase never leaves the machine.
- **No secret leakage.** Generated collections use variables and per-tool
  environment templates with empty slots; a redaction pass scrubs secret-looking
  values from any source-derived examples.
- **Least-privilege MCP.** The MCP server performs no destructive operations; it
  reads source and writes only to the output directory the caller specifies.

## Supply chain

- GitHub Actions are version-pinned; Dependabot tracks Actions, npm, and NuGet updates.
- CodeQL runs on every push/PR and weekly.
- Dependencies are pinned via lockfiles.
