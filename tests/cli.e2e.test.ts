import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

import { run } from "../src/cli/index";

const here = path.dirname(fileURLToPath(import.meta.url));
const irFixture = path.join(here, "fixtures", "ir", "valid-petstore.json");

function generateInto(extra: string[] = []): { code: number; out: string } {
  const out = mkdtempSync(path.join(tmpdir(), "reqweave-cli-"));
  const code = run(["generate", ".", "--ir", irFixture, "--out", out, "--generated-at", "2026-01-01T00:00:00Z", ...extra]);
  return { code, out };
}

describe("generate (IR -> collections, no .NET needed)", () => {
  it("writes collections for the requested tools and exits 0", () => {
    const { code, out } = generateInto(["--tools", "postman,openapi", "--depth", "standard"]);
    expect(code).toBe(0);

    const postman = JSON.parse(readFileSync(path.join(out, "postman", "petstore.postman_collection.json"), "utf8"));
    expect(postman.info.schema).toContain("v2.1.0");

    const openapi = JSON.parse(readFileSync(path.join(out, "openapi", "petstore.openapi.json"), "utf8"));
    expect(openapi.openapi).toBe("3.1.0");
    expect(openapi.paths["/pets/{id}"].get).toBeDefined();
  });

  it("defaults to all 7 tools", () => {
    const { code, out } = generateInto([]);
    expect(code).toBe(0);
    for (const dir of ["postman", "openapi", "insomnia", "bruno", "hoppscotch", "thunder-client", "http"]) {
      expect(existsSync(path.join(out, dir)), dir).toBe(true);
    }
  });

  it("rejects an invalid depth and unknown tools", () => {
    expect(generateInto(["--depth", "nope"]).code).toBe(2);
    expect(generateInto(["--tools", "postman,bogus"]).code).toBe(2);
  });
});

describe("other commands", () => {
  it("list-endpoints succeeds from an IR file", () => {
    expect(run(["list-endpoints", ".", "--ir", irFixture])).toBe(0);
  });

  it("inspect a known endpoint succeeds; unknown fails", () => {
    expect(run(["inspect", ".", "getPetById", "--ir", irFixture])).toBe(0);
    expect(run(["inspect", ".", "nope", "--ir", irFixture])).toBe(1);
  });

  it("help and version exit 0; unknown command exits 2", () => {
    expect(run(["--help"])).toBe(0);
    expect(run(["--version"])).toBe(0);
    expect(run(["frobnicate"])).toBe(2);
  });

  it("generate without a path exits 2", () => {
    expect(run(["generate"])).toBe(2);
  });
});
