import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parseIr, type Ir } from "../src/ir/index";
import { generateAll } from "../src/variants/index";
import { exportCollections, type ExportedFile } from "../src/exporters/index";
import { SUPPORTED_TOOLS, type SupportedTool } from "../src/constants";

const here = path.dirname(fileURLToPath(import.meta.url));
const ir: Ir = parseIr(readFileSync(path.join(here, "fixtures", "ir", "valid-petstore.json"), "utf8"));
const { variants } = generateAll(ir, { depth: "standard" });

const run = (): ExportedFile[] =>
  exportCollections({
    ir,
    variants,
    tools: [...SUPPORTED_TOOLS] as SupportedTool[],
    options: { baseUrl: "http://localhost:5000", generatedAt: "2026-01-01T00:00:00Z" },
  });

const files = run();
const find = (needle: string) => files.find((f) => f.path.includes(needle))!;
const json = (needle: string) => JSON.parse(find(needle).content);

describe("exporter orchestration", () => {
  it("runs all 7 exporters with no error files", () => {
    expect(files.some((f) => f.path.startsWith("errors/"))).toBe(false);
    for (const tool of SUPPORTED_TOOLS) {
      expect(files.some((f) => f.path.includes(tool === "openapi" ? "openapi/" : `${tool}/`))).toBe(true);
    }
  });

  it("emits only valid JSON for JSON outputs", () => {
    for (const f of files.filter((x) => x.path.endsWith(".json"))) {
      expect(() => JSON.parse(f.content), f.path).not.toThrow();
    }
  });

  it("is byte-stable across runs", () => {
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});

describe("postman", () => {
  it("is a v2.1 collection grouped by endpoint with a baseUrl placeholder", () => {
    const c = json(".postman_collection.json");
    expect(c.info.schema).toContain("v2.1.0");
    expect(c.item).toHaveLength(ir.endpoints.length);
    const blob = JSON.stringify(c);
    expect(blob).toContain("{{baseUrl}}");
  });

  it("ships an environment with secrets left blank", () => {
    const env = json(".postman_environment.json");
    const bearer = env.values.find((v: { key: string }) => v.key === "bearerToken");
    expect(bearer.value).toBe("");
  });
});

describe("openapi", () => {
  it("is OpenAPI 3.1 with paths and bearer security", () => {
    const doc = json(".openapi.json");
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths["/pets/{id}"].get).toBeDefined();
    expect(doc.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
  });
});

describe("insomnia", () => {
  it("is a v4 export using {{ _.var }} template syntax", () => {
    const doc = json(".insomnia.json");
    expect(doc.__export_format).toBe(4);
    const req = doc.resources.find((r: { _type: string }) => r._type === "request");
    expect(req.url).toContain("{{ _.baseUrl }}");
  });
});

describe("hoppscotch", () => {
  it("uses <<var>> placeholders", () => {
    const blob = find(".hoppscotch-collection.json").content;
    expect(blob).toContain("<<baseUrl>>");
    expect(blob).not.toContain("{{baseUrl}}");
  });
});

describe("bruno", () => {
  it("has a collection manifest and .bru request files", () => {
    expect(json("bruno/bruno.json").type).toBe("collection");
    const bru = files.find((f) => f.path.endsWith(".bru") && !f.path.includes("environments"))!;
    expect(bru.content).toContain("meta {");
    expect(bru.content).toContain("{{baseUrl}}");
  });
});

describe("thunder-client", () => {
  it("records a deterministic export timestamp and requests", () => {
    const c = json(".thunder-collection.json");
    expect(c.dateExported).toBe("2026-01-01T00:00:00Z");
    expect(c.requests.length).toBeGreaterThan(0);
  });
});

describe("test assertions (A1)", () => {
  it("postman embeds status, content-type, and JSON-schema assertions", () => {
    const blob = JSON.stringify(json(".postman_collection.json"));
    expect(blob).toContain("pm.response.to.have.status");
    expect(blob).toContain("pm.response.to.have.jsonSchema"); // getPetById 200 has a schema
    expect(blob).toContain("pm.expect"); // content-type check
  });

  it("thunder emits res-code tests; bruno emits assert blocks; hoppscotch emits pw assertions", () => {
    expect(find(".thunder-collection.json").content).toContain('"res-code"');
    const bru = files.find((f) => f.path.endsWith(".bru") && !f.path.includes("environments"))!;
    expect(bru.content).toContain("assert {");
    expect(bru.content).toContain("res.status: eq");
    expect(find(".hoppscotch-collection.json").content).toContain("pw.expect(pw.response.status)");
  });

  it("tests:false omits assertions", () => {
    const noTests = exportCollections({
      ir,
      variants,
      tools: [...SUPPORTED_TOOLS] as SupportedTool[],
      options: { tests: false, generatedAt: "2026-01-01T00:00:00Z" },
    });
    const postman = noTests.find((f) => f.path.includes(".postman_collection.json"))!.content;
    expect(postman).not.toContain("pm.response.to.have.status");
  });
});

describe("http", () => {
  it("emits a .http file and an env with blank secrets", () => {
    const httpFile = files.find((f) => f.path.endsWith(".http"))!;
    expect(httpFile.content).toContain("### ");
    expect(httpFile.content).toContain("{{baseUrl}}");
    const env = json("http-client.env.json");
    expect(env.dev.bearerToken).toBe("");
  });
});
