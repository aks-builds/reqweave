/**
 * Tool-agnostic assertion model. Computed once per variant from the IR, then
 * rendered into each tool's native test DSL by the exporters (with graceful
 * fallback where a tool can't express something — e.g. JSON-schema checks).
 */
import type { Ir, JsonSchemaNode } from "../ir/index.js";
import type { RequestVariant } from "../variants/index.js";

export interface AssertionSet {
  /** The status the request is expected to return. */
  status: number;
  /** Expected response content-type (media type only), if known. */
  contentType?: string;
  /** Response body schema to validate against (2xx with a declared schema only). */
  jsonSchema?: JsonSchemaNode;
}

/** Build the assertions for a variant by matching its expectedStatus to the endpoint's response. */
export function assertionsFor(ir: Ir, variant: RequestVariant): AssertionSet {
  const endpoint = ir.endpoints.find((e) => e.id === variant.endpointId);
  const response = endpoint?.responses.find((r) => r.status === variant.expectedStatus);

  const set: AssertionSet = { status: variant.expectedStatus };
  if (response?.contentType) {
    set.contentType = mediaType(response.contentType);
  }
  if (response?.schema && variant.expectedStatus >= 200 && variant.expectedStatus < 300) {
    set.jsonSchema = response.schema;
  }
  return set;
}

/** "application/json; charset=utf-8" -> "application/json". */
export function mediaType(contentType: string): string {
  return contentType.split(";")[0]?.trim() ?? contentType;
}
