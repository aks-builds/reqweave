/**
 * In-process TypeScript/Node analyzer. Detects Express + NestJS endpoints from
 * source (no compilation, no code execution) and emits the Universal IR.
 */
import { basename, dirname, join, resolve } from "node:path";
import { readFileSync, statSync } from "node:fs";
import { validateIr, type Ir, type Endpoint, type Diagnostic } from "../../ir/index.js";
import { SourceIndex } from "./source-index.js";
import { extractNestJs } from "./nestjs.js";
import { extractExpress } from "./express.js";

export const TS_ANALYZER_VERSION = "ts-analyzer/0.1.0";

export interface AnalyzeTsOptions {
  service?: string;
  generatedAt?: string;
}

export function analyzeTypeScript(sourcePath: string, opts: AnalyzeTsOptions = {}): Ir {
  const index = SourceIndex.fromPath(sourcePath);
  const diagnostics: Diagnostic[] = [];

  // NestJS first (higher fidelity), then Express; dedup by METHOD + route.
  const merged = dedupe([...extractNestJs(index, diagnostics), ...extractExpress(index, diagnostics)]);

  if (merged.length === 0) {
    diagnostics.push({
      code: "unsupportedFeature",
      message: "no Express or NestJS endpoints found; is this an Express/NestJS project? (use --lang to force, or --openapi)",
      severity: "warning",
    });
  }

  const ir: Ir = {
    irVersion: "0.1.0",
    service: {
      name: opts.service ?? detectServiceName(sourcePath) ?? "service",
      basePaths: [],
    },
    endpoints: merged,
    diagnostics,
    meta: {
      analyzerVersion: TS_ANALYZER_VERSION,
      mode: "static",
      generatedAt: opts.generatedAt ?? "1970-01-01T00:00:00Z",
    },
  };

  const r = validateIr(ir);
  if (!r.success) {
    throw new Error(`TypeScript analyzer produced invalid IR:\n${JSON.stringify(r.error.issues, null, 2)}`);
  }
  return r.data;
}

/** Dedup by `METHOD route` (keep first — NestJS wins over Express), unique ids. */
function dedupe(endpoints: Endpoint[]): Endpoint[] {
  const byKey = new Map<string, Endpoint>();
  for (const e of endpoints) {
    const key = `${e.method} ${e.routeTemplate}`;
    if (!byKey.has(key)) byKey.set(key, e);
  }
  const list = [...byKey.values()].sort(
    (a, b) => cmp(a.routeTemplate, b.routeTemplate) || cmp(a.method, b.method),
  );
  const seen = new Set<string>();
  return list.map((e) => {
    let id = e.id;
    let n = 1;
    while (seen.has(id)) id = `${e.id}-${++n}`;
    seen.add(id);
    return id === e.id ? e : { ...e, id };
  });
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function detectServiceName(sourcePath: string): string | undefined {
  let dir = resolve(sourcePath);
  try {
    if (statSync(dir).isFile()) dir = dirname(dir);
  } catch {
    return undefined;
  }
  // Walk up a few levels looking for package.json.
  for (let i = 0; i < 6; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string };
      if (pkg.name) return pkg.name.replace(/^@[^/]+\//, "");
    } catch {
      /* keep walking up */
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return basename(resolve(sourcePath));
}
