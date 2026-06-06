/**
 * Import an OpenAPI 3.x document into the reqweave Universal IR. Reusable beyond
 * build-mode: lets reqweave consume ANY OpenAPI doc (`--openapi <file>`),
 * independent of the .NET analyzer.
 *
 * OpenAPI traversal is inherently dynamic, so the document is treated loosely;
 * the produced IR is validated against the zod schema before return.
 */
import { IR_VERSION, validateIr, type Ir, type Endpoint, type Param, type ApiResponse, type AuthScheme, type JsonSchemaNode } from "./index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_DEPTH = 64;

export interface ImportOptions {
  serviceName?: string;
  generatedAt?: string;
}

export function importOpenApi(doc: unknown, opts: ImportOptions = {}): Ir {
  const d = (doc ?? {}) as Json;
  if (typeof d !== "object" || (!d.openapi && !d.swagger)) {
    throw new Error("not an OpenAPI document (missing 'openapi'/'swagger')");
  }

  const components = (d.components?.schemas ?? {}) as Record<string, Json>;
  const securitySchemes = (d.components?.securitySchemes ?? {}) as Record<string, Json>;
  const deref = makeDeref(components);

  const endpoints: Endpoint[] = [];
  const paths = (d.paths ?? {}) as Record<string, Json>;
  for (const route of Object.keys(paths)) {
    if (UNSAFE_KEYS.has(route)) continue;
    const pathItem = paths[route] as Json;
    const pathParams = (pathItem.parameters ?? []) as Json[];
    for (const method of Object.keys(pathItem)) {
      if (!METHODS.has(method.toLowerCase())) continue;
      const op = pathItem[method] as Json;
      endpoints.push(buildEndpoint(route, method.toUpperCase(), op, pathParams, deref, securitySchemes, d.security));
    }
  }

  endpoints.sort((a, b) => {
    const r = a.routeTemplate < b.routeTemplate ? -1 : a.routeTemplate > b.routeTemplate ? 1 : 0;
    return r !== 0 ? r : a.method < b.method ? -1 : a.method > b.method ? 1 : 0;
  });

  const ir: Ir = {
    irVersion: IR_VERSION,
    service: {
      name: opts.serviceName ?? d.info?.title ?? "service",
      basePaths: [],
      ...(Array.isArray(d.servers) && d.servers.length > 0
        ? { servers: d.servers.map((s: Json) => String(s.url)).filter(Boolean) }
        : {}),
    },
    endpoints,
    diagnostics: [],
    meta: {
      analyzerVersion: "openapi-import",
      mode: "build",
      generatedAt: opts.generatedAt ?? "1970-01-01T00:00:00Z",
    },
  };

  const result = validateIr(ir);
  if (!result.success) {
    throw new Error("imported OpenAPI did not produce valid IR");
  }
  return result.data;
}

function buildEndpoint(
  route: string,
  method: string,
  op: Json,
  inheritedParams: Json[],
  deref: (s: Json, depth: number) => JsonSchemaNode,
  securitySchemes: Record<string, Json>,
  topSecurity: Json,
): Endpoint {
  const rawParams = [...inheritedParams, ...((op.parameters ?? []) as Json[])];
  const params: Param[] = rawParams
    .map((p) => deref0(p))
    .filter((p) => p && typeof p === "object" && p.name && p.in)
    .map((p): Param => ({
      name: String(p.name),
      in: p.in === "path" ? "route" : (p.in as Param["in"]),
      required: p.in === "path" ? true : Boolean(p.required),
      schema: p.schema ? deref(p.schema, 0) : {},
      ...(p.description ? { description: String(p.description) } : {}),
    }))
    .filter((p) => p.in === "route" || p.in === "query" || p.in === "header");

  const responses: ApiResponse[] = Object.entries((op.responses ?? {}) as Record<string, Json>)
    .map(([code, r]): ApiResponse | null => {
      const status = code === "default" ? 200 : Number.parseInt(code, 10);
      if (!Number.isInteger(status) || status < 100 || status > 599) return null;
      const media = firstJsonMedia(r.content);
      return {
        status,
        ...(r.description ? { description: String(r.description) } : {}),
        ...(media ? { contentType: media.type, ...(media.schema ? { schema: deref(media.schema, 0) } : {}) } : {}),
      };
    })
    .filter((r): r is ApiResponse => r !== null)
    .sort((a, b) => a.status - b.status);
  if (responses.length === 0) responses.push({ status: 200 });

  const security = op.security ?? topSecurity;
  const auth = buildAuth(security, securitySchemes);

  const endpoint: Endpoint = {
    id: String(op.operationId || `${method.toLowerCase()}_${slug(route)}`),
    method: method as Endpoint["method"],
    routeTemplate: route.startsWith("/") ? route : `/${route}`,
    params,
    responses,
    auth,
    ...(op.operationId ? { operationId: String(op.operationId) } : {}),
    ...(op.summary ? { summary: String(op.summary) } : {}),
    ...(Array.isArray(op.tags) && op.tags.length > 0 ? { tags: op.tags.map(String) } : {}),
    ...(op.deprecated ? { deprecated: true } : {}),
  };

  const reqBody = deref0(op.requestBody);
  const bodyMedia = reqBody ? firstJsonMedia(reqBody.content) : null;
  if (bodyMedia) {
    endpoint.requestBody = {
      required: Boolean(reqBody.required),
      contentType: bodyMedia.type,
      schema: bodyMedia.schema ? deref(bodyMedia.schema, 0) : {},
    };
  }

  return endpoint;
}

function buildAuth(security: Json, schemes: Record<string, Json>): Endpoint["auth"] {
  if (!Array.isArray(security) || security.length === 0) {
    return { required: false, schemes: [{ type: "none" }] };
  }
  const out: AuthScheme[] = [];
  for (const requirement of security) {
    for (const name of Object.keys(requirement ?? {})) {
      const s = schemes[name];
      const mapped = mapSecurityScheme(s);
      if (mapped) out.push(mapped);
    }
  }
  return out.length > 0
    ? { required: true, schemes: dedupeByType(out) }
    : { required: true, schemes: [{ type: "bearer", location: "header", name: "Authorization" }] };
}

function mapSecurityScheme(s: Json): AuthScheme | null {
  if (!s || typeof s !== "object") return null;
  if (s.type === "http" && String(s.scheme).toLowerCase() === "bearer") {
    return { type: "bearer", location: "header", name: "Authorization" };
  }
  if (s.type === "http" && String(s.scheme).toLowerCase() === "basic") return { type: "basic" };
  if (s.type === "apiKey") return { type: "apiKey", location: (s.in as AuthScheme["location"]) ?? "header", name: s.name ?? "X-API-Key" };
  if (s.type === "oauth2" || s.type === "openIdConnect") return { type: "oauth2" };
  return null;
}

function makeDeref(components: Record<string, Json>): (s: Json, depth: number) => JsonSchemaNode {
  const deref = (schema: Json, depth: number): JsonSchemaNode => {
    if (!schema || typeof schema !== "object" || depth > MAX_DEPTH) return {};
    if (typeof schema.$ref === "string") {
      const name = schema.$ref.replace("#/components/schemas/", "");
      const target = components[name];
      return target ? deref(target, depth + 1) : {};
    }
    const out: JsonSchemaNode = {};
    for (const [k, v] of Object.entries(schema)) {
      if (UNSAFE_KEYS.has(k)) continue;
      if (k === "properties" && v && typeof v === "object") {
        const props: Record<string, JsonSchemaNode> = {};
        for (const [pk, pv] of Object.entries(v as Record<string, Json>)) {
          if (!UNSAFE_KEYS.has(pk)) props[pk] = deref(pv, depth + 1);
        }
        out.properties = props;
      } else if (k === "items" && v) {
        out.items = deref(v, depth + 1);
      } else if ((k === "oneOf" || k === "anyOf" || k === "allOf") && Array.isArray(v)) {
        (out as Record<string, unknown>)[k] = v.map((x) => deref(x, depth + 1));
      } else {
        (out as Record<string, unknown>)[k] = v;
      }
    }
    return out;
  };
  return deref;
}

function deref0(x: Json): Json {
  return x; // $ref on parameters/requestBody is uncommon; schemas are dereffed via makeDeref
}

function firstJsonMedia(content: Json): { type: string; schema: Json } | null {
  if (!content || typeof content !== "object") return null;
  const keys = Object.keys(content);
  const jsonKey = keys.find((k) => k.includes("json")) ?? keys[0];
  if (!jsonKey) return null;
  return { type: jsonKey, schema: content[jsonKey]?.schema };
}

function dedupeByType(schemes: AuthScheme[]): AuthScheme[] {
  const seen = new Set<string>();
  return schemes.filter((s) => (seen.has(s.type) ? false : (seen.add(s.type), true)));
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-/, "").replace(/-$/, "") || "root";
}
