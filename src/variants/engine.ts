/**
 * The variant engine: turns each IR endpoint into a bounded-but-thorough set of
 * concrete request variants. Pure and deterministic.
 *
 * Depth tiers:
 *   minimal     happy path only (required params, valid values).
 *   standard    + all-optional, one variant per declared error status,
 *               boundary values. (default)
 *   exhaustive  + pairwise over optional-param presence and enum members.
 * All tiers are capped (see DEPTH_CAPS); capping is reported in notes.
 */
import type { Auth, Endpoint, Ir, JsonSchemaNode, Param } from "../ir/schema.js";
import { genValue, toParamString, type ValueKind } from "./values.js";
import { pairwise } from "./pairwise.js";
import {
  DEPTH_CAPS,
  type NameValue,
  type RequestVariant,
  type VariantOptions,
  type VariantResult,
} from "./types.js";

export function generateAll(ir: Ir, opts: VariantOptions): VariantResult {
  const variants: RequestVariant[] = [];
  const notes: string[] = [];
  for (const ep of ir.endpoints) {
    const r = generateVariants(ep, opts);
    variants.push(...r.variants);
    notes.push(...r.notes);
  }
  return { variants, notes };
}

interface BuildSpec {
  name: string;
  expectedStatus: number;
  includeOptional: boolean;
  includeAuth: boolean;
  bodyKind: ValueKind;
  provenance: string[];
  pathOverrides?: Record<string, string>;
  queryOverrides?: Record<string, string>;
  dropRequiredQuery?: string;
}

export function generateVariants(ep: Endpoint, opts: VariantOptions): VariantResult {
  const notes: string[] = [];
  const cap = DEPTH_CAPS[opts.depth];
  const success = pickSuccess(ep);
  const out: RequestVariant[] = [];

  out.push(build(ep, {
    name: "happy path",
    expectedStatus: success,
    includeOptional: false,
    includeAuth: ep.auth.required,
    bodyKind: "valid",
    provenance: ["required-only"],
  }));

  if (opts.depth !== "minimal") {
    if (hasOptionals(ep)) {
      out.push(build(ep, {
        name: "all optional populated",
        expectedStatus: success,
        includeOptional: true,
        includeAuth: ep.auth.required,
        bodyKind: "valid",
        provenance: ["all-optional"],
      }));
    }

    // An [Authorize] endpoint implies a 401 even if it isn't declared.
    if (ep.auth.required) {
      out.push(build(ep, {
        name: "unauthorized",
        expectedStatus: 401,
        includeOptional: false,
        includeAuth: false,
        bodyKind: "valid",
        provenance: ["unauthorized"],
      }));
    }

    for (const resp of ep.responses) {
      if (resp.status < 400 || resp.status === 401) continue;
      const v = buildError(ep, resp.status, success);
      if (v) out.push(v);
    }

    out.push(...boundaryVariants(ep, success));
  }

  if (opts.depth === "exhaustive") {
    out.push(...exhaustiveVariants(ep, success));
  }

  let final = dedupe(out);
  if (final.length > cap) {
    notes.push(`endpoint ${ep.id}: capped variants ${final.length} -> ${cap} at depth=${opts.depth}`);
    final = final.slice(0, cap);
  }
  uniquifyNames(final);
  return { variants: final, notes };
}

function build(ep: Endpoint, spec: BuildSpec): RequestVariant {
  const pathParams: Record<string, string> = {};
  for (const p of ep.params.filter((x) => x.in === "route")) {
    pathParams[p.name] = spec.pathOverrides?.[p.name] ?? toParamString(valid(p.schema));
  }

  const query: NameValue[] = [];
  for (const p of ep.params.filter((x) => x.in === "query")) {
    if (!p.required && !spec.includeOptional) continue;
    if (spec.dropRequiredQuery === p.name) continue;
    query.push({ name: p.name, value: spec.queryOverrides?.[p.name] ?? toParamString(valid(p.schema)) });
  }

  const headers: NameValue[] = [];
  for (const p of ep.params.filter((x) => x.in === "header")) {
    if (!p.required && !spec.includeOptional) continue;
    headers.push({ name: p.name, value: toParamString(valid(p.schema)) });
  }
  if (spec.includeAuth) {
    const authHeader = authToHeader(ep.auth);
    if (authHeader) headers.push(authHeader);
    else {
      const authQuery = authToQuery(ep.auth);
      if (authQuery) query.push(authQuery);
    }
  }

  const variant: RequestVariant = {
    endpointId: ep.id,
    name: spec.name,
    method: ep.method,
    routeTemplate: ep.routeTemplate,
    pathParams,
    query,
    headers,
    expectedStatus: spec.expectedStatus,
    provenance: spec.provenance,
  };

  if (ep.requestBody) {
    variant.body = {
      contentType: ep.requestBody.contentType,
      value: genValue(ep.requestBody.schema, {
        kind: spec.bodyKind,
        includeOptional: spec.includeOptional,
        depth: 0,
      }),
    };
  }

  return variant;
}

function buildError(ep: Endpoint, status: number, success: number): RequestVariant | null {
  if (status === 403 && ep.auth.required) {
    return build(ep, {
      name: "forbidden",
      expectedStatus: 403,
      includeOptional: false,
      includeAuth: true,
      bodyKind: "valid",
      provenance: ["forbidden"],
    });
  }

  if (status === 404) {
    const routeParam = ep.params.find((p) => p.in === "route");
    if (!routeParam) return null;
    return build(ep, {
      name: "not found",
      expectedStatus: 404,
      includeOptional: false,
      includeAuth: ep.auth.required,
      bodyKind: "valid",
      provenance: ["not-found"],
      pathOverrides: { [routeParam.name]: notFoundValue(routeParam.schema) },
    });
  }

  if (status === 400 || status === 422) {
    if (ep.requestBody) {
      return build(ep, {
        name: `invalid body (${status})`,
        expectedStatus: status,
        includeOptional: false,
        includeAuth: ep.auth.required,
        bodyKind: "invalid",
        provenance: ["invalid-input"],
      });
    }
    const requiredQuery = ep.params.find((p) => p.in === "query" && p.required);
    if (requiredQuery) {
      return build(ep, {
        name: `missing required '${requiredQuery.name}' (${status})`,
        expectedStatus: status,
        includeOptional: false,
        includeAuth: ep.auth.required,
        bodyKind: "valid",
        provenance: ["invalid-input"],
        dropRequiredQuery: requiredQuery.name,
      });
    }
    const constrained = ep.params.find((p) => p.in !== "route" && isConstrained(p.schema));
    if (constrained) {
      return build(ep, {
        name: `invalid '${constrained.name}' (${status})`,
        expectedStatus: status,
        includeOptional: false,
        includeAuth: ep.auth.required,
        bodyKind: "valid",
        provenance: ["invalid-input"],
        queryOverrides:
          constrained.in === "query"
            ? { [constrained.name]: toParamString(genValue(constrained.schema, { kind: "invalid", includeOptional: false, depth: 0 })) }
            : undefined,
      });
    }
    return null;
  }

  return null; // 409/5xx/etc. — not reliably constructible from static info
}

function boundaryVariants(ep: Endpoint, success: number): RequestVariant[] {
  const target = ep.params.find((p) => isNumericBounded(p.schema));
  if (!target) return [];
  const out: RequestVariant[] = [];
  for (const kind of ["min", "max"] as const) {
    const bound = target.schema[kind === "min" ? "minimum" : "maximum"];
    if (typeof bound !== "number") continue;
    out.push(build(ep, {
      name: `${target.name} = ${kind === "min" ? "minimum" : "maximum"}`,
      expectedStatus: success,
      includeOptional: false,
      includeAuth: ep.auth.required,
      bodyKind: "valid",
      provenance: [`boundary-${kind}`],
      queryOverrides: target.in === "query" ? { [target.name]: String(bound) } : undefined,
      pathOverrides: target.in === "route" ? { [target.name]: String(bound) } : undefined,
    }));
  }
  return out;
}

function exhaustiveVariants(ep: Endpoint, success: number): RequestVariant[] {
  const out: RequestVariant[] = [];

  // Pairwise over optional query/header presence (present/absent).
  const optionals = ep.params.filter((p) => (p.in === "query" || p.in === "header") && !p.required);
  if (optionals.length >= 2) {
    const cases = pairwise(optionals.map((p) => ({ name: p.name, values: [true, false] })));
    let i = 0;
    for (const combo of cases) {
      const present = optionals.filter((p) => combo[p.name]);
      out.push({
        ...build(ep, {
          name: `presence combo ${++i}`,
          expectedStatus: success,
          includeOptional: false,
          includeAuth: ep.auth.required,
          bodyKind: "valid",
          provenance: ["pairwise-presence"],
        }),
        query: presenceQuery(ep, present),
      });
    }
  }

  // One variant per enum member of the first enum param.
  const enumParam = ep.params.find((p) => p.in !== "route" && Array.isArray(p.schema.enum));
  if (enumParam && Array.isArray(enumParam.schema.enum)) {
    for (const member of enumParam.schema.enum as unknown[]) {
      out.push(build(ep, {
        name: `${enumParam.name} = ${String(member)}`,
        expectedStatus: success,
        includeOptional: false,
        includeAuth: ep.auth.required,
        bodyKind: "valid",
        provenance: ["enum-member"],
        queryOverrides: enumParam.in === "query" ? { [enumParam.name]: String(member) } : undefined,
        pathOverrides: enumParam.in === "route" ? { [enumParam.name]: String(member) } : undefined,
      }));
    }
  }

  out.push(...bodyFieldVariants(ep, success));
  return out;
}

/** Expand enum members and numeric boundaries of top-level request-body fields. */
function bodyFieldVariants(ep: Endpoint, success: number): RequestVariant[] {
  const out: RequestVariant[] = [];
  const schema = ep.requestBody?.schema;
  if (!schema || schema.type !== "object" || !schema.properties) return out;

  const props = schema.properties as Record<string, JsonSchemaNode>;
  for (const [field, fieldSchema] of Object.entries(props)) {
    if (Array.isArray(fieldSchema.enum)) {
      for (const member of fieldSchema.enum as unknown[]) {
        out.push(withBodyField(ep, success, field, member, `body.${field} = ${String(member)}`, "enum-member"));
      }
    } else if (typeof fieldSchema.minimum === "number" || typeof fieldSchema.maximum === "number") {
      if (typeof fieldSchema.minimum === "number") {
        out.push(withBodyField(ep, success, field, fieldSchema.minimum, `body.${field} = minimum`, "boundary-min"));
      }
      if (typeof fieldSchema.maximum === "number") {
        out.push(withBodyField(ep, success, field, fieldSchema.maximum, `body.${field} = maximum`, "boundary-max"));
      }
    }
  }
  return out;
}

function withBodyField(
  ep: Endpoint,
  success: number,
  field: string,
  value: unknown,
  name: string,
  provenance: string,
): RequestVariant {
  const v = build(ep, {
    name,
    expectedStatus: success,
    includeOptional: true,
    includeAuth: ep.auth.required,
    bodyKind: "valid",
    provenance: [provenance],
  });
  if (v.body && v.body.value && typeof v.body.value === "object") {
    (v.body.value as Record<string, unknown>)[field] = value;
  }
  return v;
}

// --- helpers ---

function presenceQuery(ep: Endpoint, present: Param[]): NameValue[] {
  const q: NameValue[] = [];
  for (const p of ep.params.filter((x) => x.in === "query" && x.required)) {
    q.push({ name: p.name, value: toParamString(valid(p.schema)) });
  }
  for (const p of present.filter((x) => x.in === "query")) {
    q.push({ name: p.name, value: toParamString(valid(p.schema)) });
  }
  return q;
}

const valid = (schema: JsonSchemaNode): unknown =>
  genValue(schema, { kind: "valid", includeOptional: false, depth: 0 });

function pickSuccess(ep: Endpoint): number {
  const twoXx = ep.responses.map((r) => r.status).filter((s) => s >= 200 && s < 300);
  return twoXx.length > 0 ? Math.min(...twoXx) : 200;
}

function hasOptionals(ep: Endpoint): boolean {
  if (ep.params.some((p) => (p.in === "query" || p.in === "header") && !p.required)) return true;
  const body = ep.requestBody?.schema;
  if (body && body.type === "object" && body.properties) {
    const required = new Set(Array.isArray(body.required) ? body.required : []);
    return Object.keys(body.properties).some((k) => !required.has(k));
  }
  return false;
}

function isConstrained(schema: JsonSchemaNode): boolean {
  return (
    isNumericBounded(schema) ||
    typeof schema.minLength === "number" ||
    typeof schema.maxLength === "number" ||
    typeof schema.pattern === "string" ||
    Array.isArray(schema.enum)
  );
}

function isNumericBounded(schema: JsonSchemaNode): boolean {
  return typeof schema.minimum === "number" || typeof schema.maximum === "number";
}

function notFoundValue(schema: JsonSchemaNode): string {
  if (schema.type === "integer" || schema.type === "number") return "999999999";
  if (schema.format === "uuid") return "00000000-0000-0000-0000-000000000404";
  return "does-not-exist";
}

function authToHeader(auth: Auth): NameValue | null {
  const scheme = auth.schemes[0];
  if (!scheme) return null;
  switch (scheme.type) {
    case "bearer":
      return { name: "Authorization", value: "Bearer {{bearerToken}}" };
    case "basic":
      return { name: "Authorization", value: "Basic {{basicAuth}}" };
    case "apiKey":
      if (scheme.location === "header") return { name: scheme.name ?? "X-API-Key", value: "{{apiKey}}" };
      return null;
    default:
      return null;
  }
}

function authToQuery(auth: Auth): NameValue | null {
  const scheme = auth.schemes[0];
  if (scheme?.type === "apiKey" && scheme.location === "query") {
    return { name: scheme.name ?? "api_key", value: "{{apiKey}}" };
  }
  return null;
}

function signature(v: RequestVariant): string {
  return JSON.stringify([
    v.method,
    v.routeTemplate,
    v.expectedStatus,
    v.pathParams,
    v.query,
    v.headers,
    v.body ?? null,
  ]);
}

function dedupe(variants: RequestVariant[]): RequestVariant[] {
  const seen = new Set<string>();
  const out: RequestVariant[] = [];
  for (const v of variants) {
    const sig = signature(v);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(v);
  }
  return out;
}

function uniquifyNames(variants: RequestVariant[]): void {
  const counts = new Map<string, number>();
  for (const v of variants) {
    const n = counts.get(v.name) ?? 0;
    counts.set(v.name, n + 1);
    if (n > 0) v.name = `${v.name} (${n + 1})`;
  }
}
