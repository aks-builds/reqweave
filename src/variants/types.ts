/**
 * Request variants — the concrete, importable requests the engine derives from
 * each IR endpoint. Exporters (Phase 5) turn these into tool-specific files.
 *
 * Values use {{var}} placeholders ({{baseUrl}}, {{bearerToken}}, {{apiKey}}) —
 * a form every target tool understands — so secrets are never embedded.
 */
import type { Depth } from "../constants.js";

export type { Depth };

export interface NameValue {
  name: string;
  value: string;
}

export interface VariantBody {
  contentType: string;
  value: unknown;
}

export interface RequestVariant {
  endpointId: string;
  /** Human-readable, unique within the endpoint (e.g. "getById — unauthorized"). */
  name: string;
  method: string;
  /** Route template with {tokens}, e.g. "/pets/{id}". */
  routeTemplate: string;
  /** Route token -> concrete value. */
  pathParams: Record<string, string>;
  query: NameValue[];
  headers: NameValue[];
  body?: VariantBody;
  /** The status this variant is constructed to elicit. */
  expectedStatus: number;
  /** Which generation rules produced this variant (explainability). */
  provenance: string[];
}

export interface VariantOptions {
  depth: Depth;
}

export interface VariantResult {
  variants: RequestVariant[];
  /** Human-readable notes (e.g. "capped exhaustive variants for endpoint X"). */
  notes: string[];
}

/** Per-endpoint caps so collections stay importable, not bloated. */
export const DEPTH_CAPS: Record<Depth, number> = {
  minimal: 1,
  standard: 20,
  exhaustive: 64,
};
