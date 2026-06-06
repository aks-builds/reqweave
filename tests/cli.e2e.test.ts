import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
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

  it("generate --openapi imports an OpenAPI doc end to end (B1)", () => {
    const openapi = path.join(here, "fixtures", "openapi", "petstore.openapi.json");
    const out = mkdtempSync(path.join(tmpdir(), "reqweave-oapi-"));
    const code = run(["generate", ".", "--openapi", openapi, "--out", out, "--tools", "postman,openapi", "--generated-at", "2026-01-01T00:00:00Z"]);
    expect(code).toBe(0);
    expect(existsSync(path.join(out, "postman", "petstore.postman_collection.json"))).toBe(true);
    expect(existsSync(path.join(out, "openapi", "petstore.openapi.json"))).toBe(true);
  });
});

describe("config + init (A4)", () => {
  it("init scaffolds reqweave.config.json; refuses to overwrite without --force", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "reqweave-init-"));
    expect(run(["init", dir])).toBe(0);
    expect(existsSync(path.join(dir, "reqweave.config.json"))).toBe(true);
    expect(run(["init", dir])).toBe(1); // exists
    expect(run(["init", dir, "--force"])).toBe(0);
  });

  it("generate honors reqweave.config.json (tools), and flags override it", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "reqweave-cfg-"));
    writeFileSync(path.join(dir, "reqweave.config.json"), JSON.stringify({ tools: ["postman"], depth: "minimal" }));

    const out1 = mkdtempSync(path.join(tmpdir(), "reqweave-o1-"));
    expect(run(["generate", dir, "--ir", irFixture, "--out", out1, "--generated-at", "2026-01-01T00:00:00Z"])).toBe(0);
    expect(existsSync(path.join(out1, "postman"))).toBe(true);
    expect(existsSync(path.join(out1, "openapi"))).toBe(false); // config limited tools to postman

    const out2 = mkdtempSync(path.join(tmpdir(), "reqweave-o2-"));
    run(["generate", dir, "--ir", irFixture, "--out", out2, "--tools", "openapi", "--generated-at", "2026-01-01T00:00:00Z"]);
    expect(existsSync(path.join(out2, "openapi"))).toBe(true); // flag overrides config
    expect(existsSync(path.join(out2, "postman"))).toBe(false);
  });
});

describe("install (A5)", () => {
  it("install --only claude copies the skill into the agent dir (isolated temp HOME)", () => {
    const fakeHome = mkdtempSync(path.join(tmpdir(), "reqweave-home-"));
    const origHome = process.env.HOME;
    const origUserProfile = process.env.USERPROFILE;
    process.env.HOME = fakeHome; // os.homedir() on POSIX
    process.env.USERPROFILE = fakeHome; // os.homedir() on Windows
    let code = 1;
    try {
      code = run(["install", "--only", "claude"]);
    } finally {
      process.env.HOME = origHome;
      process.env.USERPROFILE = origUserProfile;
    }
    expect(code).toBe(0);
    expect(existsSync(path.join(fakeHome, ".claude", "skills", "reqweave", "SKILL.md"))).toBe(true);
  });

  it("dry-run writes nothing", () => {
    const fakeHome = mkdtempSync(path.join(tmpdir(), "reqweave-home-"));
    const origHome = process.env.HOME;
    const origUserProfile = process.env.USERPROFILE;
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    try {
      expect(run(["install", "--only", "claude", "--dry-run"])).toBe(0);
    } finally {
      process.env.HOME = origHome;
      process.env.USERPROFILE = origUserProfile;
    }
    expect(existsSync(path.join(fakeHome, ".claude"))).toBe(false);
  });
});
