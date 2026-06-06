import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const readJson = (rel: string) => JSON.parse(read(rel));

const pkg = readJson("package.json");

describe("claude plugin manifests", () => {
  it("plugin.json is well-formed and version-synced with package.json", () => {
    const p = readJson(".claude-plugin/plugin.json");
    expect(p.name).toBe("reqweave");
    expect(p.license).toBe("MIT");
    expect(p.version).toBe(pkg.version);
    expect(Array.isArray(p.keywords)).toBe(true);
  });

  it("marketplace.json is well-formed and version-synced (guards release.yml sync)", () => {
    const m = readJson(".claude-plugin/marketplace.json");
    expect(m.name).toBe("reqweave");
    expect(m.metadata.version).toBe(pkg.version);
    expect(m.plugins).toHaveLength(1);
    expect(m.plugins[0].name).toBe("reqweave");
    expect(m.plugins[0].source).toBe("./");
    expect(m.plugins[0].version).toBe(pkg.version);
  });
});

describe("agent skill", () => {
  const skill = read("skills/reqweave/SKILL.md");

  it("has YAML frontmatter with name and a substantial description", () => {
    expect(skill.startsWith("---\n")).toBe(true);
    const fm = skill.slice(4, skill.indexOf("\n---", 4));
    expect(fm).toMatch(/name:\s*reqweave/);
    const desc = /description:\s*(.+)/.exec(fm)?.[1] ?? "";
    expect(desc.length).toBeGreaterThan(80);
  });

  it("every referenced workflow file exists", () => {
    const refs = [...skill.matchAll(/workflows\/([a-z-]+\.md)/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThanOrEqual(4);
    for (const r of new Set(refs)) {
      expect(existsSync(path.join(root, "skills", "reqweave", "workflows", r as string)), r as string).toBe(true);
    }
  });
});
