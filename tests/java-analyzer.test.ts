import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { analyzeJava } from "../src/analyzers/java/index";
import { validateIr, type Endpoint } from "../src/ir/index";

const here = path.dirname(fileURLToPath(import.meta.url));
const javaDir = path.join(here, "fixtures", "java");

describe("Java analyzer — Spring Boot", () => {
  const ir = analyzeJava(javaDir, { service: "petstore", generatedAt: "2026-01-01T00:00:00Z" });
  const ep = (id: string): Endpoint => ir.endpoints.find((e) => e.id === id)!;

  it("produces valid IR with the java-analyzer meta", () => {
    expect(validateIr(ir).success).toBe(true);
    expect(ir.meta.analyzerVersion).toMatch(/^java-analyzer/);
    expect(ir.service.name).toBe("petstore");
  });

  it("joins @RequestMapping base with method mappings", () => {
    expect(ir.endpoints.map((e) => `${e.method} ${e.routeTemplate}`).sort()).toEqual([
      "GET /pets",
      "GET /pets/{id}",
      "POST /pets",
    ]);
  });

  it("maps @PathVariable + @RequestParam and a record response (enum + list)", () => {
    const g = ep("PetController.getById");
    expect(g.params.find((p) => p.in === "route" && p.name === "id")?.schema).toEqual({ type: "integer" });
    const expand = g.params.find((p) => p.in === "query" && p.name === "expand");
    expect(expand?.required).toBe(false);
    const schema = g.responses[0]?.schema;
    expect(schema?.properties?.name).toEqual({ type: "string" });
    expect(schema?.properties?.status?.enum).toEqual(["AVAILABLE", "PENDING", "SOLD"]);
    expect(schema?.properties?.tags).toEqual({ type: "array", items: { type: "string" } });
  });

  it("treats List<Pet> return as an array and a required @RequestParam as required", () => {
    const l = ep("PetController.list");
    expect(l.responses[0]?.schema?.type).toBe("array");
    expect(l.params.find((p) => p.name === "limit")?.required).toBe(true);
    expect(l.params.find((p) => p.name === "status")?.required).toBe(false);
  });

  it("resolves @RequestBody (with @NotNull required), @ResponseStatus, and @PreAuthorize auth", () => {
    const c = ep("PetController.create");
    expect(c.responses[0]?.status).toBe(201);
    expect(c.requestBody?.contentType).toBe("application/json");
    expect(c.requestBody?.schema?.required).toEqual(["name"]);
    expect(c.requestBody?.schema?.properties?.weightKg).toEqual({ type: "number" });
    expect(c.auth).toEqual({ required: true, schemes: [{ type: "bearer", location: "header", name: "Authorization" }] });
  });

  it("is deterministic", () => {
    const again = analyzeJava(javaDir, { service: "petstore", generatedAt: "2026-01-01T00:00:00Z" });
    expect(JSON.stringify(again)).toBe(JSON.stringify(ir));
  });
});
