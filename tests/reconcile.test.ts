import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parseIr, reconcile, type Ir, type Endpoint } from "../src/ir/index";

const here = path.dirname(fileURLToPath(import.meta.url));
const irFixture = path.join(here, "fixtures", "ir", "valid-petstore.json");

function load(): Ir {
  return parseIr(readFileSync(irFixture, "utf8"));
}

function ep(ir: Ir, method: string, route: string): Endpoint | undefined {
  return ir.endpoints.find((e) => e.method === method && e.routeTemplate === route);
}

describe("reconcile (static ⊕ build-mode ground truth)", () => {
  it("build-mode wins on matched endpoints and flags material differences", () => {
    const staticIr = load();
    const target = ep(staticIr, "GET", "/pets/{id}")!;
    expect(target).toBeDefined();

    // Build IR: same endpoint but with an extra response (a material difference).
    const buildIr: Ir = {
      ...staticIr,
      meta: { ...staticIr.meta, mode: "static", analyzerVersion: "openapi-import" },
      endpoints: staticIr.endpoints.map((e) =>
        e.id === target.id
          ? { ...e, responses: [...e.responses, { status: 500, description: "server error" }] }
          : e,
      ),
    };

    const out = reconcile(staticIr, buildIr);
    expect(out.meta.mode).toBe("build");

    const merged = ep(out, "GET", "/pets/{id}")!;
    expect(merged.responses.some((r) => r.status === 500)).toBe(true); // build won

    expect(
      out.diagnostics.some(
        (d) => d.code === "assumedConvention" && d.message.includes("used build-mode"),
      ),
    ).toBe(true);
  });

  it("keeps static-only endpoints but flags them as missing from build", () => {
    const staticIr = load();
    // Build IR drops one endpoint entirely.
    const dropped = staticIr.endpoints[0];
    const buildIr: Ir = {
      ...staticIr,
      endpoints: staticIr.endpoints.filter((e) => e.id !== dropped.id),
    };

    const out = reconcile(staticIr, buildIr);
    expect(ep(out, dropped.method, dropped.routeTemplate)).toBeDefined(); // kept
    expect(
      out.diagnostics.some(
        (d) => d.code === "ambiguousRoute" && d.message.includes("not in build-mode"),
      ),
    ).toBe(true);
  });

  it("adds build-only endpoints with an info diagnostic", () => {
    const staticIr = load();
    const extra: Endpoint = {
      ...staticIr.endpoints[0],
      id: "buildOnly",
      method: "DELETE",
      routeTemplate: "/pets/{id}/extra",
      params: [],
      responses: [{ status: 204, description: "no content" }],
    };
    const buildIr: Ir = { ...staticIr, endpoints: [...staticIr.endpoints, extra] };

    const out = reconcile(staticIr, buildIr);
    expect(ep(out, "DELETE", "/pets/{id}/extra")).toBeDefined();
    expect(
      out.diagnostics.some(
        (d) => d.code === "assumedConvention" && d.message.includes("not static analysis"),
      ),
    ).toBe(true);
  });

  it("produces a valid, version-consistent IR with unique endpoint ids", () => {
    const staticIr = load();
    // Force an id collision: a static-only endpoint sharing an id with a build one.
    const clash: Endpoint = {
      ...staticIr.endpoints[0],
      method: "PATCH",
      routeTemplate: "/pets/{id}/clash",
    };
    const buildIr: Ir = { ...staticIr };
    const staticWithClash: Ir = { ...staticIr, endpoints: [...staticIr.endpoints, clash] };

    const out = reconcile(staticWithClash, buildIr);
    const ids = out.endpoints.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length); // all unique
    expect(out.irVersion).toBe(staticIr.irVersion);
  });
});
