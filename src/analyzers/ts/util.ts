/**
 * Shared helpers for the in-process TypeScript/Node analyzer. The `typescript`
 * package is loaded lazily (only when TS analysis actually runs) so .NET / IR /
 * OpenAPI code paths never pay for it.
 */
import type * as TS from "typescript";
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

let _ts: typeof TS | null = null;

/** Lazily resolve the TypeScript compiler API. */
export function loadTs(): typeof TS {
  if (_ts) return _ts;
  try {
    _ts = createRequire(__filename)("typescript") as typeof TS;
  } catch {
    throw new Error(
      "reqweave: TypeScript analysis needs the 'typescript' package. Install it (it ships with reqweave; if missing run `npm i typescript`), or pass --ir/--openapi.",
    );
  }
  return _ts;
}

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".vs", ".idea", "dist", "build", "out", "coverage", ".next", ".turbo", "bin", "obj",
]);
const TS_EXT = /\.(ts|tsx|mts|cts)$/i;
const DECL_EXT = /\.d\.(ts|mts|cts)$/i;

export interface SourceFile {
  path: string;
  text: string;
}

/** Collect project TypeScript source files (bounded walk; skips heavy dirs and .d.ts). */
export function collectSourceFiles(sourcePath: string, maxDepth = 12): SourceFile[] {
  const base = resolve(sourcePath);
  // Single-file target: read it directly (try-then-act avoids a stat→read race).
  if (TS_EXT.test(base) && !DECL_EXT.test(base)) {
    try {
      return [{ path: base, text: readFileSync(base, "utf8") }];
    } catch {
      // not a readable file (a directory or missing) — fall through to the walk
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
      } else if (TS_EXT.test(e.name) && !DECL_EXT.test(e.name)) {
        const p = join(dir, e.name);
        try {
          out.push({ path: p, text: readFileSync(p, "utf8") });
        } catch {
          /* unreadable file — skip */
        }
      }
    }
  };
  walk(base, 0);
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)); // deterministic order
  return out;
}

/** Normalize a route: `:id`/`{id:int}`/`{id?}` → `{id}`, ensure leading `/`, dedupe slashes. */
export function normalizeRoute(route: string): string {
  let r = (route || "").trim();
  r = r.replace(/:([A-Za-z0-9_]+)\??/g, "{$1}"); // Express :id (and :id?) → {id}
  r = r.replace(/\{([A-Za-z0-9_]+)[^}]*\}/g, "{$1}"); // strip constraints/regex: {id:int} {id?} {*rest} → {id}
  r = r.replace(/\/{2,}/g, "/");
  if (!r.startsWith("/")) r = "/" + r;
  if (r.length > 1 && r.endsWith("/")) r = r.slice(0, -1);
  return r || "/";
}

/** Join a controller base path with a method sub-path. */
export function joinRoute(base: string, sub: string): string {
  const b = base ? normalizeRoute(base) : "";
  const s = sub ? normalizeRoute(sub) : "";
  if (!b || b === "/") return s || "/";
  if (!s || s === "/") return b;
  return normalizeRoute(b + s);
}

/** Route token names, e.g. `/pets/{id}/owners/{oid}` → ["id","oid"]. */
export function routeTokens(route: string): string[] {
  const out: string[] = [];
  const re = /\{([A-Za-z0-9_]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(route))) out.push(m[1] as string);
  return out;
}

/** Slug for endpoint ids (matches the OpenAPI importer's scheme). */
export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-/, "").replace(/-$/, "") || "root";
}
