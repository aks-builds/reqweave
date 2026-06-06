/**
 * Locates and invokes the .NET analyzer to produce IR, with graceful fallbacks.
 * Resolution order:
 *   1. opts.irFile        — read an existing IR JSON, skip the analyzer entirely.
 *   2. $REQWEAVE_ANALYZER  — a prebuilt analyzer binary/dll.
 *   3. dev monorepo        — `dotnet run` the analyzer project (needs the SDK).
 * Otherwise throws with actionable guidance. The analyzer writes to a temp file
 * (not stdout) so build chatter never contaminates the IR.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseIr, importOpenApi, type Ir } from "../ir/index.js";

export interface AnalyzeOptions {
  build?: boolean;
  service?: string;
  generatedAt?: string;
  /** Read IR directly from this file instead of running the analyzer. */
  irFile?: string;
  /** Import an OpenAPI document instead of running the analyzer. */
  openapiFile?: string;
}

const REPO_ROOT = resolve(__dirname, "..", "..");
const ANALYZER_CSPROJ = join(REPO_ROOT, "analyzer", "src", "Reqweave.Analyzer", "Reqweave.Analyzer.csproj");

export function analyze(sourcePath: string, opts: AnalyzeOptions = {}): Ir {
  if (opts.irFile) {
    return parseIr(readFileSync(opts.irFile, "utf8"));
  }

  if (opts.openapiFile) {
    return importOpenApi(JSON.parse(readFileSync(opts.openapiFile, "utf8")), {
      serviceName: opts.service,
      generatedAt: opts.generatedAt,
    });
  }

  const outFile = join(mkdtempSync(join(tmpdir(), "reqweave-")), "ir.json");
  const args = [sourcePath, "--out", outFile];
  if (opts.service) args.push("--service", opts.service);
  if (opts.generatedAt) args.push("--generated-at", opts.generatedAt);
  if (opts.build) args.push("--build");

  const custom = process.env.REQWEAVE_ANALYZER;
  let result;
  if (custom) {
    const isDll = custom.toLowerCase().endsWith(".dll");
    result = spawnSync(isDll ? "dotnet" : custom, isDll ? [custom, ...args] : args, { encoding: "utf8" });
  } else if (existsSync(ANALYZER_CSPROJ) && hasDotnet()) {
    result = spawnSync(
      "dotnet",
      ["run", "--project", ANALYZER_CSPROJ, "-c", "Release", "--", ...args],
      { encoding: "utf8" },
    );
  } else {
    throw new Error(
      "reqweave analyzer not found. Install the .NET SDK, set REQWEAVE_ANALYZER to the analyzer binary, or pass --ir <file>.",
    );
  }

  if (result.error) {
    throw new Error(`failed to run analyzer: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`analyzer exited ${result.status}: ${(result.stderr || "").trim() || "unknown error"}`);
  }
  if (!existsSync(outFile)) {
    throw new Error("analyzer did not produce IR output.");
  }
  return parseIr(readFileSync(outFile, "utf8"));
}

function hasDotnet(): boolean {
  const r = spawnSync("dotnet", ["--version"], { encoding: "utf8" });
  return !r.error && r.status === 0;
}
