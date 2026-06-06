#!/usr/bin/env node
/**
 * Build self-contained, single-file analyzer binaries per .NET RID and pack each
 * as an optional, per-OS npm package `@reqweave/analyzer-<platform>-<arch>` under
 * dist-binaries/. Each package carries the binary plus a SHA-256 sidecar that the
 * runtime verifies before execution (see src/cli/prebuilt.ts).
 *
 * Usage:
 *   node scripts/pack-analyzer-binaries.mjs [rid ...]   # default: all RIDs
 *
 * Intended for CI/release runners with the .NET SDK; not part of `npm test`.
 * Publishing is a separate, explicit step (npm publish dist-binaries/<pkg>).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const csproj = join(repoRoot, "analyzer", "src", "Reqweave.Analyzer", "Reqweave.Analyzer.csproj");
const version = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version;

// .NET RID -> { platform (process.platform), arch (process.arch) }
const RIDS = {
  "win-x64": { platform: "win32", arch: "x64", exe: "Reqweave.Analyzer.exe" },
  "linux-x64": { platform: "linux", arch: "x64", exe: "Reqweave.Analyzer" },
  "linux-arm64": { platform: "linux", arch: "arm64", exe: "Reqweave.Analyzer" },
  "osx-x64": { platform: "darwin", arch: "x64", exe: "Reqweave.Analyzer" },
  "osx-arm64": { platform: "darwin", arch: "arm64", exe: "Reqweave.Analyzer" },
};

const targets = process.argv.slice(2);
const rids = targets.length ? targets : Object.keys(RIDS);

for (const rid of rids) {
  const meta = RIDS[rid];
  if (!meta) throw new Error(`unknown RID '${rid}'. Known: ${Object.keys(RIDS).join(", ")}`);

  const staging = join(repoRoot, "dist-binaries", ".publish", rid);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });

  console.log(`[pack] dotnet publish ${rid} ...`);
  const r = spawnSync(
    "dotnet",
    [
      "publish", csproj, "-c", "Release", "-r", rid,
      "--self-contained", "true",
      "-p:PublishSingleFile=true", "-p:PublishTrimmed=false", "-p:IncludeNativeLibrariesForSelfExtract=true",
      "-o", staging,
    ],
    { stdio: "inherit" },
  );
  if (r.status !== 0) throw new Error(`dotnet publish failed for ${rid} (exit ${r.status})`);

  const produced = readdirSync(staging).find((f) => f === meta.exe);
  if (!produced) throw new Error(`expected binary ${meta.exe} not found in ${staging}`);

  const pkgName = `analyzer-${meta.platform}-${meta.arch}`;
  const pkgDir = join(repoRoot, "dist-binaries", "@reqweave", pkgName);
  const binDir = join(pkgDir, "bin");
  rmSync(pkgDir, { recursive: true, force: true });
  mkdirSync(binDir, { recursive: true });

  const binDest = join(binDir, meta.exe);
  copyFileSync(join(staging, meta.exe), binDest);
  const sha = createHash("sha256").update(readFileSync(binDest)).digest("hex");
  writeFileSync(`${binDest}.sha256`, `${sha}  ${meta.exe}\n`);

  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify(
      {
        name: `@reqweave/${pkgName}`,
        version,
        description: `Prebuilt reqweave analyzer binary for ${meta.platform}-${meta.arch}.`,
        os: [meta.platform],
        cpu: [meta.arch],
        files: ["bin"],
        license: "MIT",
        repository: { type: "git", url: "git+https://github.com/aks-builds/reqweave.git" },
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    join(pkgDir, "README.md"),
    `# @reqweave/${pkgName}\n\nPrebuilt, self-contained reqweave analyzer for \`${meta.platform}-${meta.arch}\`. ` +
      `Installed automatically as an optional dependency of \`reqweave\`; not meant to be used directly.\n`,
  );

  console.log(`[pack] wrote ${pkgDir} (sha256 ${sha.slice(0, 12)}…)`);
}

if (existsSync(join(repoRoot, "dist-binaries"))) {
  console.log("[pack] done. Packages under dist-binaries/@reqweave/.");
}
