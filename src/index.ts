/**
 * reqweave core library — public entry point.
 *
 * Re-exports the IR contract (Phase 1). The variant engine (Phase 4) and
 * exporters (Phase 5) attach here in later phases.
 */

export * from "./ir/index.js";

/** Tools reqweave can export to in M1. */
export const SUPPORTED_TOOLS = [
  "postman",
  "openapi",
  "insomnia",
  "bruno",
  "hoppscotch",
  "thunder-client",
  "http",
] as const;

export type SupportedTool = (typeof SUPPORTED_TOOLS)[number];

/** Variant breadth levels for the generation engine (Phase 4). */
export const DEPTH_LEVELS = ["minimal", "standard", "exhaustive"] as const;

export type Depth = (typeof DEPTH_LEVELS)[number];

/** Returns true if `tool` is a tool reqweave can export to. */
export function isSupportedTool(tool: string): tool is SupportedTool {
  return (SUPPORTED_TOOLS as readonly string[]).includes(tool);
}
