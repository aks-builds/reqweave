import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parseIr } from "../src/ir/index";
import { generateAll, generateVariants, pairwise } from "../src/variants/index";
import type { Ir } from "../src/ir/index";

const here = path.dirname(fileURLToPath(import.meta.url));
const ir: Ir = parseIr(
  readFileSync(path.join(here, "fixtures", "ir", "valid-petstore.json"), "utf8"),
);

const ep = (id: string) => ir.endpoints.find((e) => e.id === id)!;

describe("depth tiers", () => {
  it("minimal produces exactly one happy-path variant per endpoint", () => {
    const { variants } = generateVariants(ep("getPetById"), { depth: "minimal" });
    expect(variants).toHaveLength(1);
    expect(variants[0]!.provenance).toContain("required-only");
    expect(variants[0]!.expectedStatus).toBe(200);
  });

  it("standard adds error + boundary + optional variants", () => {
    const names = generateVariants(ep("getPetById"), { depth: "standard" }).variants.map((v) => v.name);
    expect(names).toContain("happy path");
    expect(names).toContain("unauthorized"); // auth required -> 401 variant
    expect(names).toContain("not found"); // 404 declared + route param
    expect(names).toContain("all optional populated"); // expand is optional
  });

  it("emits distinct min/max boundary variants for a two-sided bounded param", () => {
    const bounded = {
      id: "search",
      method: "GET",
      routeTemplate: "/search",
      params: [
        { name: "limit", in: "query", required: true, schema: { type: "integer", minimum: 1, maximum: 100 } },
      ],
      responses: [{ status: 200 }],
      auth: { required: false, schemes: [{ type: "none" }] },
    } as unknown as Ir["endpoints"][number];

    const names = generateVariants(bounded, { depth: "standard" }).variants.map((v) => v.name);
    expect(names.some((n) => n.includes("minimum"))).toBe(true);
    expect(names.some((n) => n.includes("maximum"))).toBe(true);
  });

  it("exhaustive produces at least as many variants as standard", () => {
    const std = generateVariants(ep("getPetById"), { depth: "standard" }).variants.length;
    const exh = generateVariants(ep("getPetById"), { depth: "exhaustive" }).variants.length;
    expect(exh).toBeGreaterThanOrEqual(std);
  });
});

describe("auth handling", () => {
  it("includes a Bearer placeholder header on the happy path", () => {
    const happy = generateVariants(ep("getPetById"), { depth: "minimal" }).variants[0]!;
    const auth = happy.headers.find((h) => h.name === "Authorization");
    expect(auth?.value).toBe("Bearer {{bearerToken}}");
  });

  it("omits auth on the unauthorized variant and expects 401", () => {
    const v = generateVariants(ep("getPetById"), { depth: "standard" }).variants.find(
      (x) => x.name === "unauthorized",
    )!;
    expect(v.headers.find((h) => h.name === "Authorization")).toBeUndefined();
    expect(v.expectedStatus).toBe(401);
  });

  it("never embeds a real secret (placeholders only)", () => {
    const all = generateAll(ir, { depth: "exhaustive" }).variants;
    const blob = JSON.stringify(all);
    expect(blob).not.toMatch(/Bearer [A-Za-z0-9]{8,}/); // only "Bearer {{bearerToken}}"
    expect(blob).toContain("{{bearerToken}}");
  });
});

describe("body variants", () => {
  it("happy path body has the required field; invalid body omits it", () => {
    const vs = generateVariants(ep("createPet"), { depth: "standard" }).variants;
    const happy = vs.find((v) => v.name === "happy path")!;
    expect((happy.body!.value as Record<string, unknown>).name).toBeDefined();

    const invalid = vs.find((v) => v.provenance.includes("invalid-input"))!;
    expect((invalid.body!.value as Record<string, unknown>).name).toBeUndefined();
    expect(invalid.expectedStatus).toBe(400);
  });

  it("uses the declared success status (201 for createPet)", () => {
    const happy = generateVariants(ep("createPet"), { depth: "minimal" }).variants[0]!;
    expect(happy.expectedStatus).toBe(201);
  });
});

describe("determinism & caps", () => {
  it("is byte-stable across runs", () => {
    const a = JSON.stringify(generateAll(ir, { depth: "exhaustive" }));
    const b = JSON.stringify(generateAll(ir, { depth: "exhaustive" }));
    expect(a).toBe(b);
  });

  it("respects the per-endpoint cap", () => {
    for (const e of ir.endpoints) {
      expect(generateVariants(e, { depth: "exhaustive" }).variants.length).toBeLessThanOrEqual(64);
    }
  });

  it("gives every variant a unique name within an endpoint", () => {
    const names = generateVariants(ep("getPetById"), { depth: "exhaustive" }).variants.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("pairwise covering array", () => {
  it("covers every pair of values across three parameters", () => {
    const params = [
      { name: "a", values: [1, 2] },
      { name: "b", values: ["x", "y"] },
      { name: "c", values: [true, false] },
    ];
    const cases = pairwise(params);

    for (let i = 0; i < params.length; i++) {
      for (let j = i + 1; j < params.length; j++) {
        const pi = params[i]!;
        const pj = params[j]!;
        for (const vi of pi.values) {
          for (const vj of pj.values) {
            const covered = cases.some((c) => c[pi.name] === vi && c[pj.name] === vj);
            expect(covered, `pair ${pi.name}=${vi}, ${pj.name}=${vj}`).toBe(true);
          }
        }
      }
    }
    // Far fewer than the full product (2*2*2 = 8).
    expect(cases.length).toBeLessThan(8);
  });
});
