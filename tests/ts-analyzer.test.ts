import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { analyzeTypeScript } from "../src/analyzers/ts/index";
import { validateIr, type Endpoint } from "../src/ir/index";

const here = path.dirname(fileURLToPath(import.meta.url));
const nestDir = path.join(here, "fixtures", "ts", "nestjs");
const expressDir = path.join(here, "fixtures", "ts", "express");

describe("TS analyzer — NestJS", () => {
  const ir = analyzeTypeScript(nestDir, { service: "petstore", generatedAt: "2026-01-01T00:00:00Z" });
  const ep = (id: string): Endpoint => ir.endpoints.find((e) => e.id === id)!;

  it("produces valid IR with the ts-analyzer meta", () => {
    expect(validateIr(ir).success).toBe(true);
    expect(ir.meta.analyzerVersion).toMatch(/^ts-analyzer/);
    expect(ir.meta.mode).toBe("static");
    expect(ir.service.name).toBe("petstore");
  });

  it("finds the three controller routes (base path joined)", () => {
    expect(ir.endpoints.map((e) => `${e.method} ${e.routeTemplate}`).sort()).toEqual([
      "GET /pets",
      "GET /pets/{id}",
      "POST /pets",
    ]);
  });

  it("maps a route param and resolves a typed response (Promise unwrap + enum)", () => {
    const g = ep("PetsController.getById");
    expect(g.params.some((p) => p.in === "route" && p.name === "id")).toBe(true);
    expect(g.responses[0]?.status).toBe(200);
    expect(g.responses[0]?.schema?.properties?.name).toEqual({ type: "string" });
    expect(g.responses[0]?.schema?.properties?.status?.enum).toContain("available");
  });

  it("maps named query params", () => {
    const l = ep("PetsController.list");
    const names = l.params.filter((p) => p.in === "query").map((p) => p.name).sort();
    expect(names).toEqual(["limit", "status"]);
  });

  it("maps @Body to a resolved request body and @HttpCode(201)", () => {
    const c = ep("PetsController.create");
    expect(c.responses[0]?.status).toBe(201);
    expect(c.requestBody?.contentType).toBe("application/json");
    expect(c.requestBody?.schema?.properties?.weightKg).toEqual({ type: "number" });
    expect(c.requestBody?.schema?.required).toContain("name");
  });

  it("detects bearer auth from @ApiBearerAuth on the controller", () => {
    expect(ep("PetsController.create").auth).toEqual({
      required: true,
      schemes: [{ type: "bearer", location: "header", name: "Authorization" }],
    });
  });

  it("is deterministic (stable across runs)", () => {
    const again = analyzeTypeScript(nestDir, { service: "petstore", generatedAt: "2026-01-01T00:00:00Z" });
    expect(JSON.stringify(again)).toBe(JSON.stringify(ir));
  });
});

describe("TS analyzer — Express", () => {
  const ir = analyzeTypeScript(expressDir, { generatedAt: "2026-01-01T00:00:00Z" });

  it("produces valid IR and finds app + router routes", () => {
    expect(validateIr(ir).success).toBe(true);
    const keys = ir.endpoints.map((e) => `${e.method} ${e.routeTemplate}`);
    expect(keys).toContain("GET /health");
    expect(keys).toContain("GET /widgets/{id}");
    expect(keys).toContain("POST /widgets");
  });

  it("extracts :id route params", () => {
    const g = ir.endpoints.find((e) => e.method === "GET" && e.routeTemplate === "/widgets/{id}")!;
    expect(g.params.some((p) => p.in === "route" && p.name === "id")).toBe(true);
  });

  it("infers a generic JSON body and query usage for the POST (best-effort)", () => {
    const post = ir.endpoints.find((e) => e.method === "POST" && e.routeTemplate === "/widgets")!;
    expect(post.requestBody?.contentType).toBe("application/json");
    expect(post.params.some((p) => p.in === "query" && p.name === "sort")).toBe(true);
    expect(ir.diagnostics.some((d) => d.code === "assumedConvention")).toBe(true);
  });
});
