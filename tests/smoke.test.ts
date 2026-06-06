import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  IR_VERSION,
  SUPPORTED_TOOLS,
  DEPTH_LEVELS,
  isSupportedTool,
} from "../src/index";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const cli = path.join(root, "bin", "cli.js");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

describe("core library surface", () => {
  it("declares an IR version", () => {
    expect(IR_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("supports the seven M1 exporters", () => {
    expect(SUPPORTED_TOOLS).toHaveLength(7);
    expect(SUPPORTED_TOOLS).toContain("postman");
    expect(SUPPORTED_TOOLS).toContain("openapi");
  });

  it("offers three depth levels", () => {
    expect([...DEPTH_LEVELS]).toEqual(["minimal", "standard", "exhaustive"]);
  });

  it("recognises supported vs unknown tools", () => {
    expect(isSupportedTool("bruno")).toBe(true);
    expect(isSupportedTool("nope")).toBe(false);
  });
});

describe("cli stub", () => {
  it("prints its version matching package.json", () => {
    const out = execFileSync("node", [cli, "--version"], { encoding: "utf8" });
    expect(out.trim()).toBe(pkg.version);
  });

  it("prints help and lists the planned commands", () => {
    const out = execFileSync("node", [cli, "--help"], { encoding: "utf8" });
    expect(out).toContain("reqweave");
    expect(out).toContain("generate");
    expect(out).toContain("list-endpoints");
    expect(out).toContain("inspect");
  });
});
