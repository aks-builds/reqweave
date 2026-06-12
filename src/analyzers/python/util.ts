/**
 * Shared helpers for the pattern-based Python analyzer (no parser dependency).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".venv", "venv", "env", "__pycache__", ".mypy_cache", ".pytest_cache",
  ".tox", ".eggs", "site-packages", "build", "dist", ".idea", ".vscode",
]);
const PY_EXT = /\.py$/i;

export interface SourceFile {
  path: string;
  text: string;
}

/** Collect project Python files (bounded walk; skips venvs/caches/build dirs). */
export function collectPythonFiles(sourcePath: string, maxDepth = 12): SourceFile[] {
  const base = resolve(sourcePath);
  if (PY_EXT.test(base)) {
    try {
      return [{ path: base, text: readFileSync(base, "utf8") }];
    } catch {
      // fall through to directory walk
    }
  }
  const out: SourceFile[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name), depth + 1);
      } else if (PY_EXT.test(e.name)) {
        const p = join(dir, e.name);
        try {
          out.push({ path: p, text: readFileSync(p, "utf8") });
        } catch {
          /* unreadable — skip */
        }
      }
    }
  };
  walk(base, 0);
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

/** Normalize a route: Flask `<int:id>`/`<id>` and FastAPI `{id}`/`{id:path}` → `{id}`. */
export function normalizeRoute(route: string): string {
  let r = (route || "").trim();
  r = r.replace(/<(?:[^:>]+:)?([^>]+)>/g, "{$1}"); // Flask converters
  r = r.replace(/\{([A-Za-z0-9_]+)[^}]*\}/g, "{$1}"); // FastAPI {id:path} → {id}
  r = r.replace(/\/{2,}/g, "/");
  if (!r.startsWith("/")) r = "/" + r;
  if (r.length > 1 && r.endsWith("/")) r = r.slice(0, -1);
  return r || "/";
}

export function routeTokens(route: string): string[] {
  const out: string[] = [];
  const re = /\{([A-Za-z0-9_]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(route))) out.push(m[1] as string);
  return out;
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-/, "").replace(/-$/, "") || "root";
}
