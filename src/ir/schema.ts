/**
 * reqweave Universal IR — the tool-agnostic contract every analyzer emits and
 * every exporter consumes. This is the keystone; keep it stable and versioned.
 *
 * Defined with zod so we get runtime validation, static types, and a generated
 * JSON-Schema from one source of truth.
 */
import { z } from "zod";

/** IR schema version. Bump on any breaking change to this shape. Kept in sync
 * with the .NET analyzer's AnalyzerInfo.IrVersion (freshness CI guards this). */
export const IR_VERSION = "0.1.0" as const;

export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

export const PARAM_LOCATIONS = ["route", "query", "header", "cookie"] as const;

export const AUTH_TYPES = ["bearer", "apiKey", "basic", "oauth2", "none"] as const;

export const DIAGNOSTIC_CODES = [
  "unresolvedType",
  "ambiguousRoute",
  "assumedConvention",
  "unsupportedFeature",
] as const;

/**
 * A JSON-Schema-ish node describing a parameter or body shape. Intentionally a
 * pragmatic subset (the bits analyzers can produce and exporters consume),
 * recursive, and tolerant of extra keys so richer analyzers can attach detail.
 */
export type JsonSchemaNode = {
  type?: "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";
  format?: string;
  enum?: unknown[];
  const?: unknown;
  items?: JsonSchemaNode;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  nullable?: boolean;
  oneOf?: JsonSchemaNode[];
  anyOf?: JsonSchemaNode[];
  allOf?: JsonSchemaNode[];
  $ref?: string;
  description?: string;
  example?: unknown;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  [k: string]: unknown;
};

export const jsonSchemaNode: z.ZodType<JsonSchemaNode> = z.lazy(() =>
  z
    .object({
      type: z
        .enum(["string", "number", "integer", "boolean", "object", "array", "null"])
        .optional(),
      format: z.string().optional(),
      enum: z.array(z.unknown()).optional(),
      const: z.unknown().optional(),
      items: jsonSchemaNode.optional(),
      properties: z.record(z.string(), jsonSchemaNode).optional(),
      required: z.array(z.string()).optional(),
      nullable: z.boolean().optional(),
      oneOf: z.array(jsonSchemaNode).optional(),
      anyOf: z.array(jsonSchemaNode).optional(),
      allOf: z.array(jsonSchemaNode).optional(),
      $ref: z.string().optional(),
      description: z.string().optional(),
      example: z.unknown().optional(),
      default: z.unknown().optional(),
      minimum: z.number().optional(),
      maximum: z.number().optional(),
      minLength: z.number().int().nonnegative().optional(),
      maxLength: z.number().int().nonnegative().optional(),
      pattern: z.string().optional(),
    })
    .catchall(z.unknown()),
);

export const paramSchema = z.object({
  name: z.string().min(1),
  in: z.enum(PARAM_LOCATIONS),
  required: z.boolean(),
  schema: jsonSchemaNode,
  description: z.string().optional(),
  example: z.unknown().optional(),
});

export const requestBodySchema = z.object({
  required: z.boolean(),
  contentType: z.string().min(1),
  schema: jsonSchemaNode,
  examples: z.array(z.unknown()).optional(),
});

export const responseSchema = z.object({
  status: z.number().int().min(100).max(599),
  description: z.string().optional(),
  contentType: z.string().optional(),
  schema: jsonSchemaNode.optional(),
});

export const authSchemeSchema = z.object({
  type: z.enum(AUTH_TYPES),
  location: z.enum(["header", "query", "cookie"]).optional(),
  name: z.string().optional(),
  scopes: z.array(z.string()).optional(),
});

export const authSchema = z.object({
  required: z.boolean(),
  schemes: z.array(authSchemeSchema),
});

export const endpointSchema = z.object({
  id: z.string().min(1),
  method: z.enum(HTTP_METHODS),
  routeTemplate: z.string().min(1),
  operationId: z.string().optional(),
  summary: z.string().optional(),
  tags: z.array(z.string()).optional(),
  deprecated: z.boolean().optional(),
  params: z.array(paramSchema),
  requestBody: requestBodySchema.optional(),
  responses: z.array(responseSchema),
  auth: authSchema,
});

export const diagnosticSchema = z.object({
  code: z.enum(DIAGNOSTIC_CODES),
  message: z.string(),
  endpointId: z.string().optional(),
  severity: z.enum(["info", "warning", "error"]).default("warning"),
});

export const metaSchema = z.object({
  analyzerVersion: z.string(),
  mode: z.enum(["static", "build"]),
  sourceCommit: z.string().optional(),
  /** ISO-8601. Injected by the caller, never derived inside generation, so
   * output stays deterministic across runs. */
  generatedAt: z.string(),
});

export const serviceSchema = z.object({
  name: z.string().min(1),
  basePaths: z.array(z.string()).default([]),
  versions: z.array(z.string()).optional(),
  servers: z.array(z.string()).optional(),
});

export const irSchema = z.object({
  irVersion: z.string(),
  service: serviceSchema,
  endpoints: z.array(endpointSchema),
  diagnostics: z.array(diagnosticSchema).default([]),
  meta: metaSchema,
});

export type Param = z.infer<typeof paramSchema>;
export type RequestBody = z.infer<typeof requestBodySchema>;
export type ApiResponse = z.infer<typeof responseSchema>;
export type AuthScheme = z.infer<typeof authSchemeSchema>;
export type Auth = z.infer<typeof authSchema>;
export type Endpoint = z.infer<typeof endpointSchema>;
export type Diagnostic = z.infer<typeof diagnosticSchema>;
export type Meta = z.infer<typeof metaSchema>;
export type Service = z.infer<typeof serviceSchema>;
export type Ir = z.infer<typeof irSchema>;
