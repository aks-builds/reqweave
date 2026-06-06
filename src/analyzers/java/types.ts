/**
 * Maps Java type strings to the IR's JsonSchemaNode, resolving named DTO/enum
 * types via the Java index. Bounded recursion + cycle guard.
 */
import type { JsonSchemaNode, Diagnostic } from "../../ir/schema.js";
import type { JavaClass } from "./models.js";

const MAX_DEPTH = 64;

export interface JavaCtx {
  index: Map<string, JavaClass>;
  diags: Diagnostic[];
  visiting: Set<string>;
  unresolved: Set<string>;
  depth: number;
}

export function newJavaCtx(index: Map<string, JavaClass>, diags: Diagnostic[]): JavaCtx {
  return { index, diags, visiting: new Set(), unresolved: new Set(), depth: 0 };
}

/** Unwrap a single container generic (ResponseEntity/Mono/etc.) for responses. */
export function unwrapResponse(type: string): string {
  const t = type.trim();
  const g = parseGeneric(t);
  if (g && ["ResponseEntity", "Mono", "Callable", "Optional", "HttpEntity", "CompletableFuture"].includes(simple(g.base))) {
    return g.args[0] ?? "void";
  }
  return t;
}

export function mapJavaType(raw: string, ctx: JavaCtx): JsonSchemaNode {
  if (ctx.depth > MAX_DEPTH) return {};
  let t = raw.replace(/@\w+\s*(\([^)]*\))?/g, "").trim();
  if (!t) return {};
  const next = { ...ctx, depth: ctx.depth + 1 };

  // Arrays: X[]
  if (t.endsWith("[]")) return { type: "array", items: mapJavaType(t.slice(0, -2), next) };

  const g = parseGeneric(t);
  if (g) {
    const base = simple(g.base);
    if (["List", "Set", "Collection", "Iterable", "ArrayList", "HashSet", "Flux", "Stream"].includes(base)) {
      return { type: "array", items: g.args[0] ? mapJavaType(g.args[0], next) : {} };
    }
    if (["Map", "HashMap", "Dictionary", "ConcurrentHashMap", "TreeMap"].includes(base)) {
      return { type: "object", additionalProperties: g.args[1] ? mapJavaType(g.args[1], next) : {} };
    }
    if (base === "Optional") return withNullable(g.args[0] ? mapJavaType(g.args[0], next) : {}, true);
    if (["ResponseEntity", "Mono", "Callable", "HttpEntity", "CompletableFuture"].includes(base)) {
      return g.args[0] ? mapJavaType(g.args[0], next) : {};
    }
    t = base; // unknown generic — fall back to base name
  }

  const scalar = mapScalar(simple(t));
  if (scalar) return scalar;
  return mapNamed(simple(t), next);
}

function mapScalar(t: string): JsonSchemaNode | null {
  switch (t) {
    case "String": case "CharSequence": case "char": case "Character": return { type: "string" };
    case "byte": case "Byte": case "short": case "Short": case "int": case "Integer":
    case "long": case "Long": case "BigInteger": return { type: "integer" };
    case "float": case "Float": case "double": case "Double": case "BigDecimal": return { type: "number" };
    case "boolean": case "Boolean": return { type: "boolean" };
    case "UUID": return { type: "string", format: "uuid" };
    case "LocalDate": return { type: "string", format: "date" };
    case "LocalDateTime": case "Instant": case "OffsetDateTime": case "ZonedDateTime": case "Date":
      return { type: "string", format: "date-time" };
    case "Object": case "JsonNode": return {};
    case "void": case "Void": return { type: "null" };
    default: return null;
  }
}

function mapNamed(name: string, ctx: JavaCtx): JsonSchemaNode {
  if (ctx.visiting.has(name)) return { type: "object" };
  const cls = ctx.index.get(name);
  if (!cls) {
    if (!ctx.unresolved.has(name)) {
      ctx.unresolved.add(name);
      ctx.diags.push({ code: "unresolvedType", message: `unresolved type '${name}'`, severity: "info" });
    }
    return {};
  }
  if (cls.kind === "enum") {
    return cls.enumValues.length ? { type: "string", enum: cls.enumValues } : { type: "string" };
  }
  const visiting = new Set(ctx.visiting).add(name);
  const sub = { ...ctx, visiting };
  const properties: Record<string, JsonSchemaNode> = {};
  const required: string[] = [];
  for (const f of cls.fields) {
    properties[f.name] = mapJavaType(f.type, sub);
    if (f.required) required.push(f.name);
  }
  const out: JsonSchemaNode = { type: "object", properties };
  if (required.length) out.required = required;
  return out;
}

function withNullable(schema: JsonSchemaNode, nullable: boolean): JsonSchemaNode {
  return nullable ? { ...schema, nullable: true } : schema;
}

function simple(name: string): string {
  return (name.split(".").pop() ?? name).trim();
}

interface Generic {
  base: string;
  args: string[];
}

function parseGeneric(s: string): Generic | null {
  const open = s.indexOf("<");
  if (open === -1 || !s.trimEnd().endsWith(">")) return null;
  const base = s.slice(0, open).trim();
  const inner = s.slice(open + 1, s.lastIndexOf(">"));
  return { base, args: splitTopLevelAngle(inner).map((a) => a.trim()).filter(Boolean) };
}

function splitTopLevelAngle(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "<") depth++;
    else if (ch === ">") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
