import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  prebuiltPackageName,
  prebuiltBinaryName,
  resolvePrebuiltAnalyzer,
  verifyChecksum,
} from "../src/cli/prebuilt";

/** Lay down a fake `@reqweave/analyzer-<plat>-<arch>` package in a temp root. */
function fakePackage(opts: { tamper?: boolean; noSum?: boolean } = {}): {
  root: string;
  binPath: string;
} {
  const root = mkdtempSync(path.join(tmpdir(), "reqweave-prebuilt-"));
  const pkgDir = path.join(root, "node_modules", "@reqweave", `analyzer-${process.platform}-${process.arch}`);
  const binDir = path.join(pkgDir, "bin");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ name: prebuiltPackageName(), version: "0.0.0" }));

  const exe = prebuiltBinaryName();
  const binPath = path.join(binDir, exe);
  const content = "#!/bin/sh\necho fake-analyzer\n";
  writeFileSync(binPath, content);

  if (!opts.noSum) {
    const digest = createHash("sha256")
      .update(opts.tamper ? "different-content" : content)
      .digest("hex");
    writeFileSync(`${binPath}.sha256`, `${digest}  ${exe}\n`);
  }
  return { root, binPath };
}

describe("prebuilt analyzer resolution (B2)", () => {
  it("maps platform/arch to the optional package + binary name", () => {
    expect(prebuiltPackageName("linux", "x64")).toBe("@reqweave/analyzer-linux-x64");
    expect(prebuiltPackageName("darwin", "arm64")).toBe("@reqweave/analyzer-darwin-arm64");
    expect(prebuiltBinaryName("win32")).toBe("Reqweave.Analyzer.exe");
    expect(prebuiltBinaryName("linux")).toBe("Reqweave.Analyzer");
  });

  it("returns null when no package is installed for this platform", () => {
    const empty = mkdtempSync(path.join(tmpdir(), "reqweave-empty-"));
    expect(resolvePrebuiltAnalyzer({ paths: [empty] })).toBeNull();
  });

  it("resolves and checksum-verifies an installed package", () => {
    const { root, binPath } = fakePackage();
    const resolved = resolvePrebuiltAnalyzer({ paths: [root] });
    expect(resolved).toBe(binPath);
  });

  it("rejects a tampered binary (checksum mismatch)", () => {
    const { root } = fakePackage({ tamper: true });
    expect(() => resolvePrebuiltAnalyzer({ paths: [root] })).toThrow(/checksum mismatch/i);
  });

  it("rejects a binary with no checksum sidecar", () => {
    const { root } = fakePackage({ noSum: true });
    expect(() => resolvePrebuiltAnalyzer({ paths: [root] })).toThrow(/checksum file/i);
  });

  it("verifyChecksum throws on a missing file", () => {
    expect(() => verifyChecksum(path.join(tmpdir(), "does-not-exist-xyz"))).toThrow();
  });
});
