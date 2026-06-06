/**
 * In-process, pattern-based Python analyzer. Detects FastAPI + Flask endpoints
 * from source (no parser dependency, no code execution) and emits the IR.
 */
import { basename, resolve } from "node:path";
import { validateIr, type Ir, type Endpoint, type Diagnostic } from "../../ir/index.js";
import { collectPythonFiles } from "./util.js";
import { buildLogicalLines, type LogicalLine } from "./lines.js";
import { buildModelIndex } from "./types.js";
import { extractFastApi } from "./fastapi.js";
import { extractFlask } from "./flask.js";

export const PY_ANALYZER_VERSION = "py-analyzer/0.1.0";

export interface AnalyzePyOptions {
  service?: string;
  generatedAt?: string;
}

export function analyzePython(sourcePath: string, opts: AnalyzePyOptions = {}): Ir {
  const files = collectPythonFiles(sourcePath);
  const filesLines: LogicalLine[][] = files.map((f) => buildLogicalLines(f.text));
  const diagnostics: Diagnostic[] = [];

  const index = buildModelIndex(filesLines);
  const merged = dedupe([
    ...extractFastApi(filesLines, index, diagnostics),
    ...extractFlask(filesLines, index, diagnostics),
  ]);

  if (merged.length === 0) {
    diagnostics.push({
      code: "unsupportedFeature",
      message: "no FastAPI or Flask routes found; is this a FastAPI/Flask project? (use --lang to force, or --openapi)",
      severity: "warning",
    });
  }

  const ir: Ir = {
    irVersion: "0.1.0",
    service: { name: opts.service ?? basename(resolve(sourcePath)) ?? "service", basePaths: [] },
    endpoints: merged,
    diagnostics,
    meta: { analyzerVersion: PY_ANALYZER_VERSION, mode: "static", generatedAt: opts.generatedAt ?? "1970-01-01T00:00:00Z" },
  };

  const r = validateIr(ir);
  if (!r.success) {
    throw new Error(`Python analyzer produced invalid IR:\n${JSON.stringify(r.error.issues, null, 2)}`);
  }
  return r.data;
}

/** Dedup by `METHOD route` (FastAPI wins over Flask), unique ids, stable order. */
function dedupe(endpoints: Endpoint[]): Endpoint[] {
  const byKey = new Map<string, Endpoint>();
  for (const e of endpoints) {
    const key = `${e.method} ${e.routeTemplate}`;
    if (!byKey.has(key)) byKey.set(key, e);
  }
  const list = [...byKey.values()].sort((a, b) => cmp(a.routeTemplate, b.routeTemplate) || cmp(a.method, b.method));
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
