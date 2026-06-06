import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { importOpenApi, validateIr } from "../src/ir/index";

const here = path.dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(readFileSync(path.join(here, "fixtures", "openapi", "petstore.openapi.json"), "utf8"));
const ir = importOpenApi(doc, { generatedAt: "2026-01-01T00:00:00Z" });

const ep = (id: string) => ir.endpoints.find((e) => e.id === id)!;

describe("importOpenApi", () => {
  it("produces valid IR with both operations", () => {
    expect(validateIr(ir).success).toBe(true);
    expect(ir.service.name).toBe("PetStore");
    expect(ir.endpoints).toHaveLength(2);
  });

  it("maps params (path→route) and resolves $ref response schemas", () => {
    const get = ep("getPet");
    expect(get.method).toBe("GET");
    expect(get.routeTemplate).toBe("/pets/{id}");

    const id = get.params.find((p) => p.name === "id")!;
    expect(id.in).toBe("route");
    expect(id.required).toBe(true);

    const expand = get.params.find((p) => p.name === "expand")!;
    expect(expand.in).toBe("query");
    expect(expand.required).toBe(false);

    const ok = get.responses.find((r) => r.status === 200)!;
    expect(ok.schema!.properties!.name).toBeDefined(); // $ref → Pet resolved
    expect(get.responses.map((r) => r.status)).toContain(404);
  });

  it("maps security to bearer; absent security → not required", () => {
    expect(ep("getPet").auth.required).toBe(true);
    expect(ep("getPet").auth.schemes[0]!.type).toBe("bearer");
    expect(ep("createPet").auth.required).toBe(false);
  });

  it("imports a required request body with a resolved schema", () => {
    const post = ep("createPet");
    expect(post.requestBody!.required).toBe(true);
    expect(post.requestBody!.schema.properties!.name).toBeDefined();
  });

  it("rejects a non-OpenAPI document", () => {
    expect(() => importOpenApi({ foo: "bar" })).toThrow(/not an OpenAPI/);
  });
});
