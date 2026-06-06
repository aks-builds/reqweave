/**
 * Deterministic value generation from an IR schema node. No randomness, no
 * wall-clock — identical inputs always yield identical values (stable diffs).
 */
import type { JsonSchemaNode } from "../ir/schema.js";

export type ValueKind = "valid" | "min" | "max" | "invalid";

export interface GenOpts {
  kind: ValueKind;
  /** Include optional object properties (not just required ones). */
  includeOptional: boolean;
  depth: number;
}

const MAX_DEPTH = 16;
const FIXED_UUID = "00000000-0000-0000-0000-000000000000";
const FIXED_DATETIME = "2024-01-01T00:00:00Z";
const FIXED_DATE = "2024-01-01";

export function genValue(schema: JsonSchemaNode, opts: GenOpts): unknown {
  if (opts.depth > MAX_DEPTH) {
    return null;
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return opts.kind === "invalid" ? "__invalid_enum__" : schema.enum[0];
  }

  switch (schema.type) {
    case "string":
      return genString(schema, opts.kind);
    case "integer":
      return genNumber(schema, opts.kind, true);
    case "number":
      return genNumber(schema, opts.kind, false);
    case "boolean":
      return opts.kind === "invalid" ? "not-a-boolean" : true;
    case "array":
      return genArray(schema, opts);
    case "object":
      return genObject(schema, opts);
    default:
      return opts.kind === "invalid" ? null : "string";
  }
}

function genString(schema: JsonSchemaNode, kind: ValueKind): string {
  const fmt = typeof schema.format === "string" ? schema.format : undefined;
  switch (fmt) {
    case "email":
      return kind === "invalid" ? "not-an-email" : "user@example.com";
    case "uuid":
      return kind === "invalid" ? "not-a-uuid" : FIXED_UUID;
    case "date-time":
      return kind === "invalid" ? "not-a-date" : FIXED_DATETIME;
    case "date":
      return kind === "invalid" ? "not-a-date" : FIXED_DATE;
    case "uri":
      return kind === "invalid" ? "not a uri" : "https://example.com";
    default:
      break;
  }

  const min = typeof schema.minLength === "number" ? schema.minLength : undefined;
  const max = typeof schema.maxLength === "number" ? schema.maxLength : undefined;

  if (kind === "invalid") {
    if (max !== undefined) return "a".repeat(max + 1); // too long
    if (min !== undefined && min > 0) return ""; // too short
    if (typeof schema.pattern === "string") return "###";
    return "string";
  }

  if (kind === "min" && min !== undefined) return "a".repeat(min);
  if (kind === "max" && max !== undefined) return "a".repeat(max);
  if (min !== undefined && min > "string".length) return "a".repeat(min);
  return "string";
}

function genNumber(schema: JsonSchemaNode, kind: ValueKind, isInt: boolean): number | string {
  const min = typeof schema.minimum === "number" ? schema.minimum : undefined;
  const max = typeof schema.maximum === "number" ? schema.maximum : undefined;
  // A "typical" valid value: the midpoint when both bounds exist (so boundary
  // variants are genuinely distinct from the happy path), else a bound, else 1.
  const mid = min !== undefined && max !== undefined ? (isInt ? Math.floor((min + max) / 2) : (min + max) / 2) : undefined;
  const base = mid ?? min ?? max ?? 1;

  switch (kind) {
    case "invalid":
      if (max !== undefined) return max + 1;
      if (min !== undefined) return min - 1;
      return "not-a-number"; // type mismatch when unbounded
    case "min":
      return min ?? base;
    case "max":
      return max ?? base;
    default:
      return base;
  }
}

function genArray(schema: JsonSchemaNode, opts: GenOpts): unknown {
  if (opts.kind === "invalid") {
    return "not-an-array";
  }

  const items = (schema.items as JsonSchemaNode | undefined) ?? {};
  return [genValue(items, { ...opts, kind: "valid", depth: opts.depth + 1 })];
}

function genObject(schema: JsonSchemaNode, opts: GenOpts): Record<string, unknown> {
  const props = (schema.properties as Record<string, JsonSchemaNode> | undefined) ?? {};
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const keys = Object.keys(props);
  const out: Record<string, unknown> = {};

  const include = (k: string) => required.has(k) || opts.includeOptional;
  const child = (k: string, kind: ValueKind) =>
    genValue(props[k] ?? {}, { ...opts, kind, depth: opts.depth + 1 });

  if (opts.kind === "invalid") {
    const firstRequired = keys.find((k) => required.has(k));
    if (firstRequired !== undefined) {
      // Omit one required field -> a 400-eliciting body.
      for (const k of keys) {
        if (k !== firstRequired && include(k)) out[k] = child(k, "valid");
      }
      return out;
    }
    // No required fields: make the first property's value invalid.
    if (keys.length > 0) {
      const first = keys[0] as string;
      out[first] = child(first, "invalid");
      for (const k of keys.slice(1)) {
        if (include(k)) out[k] = child(k, "valid");
      }
    }
    return out;
  }

  for (const k of keys) {
    if (include(k)) out[k] = child(k, "valid");
  }
  return out;
}

/** Render a value for use in a URL path or query string. */
export function toParamString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
