/**
 * In-process, pattern-based Java analyzer (Spring Boot). No parser/JVM; no code
 * execution. Brace-aware scanning over comment-stripped source → Universal IR.
 */
import { basename, resolve } from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateIr, type Ir, type Endpoint, type Diagnostic } from "../../ir/index.js";
import { stripComments } from "../clike/lex.js";
import { buildJavaIndex } from "./models.js";
import { extractSpring } from "./spring.js";

export const JAVA_ANALYZER_VERSION = "java-analyzer/0.1.0";

export interface AnalyzeJavaOptions {
  service?: string;
  generatedAt?: string;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "target", "build", "out", ".gradle", ".idea", "bin"]);

export function analyzeJava(sourcePath: string, opts: AnalyzeJavaOptions = {}): Ir {
  const files = collectJavaFiles(sourcePath);
  const cleans = files.map((f) => stripComments(f));
  const diagnostics: Diagnostic[] = [];
  const index = buildJavaIndex(cleans);

  const merged = dedupe(cleans.flatMap((c) => extractSpring(c, index, diagnostics)));
  if (merged.length === 0) {
    diagnostics.push({
      code: "unsupportedFeature",
      message: "no Spring @RestController/@RequestMapping endpoints found (use --lang to force, or --openapi)",
      severity: "warning",
    });
  }

  const ir: Ir = {
    irVersion: "0.1.0",
    service: { name: opts.service ?? basename(resolve(sourcePath)) ?? "service", basePaths: [] },
    endpoints: merged,
    diagnostics,
    meta: { analyzerVersion: JAVA_ANALYZER_VERSION, mode: "static", generatedAt: opts.generatedAt ?? "1970-01-01T00:00:00Z" },
  };

  const r = validateIr(ir);
  if (!r.success) throw new Error(`Java analyzer produced invalid IR:\n${JSON.stringify(r.error.issues, null, 2)}`);
  return r.data;
}

function collectJavaFiles(sourcePath: string, maxDepth = 14): string[] {
  const base = resolve(sourcePath);
  if (/\.java$/i.test(base)) {
    try {
      return [readFileSync(base, "utf8")];
    } catch {
      return [];
    }
  }
  const out: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const paths: string[] = [];
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name), depth + 1);
      } else if (/\.java$/i.test(e.name)) {
        paths.push(join(dir, e.name));
      }
    }
    paths.sort();
    for (const p of paths) {
      try {
        out.push(readFileSync(p, "utf8"));
      } catch {
        /* skip */
      }
    }
  };
  walk(base, 0);
  return out;
}

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
