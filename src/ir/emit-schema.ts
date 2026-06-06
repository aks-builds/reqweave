/**
 * Writes the generated JSON-Schema for the IR to schema/reqweave-ir.schema.json.
 * Run via `npm run ir:schema` (builds first). A test asserts the committed file
 * matches what zod generates, so the schema never drifts from the code.
 *
 * Uses __dirname (CommonJS) deliberately: the package emits CJS, so import.meta
 * is unavailable at runtime here.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { irJsonSchema } from "./index.js";

const repoRoot = resolve(__dirname, "..", "..");
const outFile = resolve(repoRoot, "schema", "reqweave-ir.schema.json");

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(irJsonSchema(), null, 2)}\n`, "utf8");
// eslint-disable-next-line no-console
console.log(`wrote ${outFile}`);
