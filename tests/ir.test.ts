import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  validateIr,
  parseIr,
  irJsonSchema,
  isCompatibleIrVersion,
  IR_VERSION,
  type Ir,
} from "../src/ir/index";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const fixture = (name: string) =>
  readFileSync(path.join(here, "fixtures", "ir", name), "utf8");

const validJson = fixture("valid-petstore.json");
const valid = JSON.parse(validJson) as Ir;

describe("validateIr", () => {
  it("accepts a well-formed IR document", () => {
    const r = validateIr(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.endpoints).toHaveLength(2);
      expect(r.data.endpoints[0]?.method).toBe("GET");
    }
  });

  it("fills defaults (diagnostics, basePaths, severity)", () => {
    const r = validateIr({
      irVersion: IR_VERSION,
      service: { name: "X" },
      endpoints: [],
      meta: { analyzerVersion: "0.1.0", mode: "static", generatedAt: "t" },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.diagnostics).toEqual([]);
      expect(r.data.service.basePaths).toEqual([]);
    }
  });

  it.each([
    ["missing method", { ...valid, endpoints: [{ ...valid.endpoints[0], method: undefined }] }],
    ["bad http status", { ...valid, endpoints: [{ ...valid.endpoints[0], responses: [{ status: 700 }] }] }],
    ["empty endpoint id", { ...valid, endpoints: [{ ...valid.endpoints[0], id: "" }] }],
    ["bad param location", {
      ...valid,
      endpoints: [{ ...valid.endpoints[0], params: [{ name: "x", in: "body", required: true, schema: {} }] }],
    }],
  ])("rejects %s", (_label, bad) => {
    expect(validateIr(bad).success).toBe(false);
  });
});

describe("parseIr", () => {
  it("parses valid IR JSON", () => {
    expect(parseIr(validJson).service.name).toBe("PetStore");
  });

  it("throws a readable error on non-JSON", () => {
    expect(() => parseIr("{not json")).toThrow(/not valid JSON/);
  });

  it("throws a readable error on schema-invalid JSON", () => {
    expect(() => parseIr('{"irVersion":"0.1.0"}')).toThrow(/Invalid reqweave IR/);
  });
});

describe("isCompatibleIrVersion", () => {
  it("accepts the current version", () => {
    expect(isCompatibleIrVersion(IR_VERSION)).toBe(true);
  });
  it("rejects a different 0.x minor and a different major", () => {
    expect(isCompatibleIrVersion("0.2.0")).toBe(false);
    expect(isCompatibleIrVersion("1.0.0")).toBe(false);
    expect(isCompatibleIrVersion("garbage")).toBe(false);
  });
});

describe("irJsonSchema", () => {
  it("is a draft-2020-12 JSON-Schema", () => {
    const s = irJsonSchema();
    expect(s["$schema"]).toContain("2020-12");
    expect(s["type"]).toBe("object");
  });

  it("is deterministic across calls", () => {
    expect(irJsonSchema()).toEqual(irJsonSchema());
  });

  it("matches the committed schema/reqweave-ir.schema.json (drift guard)", () => {
    const committed = JSON.parse(
      readFileSync(path.join(root, "schema", "reqweave-ir.schema.json"), "utf8"),
    );
    expect(irJsonSchema()).toEqual(committed);
  });
});
