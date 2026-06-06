/**
 * IR public API: validation, parsing, and JSON-Schema generation.
 */
import { z } from "zod";
import { irSchema, IR_VERSION, type Ir } from "./schema.js";

export * from "./schema.js";
export { importOpenApi, type ImportOptions } from "./openapi-import.js";
export { reconcile } from "./reconcile.js";

export type ValidateResult =
  | { success: true; data: Ir }
  | { success: false; error: z.ZodError };

/** Validate an unknown value against the IR schema (no throw). */
export function validateIr(data: unknown): ValidateResult {
  const r = irSchema.safeParse(data);
  return r.success
    ? { success: true, data: r.data }
    : { success: false, error: r.error };
}

/** Parse + validate IR JSON text. Throws a readable error on invalid input. */
export function parseIr(json: string): Ir {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new Error(`reqweave IR is not valid JSON: ${(e as Error).message}`);
  }
  const r = irSchema.safeParse(raw);
  if (!r.success) {
    throw new Error(`Invalid reqweave IR:\n${z.prettifyError(r.error)}`);
  }
  if (!isCompatibleIrVersion(r.data.irVersion)) {
    throw new Error(
      `reqweave IR version "${r.data.irVersion}" is not compatible with this build (expects ${IR_VERSION}). ` +
        `Regenerate the IR with a matching analyzer.`,
    );
  }
  return r.data;
}

/** True when `version` is compatible with the IR this build speaks (same major;
 * pre-1.0 requires an exact minor match since 0.x minors may break). */
export function isCompatibleIrVersion(version: string): boolean {
  const parse = (v: string) => v.split(".").map((n) => Number.parseInt(n, 10));
  const [maj, min] = parse(version);
  const [curMaj, curMin] = parse(IR_VERSION);
  if (maj === undefined || min === undefined) return false;
  if (maj !== curMaj) return false;
  return curMaj === 0 ? min === curMin : true;
}

/** The IR as a JSON-Schema document (draft 2020-12), generated from zod. */
export function irJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(irSchema, { target: "draft-2020-12" }) as Record<
    string,
    unknown
  >;
}
