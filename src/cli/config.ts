/**
 * Optional project config: reqweave.config.json. Loaded from the target path's
 * directory (then cwd). Precedence at the CLI: built-in defaults < config < flags.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEPTH_LEVELS, SUPPORTED_TOOLS, type Depth } from "../constants.js";

export interface ReqweaveConfig {
  tools?: string[] | "all";
  depth?: Depth;
  baseUrl?: string;
  out?: string;
  service?: string;
  tests?: boolean;
  build?: boolean;
}

export const CONFIG_FILENAME = "reqweave.config.json";

/** Load reqweave.config.json from `startDir`, then the cwd. Returns {} if none. */
export function loadConfig(startDir: string): ReqweaveConfig {
  const dirs = [resolve(startDir), process.cwd()];
  for (const dir of dirs) {
    const file = join(dir, CONFIG_FILENAME);
    if (!existsSync(file)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      throw new Error(`invalid ${CONFIG_FILENAME}: ${(e as Error).message}`);
    }
    return validate(parsed, file);
  }
  return {};
}

function validate(raw: unknown, file: string): ReqweaveConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`${file}: expected a JSON object`);
  }
  const c = raw as Record<string, unknown>;
  if (c.depth !== undefined && !(DEPTH_LEVELS as readonly string[]).includes(c.depth as string)) {
    throw new Error(`${file}: invalid depth '${String(c.depth)}'`);
  }
  if (Array.isArray(c.tools)) {
    const bad = (c.tools as string[]).filter((t) => !(SUPPORTED_TOOLS as readonly string[]).includes(t));
    if (bad.length) throw new Error(`${file}: unknown tool(s): ${bad.join(", ")}`);
  }
  return c as ReqweaveConfig;
}

/** A starter config written by `reqweave init`. */
export function configTemplate(): string {
  return `${JSON.stringify(
    {
      tools: "all",
      depth: "standard",
      baseUrl: "http://localhost:5000",
      out: "reqweave-out",
      tests: true,
    },
    null,
    2,
  )}\n`;
}
