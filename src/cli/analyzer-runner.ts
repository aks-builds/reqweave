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
import { mkdtempSync, readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseIr, importOpenApi, reconcile, type Ir } from "../ir/index.js";
import { resolvePrebuiltAnalyzer, prebuiltPackageName } from "./prebuilt.js";
import { analyzeTypeScript } from "../analyzers/ts/index.js";
import { analyzePython } from "../analyzers/python/index.js";
import { analyzeJava } from "../analyzers/java/index.js";

export type Language = "auto" | "dotnet" | "ts" | "py" | "java";

export interface AnalyzeOptions {
  build?: boolean;
  /** Source language. "auto" (default) detects from the project files. */
  language?: Language;
  service?: string;
  generatedAt?: string;
  /** Read IR directly from this file instead of running the analyzer. */
  irFile?: string;
  /** Import an OpenAPI document instead of running the analyzer. */
  openapiFile?: string;
  /**
   * Build-mode ground truth: reconcile the static pass with this build-produced
   * OpenAPI doc (build wins; divergences become diagnostics). Implies build-mode.
   */
  buildOpenapiFile?: string;
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

  const staticIr = runStaticAnalyzer(sourcePath, opts);

  // Build-mode: reconcile the static pass with a build-produced OpenAPI ground
  // truth (build wins; divergences surface as diagnostics). No code is executed
  // by reqweave — the project's own build emits the OpenAPI; we only read it.
  if (opts.buildOpenapiFile || opts.build) {
    const doc = opts.buildOpenapiFile
      ? (JSON.parse(readFileSync(opts.buildOpenapiFile, "utf8")) as unknown)
      : findBuildOpenApi(sourcePath);
    if (doc) {
      const buildIr = importOpenApi(doc, {
        serviceName: opts.service ?? staticIr.service.name,
        generatedAt: opts.generatedAt,
      });
      return reconcile(staticIr, buildIr);
    }
    return {
      ...staticIr,
      diagnostics: [
        ...staticIr.diagnostics,
        {
          code: "assumedConvention",
          message:
            "build-mode requested but no build-produced OpenAPI was found; used static analysis. " +
            "Generate the project's OpenAPI (Swashbuckle or Microsoft.AspNetCore.OpenApi) and pass " +
            "--build-openapi <file>, or place openapi.json / swagger.json in the project tree.",
          severity: "warning",
        },
      ],
    };
  }

  return staticIr;
}

/** Run the static analyzer for the resolved language (no compilation). */
function runStaticAnalyzer(sourcePath: string, opts: AnalyzeOptions): Ir {
  const language = resolveLanguage(sourcePath, opts.language ?? "auto");
  if (language === "ts") {
    return analyzeTypeScript(sourcePath, { service: opts.service, generatedAt: opts.generatedAt });
  }
  if (language === "py") {
    return analyzePython(sourcePath, { service: opts.service, generatedAt: opts.generatedAt });
  }
  if (language === "java") {
    return analyzeJava(sourcePath, { service: opts.service, generatedAt: opts.generatedAt });
  }

  const outFile = join(mkdtempSync(join(tmpdir(), "reqweave-")), "ir.json");
  const args = [sourcePath, "--out", outFile];
  if (opts.service) args.push("--service", opts.service);
  if (opts.generatedAt) args.push("--generated-at", opts.generatedAt);

  const custom = process.env.REQWEAVE_ANALYZER;
  const prebuilt = custom ? null : resolvePrebuiltAnalyzer();
  let result;
  if (custom) {
    const isDll = custom.toLowerCase().endsWith(".dll");
    result = spawnSync(isDll ? "dotnet" : custom, isDll ? [custom, ...args] : args, { encoding: "utf8" });
  } else if (prebuilt) {
    // Self-contained, checksum-verified native binary — no .NET SDK required.
    result = spawnSync(prebuilt, args, { encoding: "utf8" });
  } else if (existsSync(ANALYZER_CSPROJ) && hasDotnet()) {
    result = spawnSync(
      "dotnet",
      ["run", "--project", ANALYZER_CSPROJ, "-c", "Release", "--", ...args],
      { encoding: "utf8" },
    );
  } else {
    throw new Error(
      "reqweave analyzer not found. Install the .NET SDK, install the prebuilt " +
        `analyzer package (${prebuiltPackageName()}), set REQWEAVE_ANALYZER, or pass --ir <file>.`,
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

/** Resolve the source language: honor an explicit choice, else detect from files. */
function resolveLanguage(sourcePath: string, requested: Language): Language {
  if (requested !== "auto") return requested;
  const base = resolve(sourcePath);
  // Try to list it as a directory; if that fails it's a file (or missing), so
  // decide by extension. (try-then-act avoids a stat→read race.)
  let entries: string[] | null = null;
  try {
    entries = readdirSync(base).map((e) => e.toLowerCase());
  } catch {
    entries = null;
  }
  if (entries === null) {
    if (/\.(ts|tsx|mts|cts)$/i.test(base)) return "ts";
    if (/\.py$/i.test(base)) return "py";
    if (/\.java$/i.test(base)) return "java";
    return "dotnet";
  }
  if (entries.some((e) => e.endsWith(".csproj") || e.endsWith(".sln"))) return "dotnet";
  if (entries.includes("pom.xml") || entries.includes("build.gradle") || entries.includes("build.gradle.kts")) return "java";
  if (entries.includes("package.json") || entries.includes("tsconfig.json") || entries.some((e) => /\.(ts|tsx)$/.test(e))) {
    return "ts";
  }
  if (
    entries.includes("pyproject.toml") ||
    entries.includes("requirements.txt") ||
    entries.includes("setup.py") ||
    entries.includes("pipfile") ||
    entries.some((e) => /\.py$/.test(e))
  ) {
    return "py";
  }
  if (entries.some((e) => /\.java$/.test(e))) return "java";
  return "dotnet";
}

const OPENAPI_NAME = /^(openapi|swagger)\.json$/i;
const OPENAPI_SUFFIX = /\.(openapi|swagger)\.json$/i;
const SKIP_DIRS = new Set(["node_modules", ".git", ".vs", "packages"]);

/**
 * Find a build-produced OpenAPI document under the project tree (bounded walk).
 * Matches `openapi.json` / `swagger.json` / `*.openapi.json` / `*.swagger.json`
 * and returns the first whose content looks like an OpenAPI/Swagger doc.
 */
function findBuildOpenApi(sourcePath: string): unknown | null {
  let base = resolve(sourcePath);
  try {
    if (statSync(base).isFile()) base = resolve(base, "..");
  } catch {
    return null;
  }
  const walk = (dir: string, depth: number): unknown | null => {
    if (depth > 6) return null;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    const subdirs: string[] = [];
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) subdirs.push(join(dir, e.name));
        continue;
      }
      if (OPENAPI_NAME.test(e.name) || OPENAPI_SUFFIX.test(e.name)) {
        const doc = tryReadOpenApi(join(dir, e.name));
        if (doc) return doc;
      }
    }
    for (const sd of subdirs) {
      const found = walk(sd, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(base, 0);
}

function tryReadOpenApi(file: string): unknown | null {
  try {
    const doc = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    if (doc && typeof doc === "object" && (doc.openapi || doc.swagger) && doc.paths) {
      return doc;
    }
  } catch {
    /* ignore unreadable / non-JSON candidates */
  }
  return null;
}
