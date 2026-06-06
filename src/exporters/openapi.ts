import type { Exporter, ExportContext, ExportedFile } from "./types.js";
import type { AuthScheme, JsonSchemaNode } from "../ir/index.js";
import { stableStringify, slug } from "./util.js";

const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Created",
  204: "No Content",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  422: "Unprocessable Entity",
  500: "Internal Server Error",
};

/** IR schema -> OpenAPI 3.1 schema (convert `nullable` to a type union). */
/** Keys that would pollute Object.prototype if assigned dynamically. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const isSafeKey = (k: string): boolean => !UNSAFE_KEYS.has(k);

function cleanSchema(node: JsonSchemaNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "nullable" || !isSafeKey(k)) continue;
    if (k === "properties" && v && typeof v === "object") {
      out.properties = Object.fromEntries(
        Object.entries(v as Record<string, JsonSchemaNode>)
          .filter(([pk]) => isSafeKey(pk))
          .map(([pk, pv]) => [pk, cleanSchema(pv)]),
      );
    } else if (k === "items" && v) {
      out.items = cleanSchema(v as JsonSchemaNode);
    } else if ((k === "oneOf" || k === "anyOf" || k === "allOf") && Array.isArray(v)) {
      out[k] = v.map((x) => cleanSchema(x as JsonSchemaNode));
    } else if (k === "additionalProperties" && v && typeof v === "object") {
      out.additionalProperties = cleanSchema(v as JsonSchemaNode);
    } else {
      out[k] = v;
    }
  }
  if (node.nullable === true && typeof node.type === "string") {
    out.type = [node.type, "null"];
  }
  return out;
}

function schemeName(s: AuthScheme): string {
  switch (s.type) {
    case "bearer":
      return "bearerAuth";
    case "basic":
      return "basicAuth";
    case "apiKey":
      return "apiKeyAuth";
    default:
      return "auth";
  }
}

function toSecurityScheme(s: AuthScheme): Record<string, unknown> {
  switch (s.type) {
    case "bearer":
      return { type: "http", scheme: "bearer" };
    case "basic":
      return { type: "http", scheme: "basic" };
    case "apiKey":
      return { type: "apiKey", in: s.location ?? "header", name: s.name ?? "X-API-Key" };
    default:
      return { type: "http", scheme: "bearer" };
  }
}

export const openapiExporter: Exporter = {
  id: "openapi",
  label: "OpenAPI 3.1",
  export(ctx: ExportContext): ExportedFile[] {
    // Null-prototype maps: keys here come from source (route templates, methods,
    // scheme names), so a pathological name like "__proto__" must not pollute.
    const paths: Record<string, Record<string, unknown>> = Object.create(null);
    const securitySchemes: Record<string, unknown> = Object.create(null);

    for (const ep of ctx.ir.endpoints) {
      if (!isSafeKey(ep.routeTemplate) || !isSafeKey(ep.method.toLowerCase())) continue;
      const pathItem = (paths[ep.routeTemplate] ??= Object.create(null));

      const op: Record<string, unknown> = {
        operationId: ep.operationId ?? ep.id,
        summary: ep.summary,
        tags: ep.tags,
        parameters: ep.params
          .filter((p) => p.in !== "cookie")
          .map((p) => ({
            name: p.name,
            in: p.in === "route" ? "path" : p.in,
            required: p.in === "route" ? true : p.required,
            schema: cleanSchema(p.schema),
            description: p.description,
          })),
        responses: Object.fromEntries(
          ep.responses.map((r) => [
            String(r.status),
            {
              description: r.description ?? STATUS_TEXT[r.status] ?? "Response",
              ...(r.schema
                ? { content: { [r.contentType ?? "application/json"]: { schema: cleanSchema(r.schema) } } }
                : {}),
            },
          ]),
        ),
      };

      if (ep.requestBody) {
        op.requestBody = {
          required: ep.requestBody.required,
          content: { [ep.requestBody.contentType]: { schema: cleanSchema(ep.requestBody.schema) } },
        };
      }

      if (ep.auth.required && ep.auth.schemes[0]) {
        const name = schemeName(ep.auth.schemes[0]);
        securitySchemes[name] = toSecurityScheme(ep.auth.schemes[0]);
        op.security = [{ [name]: [] }];
      }

      pathItem[ep.method.toLowerCase()] = op;
    }

    const doc: Record<string, unknown> = {
      openapi: "3.1.0",
      info: { title: ctx.ir.service.name, version: ctx.ir.irVersion },
      servers: [{ url: ctx.options.baseUrl }],
      paths,
    };
    if (Object.keys(securitySchemes).length > 0) {
      doc.components = { securitySchemes };
    }

    return [{ path: `openapi/${slug(ctx.ir.service.name)}.openapi.json`, content: `${stableStringify(doc)}\n` }];
  },
};
