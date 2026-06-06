/** Shared exporter helpers: URL building, placeholder transforms, stable JSON. */
import type { RequestVariant } from "../variants/index.js";

/** Substitute {token} path params with their values. */
export function resolvePath(routeTemplate: string, pathParams: Record<string, string>): string {
  return routeTemplate.replace(/\{([^}]+)\}/g, (_, k: string) => pathParams[k] ?? `{${k}}`);
}

export function queryString(query: ReadonlyArray<{ name: string; value: string }>): string {
  if (query.length === 0) return "";
  return "?" + query.map((q) => `${q.name}=${q.value}`).join("&");
}

/** Full URL with a {{baseUrl}} host prefix (values left raw to preserve placeholders). */
export function fullUrl(variant: RequestVariant): string {
  return `{{baseUrl}}${resolvePath(variant.routeTemplate, variant.pathParams)}${queryString(variant.query)}`;
}

/** The {{var}} names referenced anywhere in a set of variants. */
export function usedVariables(variants: RequestVariant[]): string[] {
  const found = new Set<string>(["baseUrl"]);
  const scan = (s: string) => {
    for (const m of s.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) {
      found.add(m[1] as string);
    }
  };
  for (const v of variants) {
    for (const h of v.headers) scan(h.value);
    for (const q of v.query) scan(q.value);
    if (v.body) scan(typeof v.body.value === "string" ? v.body.value : JSON.stringify(v.body.value));
  }
  found.delete("baseUrl");
  return ["baseUrl", ...[...found].sort()];
}

/** Rewrite neutral {{var}} placeholders into a tool's native syntax. */
export function rewritePlaceholders(s: string, style: "double" | "insomnia" | "angle"): string {
  if (style === "double") return s;
  return s.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, name: string) =>
    style === "insomnia" ? `{{ _.${name} }}` : `<<${name}>>`,
  );
}

export function bodyText(variant: RequestVariant): string | undefined {
  if (!variant.body) return undefined;
  const v = variant.body.value;
  return typeof v === "string" ? v : JSON.stringify(v, null, 2);
}

/** Deterministic JSON: object keys sorted recursively. */
export function stableStringify(value: unknown, indent = 2): string {
  return JSON.stringify(sortKeys(value), null, indent);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** Deterministic UUID-shaped id derived from a string (FNV-1a based). */
export function deterministicId(seed: string): string {
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  let h = 0x811c9dc5;
  const out: number[] = [];
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i) + pass;
      h = Math.imul(h, 0x01000193);
    }
    out.push(h);
  }
  const s = out.map(hex).join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-8${s.slice(17, 20)}-${s.slice(20, 32)}`;
}

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

/** Group variants by their endpoint id, preserving first-seen order. */
export function groupByEndpoint(variants: RequestVariant[]): Array<{ endpointId: string; variants: RequestVariant[] }> {
  const order: string[] = [];
  const map = new Map<string, RequestVariant[]>();
  for (const v of variants) {
    if (!map.has(v.endpointId)) {
      map.set(v.endpointId, []);
      order.push(v.endpointId);
    }
    map.get(v.endpointId)!.push(v);
  }
  return order.map((id) => ({ endpointId: id, variants: map.get(id)! }));
}
