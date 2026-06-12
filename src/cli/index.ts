/**
 * reqweave CLI. Chains analyzer -> variant engine -> exporters.
 * Synchronous (the analyzer runs via spawnSync); returns a process exit code.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync, cpSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { generateAll, generateVariants } from "../variants/index.js";
import { exportCollections } from "../exporters/index.js";
import { DEFAULT_BASE_URL, DEFAULT_GENERATED_AT } from "../exporters/types.js";
import { SUPPORTED_TOOLS, DEPTH_LEVELS, isSupportedTool, type SupportedTool, type Depth } from "../constants.js";
import { analyze, type AnalyzeOptions } from "./analyzer-runner.js";
import { loadConfig, configTemplate, CONFIG_FILENAME } from "./config.js";

function version(): string {
  try {
    return JSON.parse(readFileSync(resolve(__dirname, "..", "..", "package.json"), "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

interface Flags {
  positionals: string[];
  values: Record<string, string>;
  bools: Set<string>;
}

function parseFlags(args: string[], boolFlags: Set<string>): Flags {
  const positionals: string[] = [];
  const values: Record<string, string> = {};
  const bools = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (boolFlags.has(key)) bools.add(key);
      else values[key] = (args[++i] as string) ?? "";
    } else {
      positionals.push(a);
    }
  }
  return { positionals, values, bools };
}

export function run(argv: string[]): number {
  const cmd = argv[0];
  if (!cmd || cmd === "-h" || cmd === "--help") {
    printUsage();
    return 0;
  }
  if (cmd === "-v" || cmd === "--version") {
    process.stdout.write(`${version()}\n`);
    return 0;
  }

  try {
    switch (cmd) {
      case "generate":
        return cmdGenerate(argv.slice(1));
      case "list-endpoints":
        return cmdList(argv.slice(1));
      case "inspect":
        return cmdInspect(argv.slice(1));
      case "init":
        return cmdInit(argv.slice(1));
      case "install":
        return cmdInstall(argv.slice(1));
      default:
        process.stderr.write(`reqweave: unknown command '${cmd}'. Run 'reqweave --help'.\n`);
        return 2;
    }
  } catch (e) {
    process.stderr.write(`reqweave: ${(e as Error).message}\n`);
    return 1;
  }
}

function analyzeOpts(f: Flags): { path: string; opts: AnalyzeOptions } | null {
  const path = f.positionals[0];
  if (!path) {
    process.stderr.write("reqweave: missing <path>.\n");
    return null;
  }
  return {
    path,
    opts: {
      build: f.bools.has("build"),
      language: (f.values.lang as AnalyzeOptions["language"]) ?? "auto",
      service: f.values.service,
      generatedAt: f.values["generated-at"] ?? DEFAULT_GENERATED_AT,
      irFile: f.values.ir,
      openapiFile: f.values.openapi,
      buildOpenapiFile: f.values["build-openapi"],
    },
  };
}

function cmdGenerate(args: string[]): number {
  const f = parseFlags(args, new Set(["build", "strict", "no-tests"]));
  const a = analyzeOpts(f);
  if (!a) return 2;

  // Precedence: built-in defaults < reqweave.config.json < flags.
  const config = loadConfig(a.path);
  a.opts.service = f.values.service ?? config.service ?? a.opts.service;
  a.opts.build = f.bools.has("build") || Boolean(config.build);

  const depth = (f.values.depth ?? config.depth ?? "standard") as Depth;
  if (!(DEPTH_LEVELS as readonly string[]).includes(depth)) {
    process.stderr.write(`reqweave: invalid --depth '${depth}'. One of: ${DEPTH_LEVELS.join(", ")}.\n`);
    return 2;
  }

  const configTools = config.tools === "all" || config.tools === undefined
    ? "all"
    : (config.tools as string[]).join(",");
  const toolsArg = f.values.tools ?? configTools;
  const tools: SupportedTool[] =
    toolsArg === "all" ? [...SUPPORTED_TOOLS] : toolsArg.split(",").map((t) => t.trim()).filter(Boolean) as SupportedTool[];
  const bad = tools.filter((t) => !isSupportedTool(t));
  if (bad.length > 0) {
    process.stderr.write(`reqweave: unknown tool(s): ${bad.join(", ")}. Known: ${SUPPORTED_TOOLS.join(", ")}.\n`);
    return 2;
  }

  const ir = analyze(a.path, a.opts);

  if (f.bools.has("strict") && ir.diagnostics.length > 0) {
    for (const d of ir.diagnostics) process.stderr.write(`  [${d.severity}] ${d.code}: ${d.message}\n`);
    process.stderr.write(`reqweave: --strict and ${ir.diagnostics.length} diagnostic(s) present; aborting.\n`);
    return 1;
  }

  const { variants, notes } = generateAll(ir, { depth });
  const files = exportCollections({
    ir,
    variants,
    tools,
    options: {
      baseUrl: f.values["base-url"] ?? config.baseUrl ?? DEFAULT_BASE_URL,
      generatedAt: f.values["generated-at"] ?? DEFAULT_GENERATED_AT,
      tests: f.bools.has("no-tests") ? false : config.tests ?? true,
    },
  });

  const outDir = resolve(f.values.out ?? config.out ?? "reqweave-out");
  for (const file of files) {
    const dest = join(outDir, file.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, file.content);
  }

  process.stdout.write(
    `reqweave: ${ir.endpoints.length} endpoint(s) -> ${variants.length} variant(s) -> ${files.length} file(s) ` +
      `for ${tools.length} tool(s) in ${outDir}\n`,
  );
  for (const n of notes) process.stdout.write(`  note: ${n}\n`);
  if (ir.diagnostics.length > 0) process.stdout.write(`  (${ir.diagnostics.length} diagnostic(s); pass --strict to fail on them)\n`);
  return 0;
}

function cmdList(args: string[]): number {
  const f = parseFlags(args, new Set(["build"]));
  const a = analyzeOpts(f);
  if (!a) return 2;
  const ir = analyze(a.path, a.opts);
  for (const ep of ir.endpoints) {
    process.stdout.write(`${ep.method.padEnd(6)} ${ep.routeTemplate}  (${ep.id})\n`);
  }
  process.stdout.write(`\n${ir.endpoints.length} endpoint(s).\n`);
  return 0;
}

function cmdInspect(args: string[]): number {
  const f = parseFlags(args, new Set(["build"]));
  const a = analyzeOpts(f);
  if (!a) return 2;
  const id = f.positionals[1];
  if (!id) {
    process.stderr.write("reqweave: inspect needs <path> <endpointId>.\n");
    return 2;
  }
  const ir = analyze(a.path, a.opts);
  const ep = ir.endpoints.find((e) => e.id === id);
  if (!ep) {
    process.stderr.write(`reqweave: no endpoint '${id}'.\n`);
    return 1;
  }
  const depth = (f.values.depth ?? "standard") as Depth;
  const { variants } = generateVariants(ep, { depth });
  process.stdout.write(`${ep.method} ${ep.routeTemplate}  (${ep.id})\n`);
  for (const v of variants) {
    process.stdout.write(`  - ${v.name}  [${v.expectedStatus}]  {${v.provenance.join(",")}}\n`);
  }
  return 0;
}

function cmdInit(args: string[]): number {
  const f = parseFlags(args, new Set(["force"]));
  const dir = resolve(f.positionals[0] ?? ".");
  const dest = join(dir, CONFIG_FILENAME);
  mkdirSync(dir, { recursive: true });
  try {
    // Atomic: "wx" fails if the file exists — avoids a check-then-write race.
    writeFileSync(dest, configTemplate(), f.bools.has("force") ? {} : { flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") {
      process.stderr.write(`reqweave: ${CONFIG_FILENAME} already exists (use --force to overwrite).\n`);
      return 1;
    }
    throw e;
  }
  process.stdout.write(`reqweave: wrote ${dest}\n`);
  return 0;
}

interface AgentTarget {
  base: string;
  kind: "dir" | "file" | "append";
  dest: string;
}

function agentTargets(): Record<string, AgentTarget> {
  const home = homedir();
  return {
    claude: { base: join(home, ".claude"), kind: "dir", dest: join(home, ".claude", "skills", "reqweave") },
    codex: { base: join(home, ".codex"), kind: "dir", dest: join(home, ".codex", "skills", "reqweave") },
    opencode: { base: join(home, ".config", "opencode"), kind: "dir", dest: join(home, ".config", "opencode", "skills", "reqweave") },
    cursor: { base: join(home, ".cursor"), kind: "file", dest: join(home, ".cursor", "rules", "reqweave.mdc") },
    gemini: { base: join(home, ".gemini"), kind: "append", dest: join(home, ".gemini", "GEMINI.md") },
    windsurf: { base: join(home, ".codeium", "windsurf"), kind: "append", dest: join(home, ".codeium", "windsurf", "memories", "global_rules.md") },
  };
}

/** Install the reqweave skill into each detected AI agent's skills dir (user level). */
function cmdInstall(args: string[]): number {
  const f = parseFlags(args, new Set(["force", "dry-run"]));
  const only = f.values.only ? splitCsv(f.values.only) : null;
  const skip = f.values.skip ? splitCsv(f.values.skip) : [];
  const skillDir = resolve(__dirname, "..", "..", "skills", "reqweave");
  if (!existsSync(skillDir)) {
    process.stderr.write(`reqweave: skill not found at ${skillDir}\n`);
    return 1;
  }

  const all = agentTargets();
  const names = Object.keys(all).filter((n) => (only ? only.includes(n) : true) && !skip.includes(n));
  process.stdout.write(`reqweave v${version()} - installing skill (user level)\n`);

  const marker = "<!-- reqweave -->";
  const pointer = `\n${marker}\nWhen asked to generate or import API collections from a service codebase, use the reqweave skill at ${join(skillDir, "SKILL.md")}.\n`;
  let any = false;

  for (const name of names) {
    const a = all[name] as AgentTarget;
    const forced = f.bools.has("force") || Boolean(only?.includes(name));
    if (!existsSync(a.base) && !forced) {
      process.stdout.write(`  ${name.padEnd(9)} skipped (not detected)\n`);
      continue;
    }
    if (f.bools.has("dry-run")) {
      process.stdout.write(`  ${name.padEnd(9)} would install -> ${a.dest}\n`);
      any = true;
      continue;
    }

    any = true;
    mkdirSync(dirname(a.dest), { recursive: true });
    if (a.kind === "dir") {
      try {
        // Let cpSync decide atomically: error if any dest file exists (no force).
        cpSync(skillDir, a.dest, { recursive: true, force: f.bools.has("force"), errorOnExist: !f.bools.has("force") });
        process.stdout.write(`  ${name.padEnd(9)} installed -> ${a.dest}\n`);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === "ERR_FS_CP_EEXIST" || code === "EEXIST") {
          process.stdout.write(`  ${name.padEnd(9)} exists (use --force)\n`);
        } else {
          throw e;
        }
      }
    } else if (a.kind === "file") {
      copyFileSync(join(skillDir, "SKILL.md"), a.dest);
      process.stdout.write(`  ${name.padEnd(9)} installed -> ${a.dest}\n`);
    } else {
      let current = "";
      try {
        current = readFileSync(a.dest, "utf8"); // read-or-empty; no check-then-act
      } catch {
        current = "";
      }
      if (current.includes(marker)) {
        process.stdout.write(`  ${name.padEnd(9)} already referenced\n`);
        continue;
      }
      writeFileSync(a.dest, current + pointer);
      process.stdout.write(`  ${name.padEnd(9)} pointer added -> ${a.dest}\n`);
    }
  }

  if (!any) {
    process.stdout.write("\n  No agents detected. Re-run with --only claude (or another) to force.\n");
  }
  return 0;
}

function splitCsv(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

function printUsage(): void {
  process.stdout.write(
    `reqweave v${version()} - code in, importable API collections out.\n\n` +
      `Usage:\n` +
      `  reqweave generate <path> [--out DIR] [--tools all|a,b] [--depth ${DEPTH_LEVELS.join("|")}]\n` +
      `                           [--lang auto|dotnet|ts|py|java] [--base-url URL] [--service NAME] [--build] [--build-openapi FILE] [--strict] [--no-tests] [--ir FILE] [--openapi FILE]\n` +
      `  reqweave list-endpoints <path> [--build] [--ir FILE]\n` +
      `  reqweave inspect <path> <endpointId> [--depth LEVEL] [--ir FILE]\n` +
      `  reqweave init [dir] [--force]            scaffold ${CONFIG_FILENAME}\n` +
      `  reqweave install [--only a,b] [--skip x] [--force] [--dry-run]   install the skill into your AI agents\n\n` +
      `Config: ${CONFIG_FILENAME} (tools/depth/baseUrl/out/service/tests/build); flags override it.\n` +
      `Tools: ${SUPPORTED_TOOLS.join(", ")}\n`,
  );
}
