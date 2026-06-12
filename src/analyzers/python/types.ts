/**
 * Indexes Python classes (Pydantic models / dataclasses / Enums) and maps type
 * annotations to the IR's JsonSchemaNode. Pattern-based: operates on the logical
 * lines from lines.ts. Bounded recursion + cycle guard.
 */
import type { JsonSchemaNode, Diagnostic } from "../../ir/schema.js";
import type { LogicalLine } from "./lines.js";

const MAX_DEPTH = 64;

export interface PyClass {
  name: string;
  kind: "model" | "enum";
  fields: { name: string; type: string; required: boolean }[];
  enumValues: (string | number)[];
}

export type ModelIndex = Map<string, PyClass>;

const CLASS_RE = /^class\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s*:/;
const FIELD_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/;
const ENUM_MEMBER_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/;

/** Build a model index from all files' logical lines. */
export function buildModelIndex(filesLines: LogicalLine[][]): ModelIndex {
  const index: ModelIndex = new Map();
  for (const lines of filesLines) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as LogicalLine;
      const m = CLASS_RE.exec(line.code);
      if (!m) continue;
      const name = m[1] as string;
      const bases = (m[2] ?? "").split(",").map((s) => s.trim());
      const isEnum = bases.some((b) => /(^|\.)(Int|Str)?Enum$/.test(b));
      const cls: PyClass = { name, kind: isEnum ? "enum" : "model", fields: [], enumValues: [] };

      for (let j = i + 1; j < lines.length; j++) {
        const body = lines[j] as LogicalLine;
        if (body.indent <= line.indent) break; // dedent ends the class body
        if (isEnum) {
          const em = ENUM_MEMBER_RE.exec(body.code);
          if (em) cls.enumValues.push(literalValue(em[2] as string));
          continue;
        }
        if (/^def\s|^async\s+def\s|^class\s|^@/.test(body.code)) continue;
        const fm = FIELD_RE.exec(body.code);
        if (fm) {
          const { type, hasDefault } = splitAnnotation(fm[2] as string);
          const required = !hasDefault && !isOptional(type);
          cls.fields.push({ name: fm[1] as string, type, required });
        }
      }
      if (!index.has(name)) index.set(name, cls);
    }
  }
  return index;
}

export interface MapCtx {
  index: ModelIndex;
  diags: Diagnostic[];
  visiting: Set<string>;
  unresolved: Set<string>;
  depth: number;
}

export function newCtx(index: ModelIndex, diags: Diagnostic[]): MapCtx {
  return { index, diags, visiting: new Set(), unresolved: new Set(), depth: 0 };
}

export function mapPyType(rawType: string, ctx: MapCtx): JsonSchemaNode {
  if (ctx.depth > MAX_DEPTH) return {};
  let t = rawType.trim().replace(/^['"]|['"]$/g, ""); // strip forward-ref quotes
  if (!t) return {};
  const next = { ...ctx, depth: ctx.depth + 1 };

  // Top-level union via `|`
  if (hasTopLevel(t, "|")) {
    const parts = splitTopLevel(t, "|").map((s) => s.trim());
    const nonNull = parts.filter((p) => p !== "None" && p !== "none");
    const nullable = nonNull.length !== parts.length;
    if (nonNull.length === 1) return withNullable(mapPyType(nonNull[0] as string, next), nullable);
    return withNullable({ oneOf: nonNull.map((p) => mapPyType(p, next)) }, nullable);
  }

  const gen = parseGeneric(t);
  if (gen) {
    const base = gen.base.split(".").pop() as string;
    const lower = base.toLowerCase();
    if (["list", "sequence", "set", "frozenset", "iterable", "tuple"].includes(lower)) {
      return { type: "array", items: gen.args[0] ? mapPyType(gen.args[0], next) : {} };
    }
    if (["dict", "mapping", "ordereddict", "defaultdict"].includes(lower)) {
      return { type: "object", additionalProperties: gen.args[1] ? mapPyType(gen.args[1], next) : {} };
    }
    if (lower === "optional") return withNullable(gen.args[0] ? mapPyType(gen.args[0], next) : {}, true);
    if (lower === "union") {
      const nonNull = gen.args.filter((a) => a.trim() !== "None");
      const nullable = nonNull.length !== gen.args.length;
      if (nonNull.length === 1) return withNullable(mapPyType(nonNull[0] as string, next), nullable);
      return withNullable({ oneOf: nonNull.map((a) => mapPyType(a, next)) }, nullable);
    }
    if (lower === "literal") {
      return { enum: gen.args.map((a) => literalValue(a.trim())) };
    }
    if (lower === "annotated") return gen.args[0] ? mapPyType(gen.args[0], next) : {};
    // Unknown generic — fall back to its base name.
    t = base;
  }

  const scalar = mapScalar(t);
  if (scalar) return scalar;

  return mapNamed(t, next);
}

function mapScalar(t: string): JsonSchemaNode | null {
  switch (t.split(".").pop()) {
    case "str": return { type: "string" };
    case "int": return { type: "integer" };
    case "float": case "complex": case "Decimal": return { type: "number" };
    case "bool": return { type: "boolean" };
    case "bytes": case "bytearray": return { type: "string" };
    case "datetime": return { type: "string", format: "date-time" };
    case "date": return { type: "string", format: "date" };
    case "time": return { type: "string", format: "time" };
    case "UUID": return { type: "string", format: "uuid" };
    case "EmailStr": return { type: "string", format: "email" };
    case "AnyUrl": case "HttpUrl": return { type: "string", format: "uri" };
    case "None": case "NoneType": return { type: "null" };
    case "Any": case "object": case "dict": case "Dict": return {};
    default: return null;
  }
}

function mapNamed(name: string, ctx: MapCtx): JsonSchemaNode {
  const simple = name.split(".").pop() as string;
  if (ctx.visiting.has(simple)) return { type: "object" };
  const cls = ctx.index.get(simple);
  if (!cls) {
    if (!ctx.unresolved.has(simple)) {
      ctx.unresolved.add(simple);
      ctx.diags.push({ code: "unresolvedType", message: `unresolved type '${simple}'`, severity: "info" });
    }
    return {};
  }
  if (cls.kind === "enum") {
    const values = cls.enumValues;
    const allNum = values.length > 0 && values.every((v) => typeof v === "number");
    return { type: allNum ? "integer" : "string", enum: values.length ? values : undefined } as JsonSchemaNode;
  }
  const visiting = new Set(ctx.visiting).add(simple);
  const sub = { ...ctx, visiting };
  const properties: Record<string, JsonSchemaNode> = {};
  const required: string[] = [];
  for (const f of cls.fields) {
    properties[f.name] = mapPyType(f.type, sub);
    if (f.required) required.push(f.name);
  }
  const out: JsonSchemaNode = { type: "object", properties };
  if (required.length) out.required = required;
  return out;
}

function withNullable(schema: JsonSchemaNode, nullable: boolean): JsonSchemaNode {
  return nullable ? { ...schema, nullable: true } : schema;
}

export function isOptional(type: string): boolean {
  const t = type.trim();
  return /(^|[^A-Za-z])Optional\s*\[/.test(t) || hasTopLevel(t, "|") && splitTopLevel(t, "|").some((p) => p.trim() === "None");
}

/** Split an annotation `Type = default` into the type and whether a default exists. */
export function splitAnnotation(s: string): { type: string; hasDefault: boolean } {
  const idx = topLevelIndexOf(s, "=");
  if (idx === -1) return { type: s.trim(), hasDefault: false };
  return { type: s.slice(0, idx).trim(), hasDefault: true };
}

interface Generic {
  base: string;
  args: string[];
}

function parseGeneric(s: string): Generic | null {
  const open = s.indexOf("[");
  if (open === -1 || !s.trimEnd().endsWith("]")) return null;
  const base = s.slice(0, open).trim();
  const inner = s.slice(open + 1, s.lastIndexOf("]"));
  return { base, args: splitTopLevel(inner, ",").map((a) => a.trim()).filter(Boolean) };
}

function literalValue(s: string): string | number {
  const t = s.trim().replace(/^['"]|['"]$/g, "");
  const num = Number(t);
  return s.trim() === t && t !== "" && Number.isFinite(num) ? num : t;
}

// --- bracket-aware string scanning ------------------------------------------
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "[" || ch === "(" || ch === "{") depth++;
    else if (ch === "]" || ch === ")" || ch === "}") depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function hasTopLevel(s: string, sep: string): boolean {
  return topLevelIndexOf(s, sep) !== -1;
}

function topLevelIndexOf(s: string, sep: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "[" || ch === "(" || ch === "{") depth++;
    else if (ch === "]" || ch === ")" || ch === "}") depth--;
    else if (ch === sep && depth === 0) return i;
  }
  return -1;
}
