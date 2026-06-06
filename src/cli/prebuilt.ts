/**
 * Resolves a prebuilt, self-contained analyzer binary shipped as an optional,
 * per-OS npm package (`@reqweave/analyzer-<platform>-<arch>`), so consumers run
 * reqweave with **no .NET SDK**. npm installs only the package matching the host
 * (os/cpu fields), and we resolve its binary via the module resolver.
 *
 * Security: the binary is checksum-verified (SHA-256) against a sidecar file
 * shipped in the same package before it is ever executed; a mismatch or missing
 * checksum throws rather than running an unverified binary.
 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

const require_ = createRequire(__filename);

/** The optional npm package that would carry the analyzer for a given host. */
export function prebuiltPackageName(platform: string = process.platform, arch: string = process.arch): string {
  return `@reqweave/analyzer-${platform}-${arch}`;
}

/** The platform-specific binary filename inside that package's `bin/`. */
export function prebuiltBinaryName(platform: string = process.platform): string {
  return platform === "win32" ? "Reqweave.Analyzer.exe" : "Reqweave.Analyzer";
}

export interface ResolveOptions {
  platform?: string;
  arch?: string;
  /** Extra directories to start module resolution from (used in tests). */
  paths?: string[];
}

/**
 * Resolve the prebuilt analyzer binary for the host (or `opts` override).
 * Returns the absolute, checksum-verified path, or `null` when no package is
 * installed for this platform (caller falls back to the .NET SDK). Throws only
 * when a package IS present but its binary fails verification.
 */
export function resolvePrebuiltAnalyzer(opts: ResolveOptions = {}): string | null {
  const platform = opts.platform ?? process.platform;
  const arch = opts.arch ?? process.arch;
  const rel = `${prebuiltPackageName(platform, arch)}/bin/${prebuiltBinaryName(platform)}`;

  let binPath: string;
  try {
    binPath = require_.resolve(rel, opts.paths ? { paths: opts.paths } : undefined);
  } catch {
    return null; // not installed for this platform
  }
  verifyChecksum(binPath);
  return binPath;
}

/** Verify a binary against its sidecar `<binary>.sha256`. Throws on any problem. */
export function verifyChecksum(binPath: string): void {
  const sumFile = `${binPath}.sha256`;
  if (!existsSync(sumFile)) {
    throw new Error(`reqweave prebuilt analyzer is missing its checksum file (${sumFile}); refusing to run an unverified binary.`);
  }
  const expected = readFileSync(sumFile, "utf8").trim().split(/\s+/)[0]?.toLowerCase();
  const actual = createHash("sha256").update(readFileSync(binPath)).digest("hex");
  if (!expected || actual !== expected) {
    throw new Error(`reqweave prebuilt analyzer checksum mismatch for ${binPath} (possible tampering or corrupt download).`);
  }
}
