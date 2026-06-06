import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { analyzePython } from "../src/analyzers/python/index";
import { validateIr, type Endpoint } from "../src/ir/index";

const here = path.dirname(fileURLToPath(import.meta.url));
const fastapiDir = path.join(here, "fixtures", "py", "fastapi");
const flaskDir = path.join(here, "fixtures", "py", "flask");

describe("Python analyzer — FastAPI", () => {
  const ir = analyzePython(fastapiDir, { service: "petstore", generatedAt: "2026-01-01T00:00:00Z" });
  const ep = (id: string): Endpoint => ir.endpoints.find((e) => e.id === id)!;

  it("produces valid IR with the py-analyzer meta", () => {
    expect(validateIr(ir).success).toBe(true);
    expect(ir.meta.analyzerVersion).toMatch(/^py-analyzer/);
    expect(ir.service.name).toBe("petstore");
  });

  it("finds the three routes (app + router)", () => {
    expect(ir.endpoints.map((e) => `${e.method} ${e.routeTemplate}`).sort()).toEqual([
      "GET /pets",
      "GET /pets/{pet_id}",
      "POST /pets",
    ]);
  });

  it("maps a path param + a Query() param and a response_model (Pydantic + enum)", () => {
    const g = ep("get_pet");
    expect(g.params.find((p) => p.in === "route" && p.name === "pet_id")?.schema).toEqual({ type: "integer" });
    expect(g.params.some((p) => p.in === "query" && p.name === "expand")).toBe(true);
    expect(g.responses[0]?.status).toBe(200);
    expect(g.responses[0]?.schema?.properties?.name).toEqual({ type: "string" });
    expect(g.responses[0]?.schema?.properties?.status?.enum).toContain("available");
  });

  it("treats scalar params as query and a List[Pet] response_model as an array", () => {
    const l = ep("list_pets");
    expect(l.params.filter((p) => p.in === "query").map((p) => p.name).sort()).toEqual(["limit", "status"]);
    expect(l.responses[0]?.schema?.type).toBe("array");
    expect(l.responses[0]?.schema?.items?.properties?.id).toEqual({ type: "integer" });
  });

  it("resolves a Pydantic model body, status_code, tags, and Depends() auth", () => {
    const c = ep("create_pet");
    expect(c.responses[0]?.status).toBe(201);
    expect(c.requestBody?.contentType).toBe("application/json");
    expect(c.requestBody?.schema?.required).toContain("name");
    expect(c.requestBody?.schema?.properties?.weight_kg?.nullable).toBe(true);
    expect(c.tags).toEqual(["pets"]);
    expect(c.auth).toEqual({ required: true, schemes: [{ type: "bearer", location: "header", name: "Authorization" }] });
    // the Depends() param must NOT leak in as a query param
    expect(c.params.some((p) => p.name === "user")).toBe(false);
  });

  it("is deterministic", () => {
    const again = analyzePython(fastapiDir, { service: "petstore", generatedAt: "2026-01-01T00:00:00Z" });
    expect(JSON.stringify(again)).toBe(JSON.stringify(ir));
  });
});

describe("Python analyzer — Flask", () => {
  const ir = analyzePython(flaskDir, { generatedAt: "2026-01-01T00:00:00Z" });

  it("produces valid IR and finds route + method-list + 2.0-style routes", () => {
    expect(validateIr(ir).success).toBe(true);
    const keys = ir.endpoints.map((e) => `${e.method} ${e.routeTemplate}`).sort();
    expect(keys).toContain("GET /widgets/{widget_id}");
    expect(keys).toContain("GET /widgets");
    expect(keys).toContain("POST /widgets");
    expect(keys).toContain("GET /health");
  });

  it("maps <int:id> path params and best-effort query/body", () => {
    const g = ir.endpoints.find((e) => e.method === "GET" && e.routeTemplate === "/widgets/{widget_id}")!;
    expect(g.params.some((p) => p.in === "route" && p.name === "widget_id")).toBe(true);
    const post = ir.endpoints.find((e) => e.method === "POST" && e.routeTemplate === "/widgets")!;
    expect(post.requestBody?.contentType).toBe("application/json");
    const get = ir.endpoints.find((e) => e.method === "GET" && e.routeTemplate === "/widgets")!;
    expect(get.params.some((p) => p.in === "query" && p.name === "sort")).toBe(true);
  });
});
