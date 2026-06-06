/**
 * reqweave MCP tools — the same core (analyzer -> engine -> exporters) exposed
 * for any MCP-capable agent. Handlers are pure-ish and synchronous; they return
 * a text payload (JSON). Codebase-safe: they read source and write only to an
 * explicit outDir.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { analyze } from "../cli/analyzer-runner.js";
import { generateAll, generateVariants } from "../variants/index.js";
import { exportCollections } from "../exporters/index.js";
import { DEFAULT_BASE_URL, DEFAULT_GENERATED_AT } from "../exporters/types.js";
import { SUPPORTED_TOOLS, DEPTH_LEVELS, isSupportedTool, type SupportedTool, type Depth } from "../constants.js";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => string;
}

const sourceProps = {
  path: { type: "string", description: "Path to the service codebase (directory/.csproj/.sln)." },
  ir: { type: "string", description: "Path to an existing IR JSON; skips the analyzer." },
  build: { type: "boolean", description: "Use build-mode analysis (requires the .NET SDK)." },
};

function irFrom(args: Record<string, unknown>) {
  return analyze((args.path as string) ?? ".", {
    irFile: args.ir as string | undefined,
    build: Boolean(args.build),
    service: args.service as string | undefined,
    generatedAt: DEFAULT_GENERATED_AT,
  });
}

function resolveTools(arg: unknown): SupportedTool[] {
  const tools =
    Array.isArray(arg) && arg.length > 0 ? (arg as string[]) : [...SUPPORTED_TOOLS];
  const bad = tools.filter((t) => !isSupportedTool(t));
  if (bad.length > 0) throw new Error(`unknown tool(s): ${bad.join(", ")}`);
  return tools as SupportedTool[];
}

function resolveDepth(arg: unknown): Depth {
  const depth = (arg as string) ?? "standard";
  if (!(DEPTH_LEVELS as readonly string[]).includes(depth)) {
    throw new Error(`invalid depth '${depth}'`);
  }
  return depth as Depth;
}

export const TOOLS: ToolDef[] = [
  {
    name: "list_endpoints",
    description: "List the API endpoints discovered in a service codebase.",
    inputSchema: { type: "object", properties: sourceProps },
    handler(args) {
      const ir = irFrom(args);
      return JSON.stringify(
        {
          service: ir.service.name,
          endpoints: ir.endpoints.map((e) => ({ id: e.id, method: e.method, route: e.routeTemplate })),
          diagnostics: ir.diagnostics.length,
        },
        null,
        2,
      );
    },
  },
  {
    name: "generate_collection",
    description:
      "Generate importable API collections (Postman, OpenAPI, Insomnia, Bruno, Hoppscotch, Thunder Client, .http) with request variants. Writes to outDir if given, otherwise returns file contents inline.",
    inputSchema: {
      type: "object",
      properties: {
        ...sourceProps,
        tools: { type: "array", items: { type: "string", enum: [...SUPPORTED_TOOLS] }, description: "Defaults to all." },
        depth: { type: "string", enum: [...DEPTH_LEVELS], description: "Variant breadth (default standard)." },
        baseUrl: { type: "string" },
        outDir: { type: "string", description: "Write files here; omit to return contents inline." },
      },
    },
    handler(args) {
      const ir = irFrom(args);
      const depth = resolveDepth(args.depth);
      const tools = resolveTools(args.tools);
      const { variants, notes } = generateAll(ir, { depth });
      const files = exportCollections({
        ir,
        variants,
        tools,
        options: { baseUrl: (args.baseUrl as string) ?? DEFAULT_BASE_URL, generatedAt: DEFAULT_GENERATED_AT },
      });

      const summary = { service: ir.service.name, endpoints: ir.endpoints.length, variants: variants.length, files: files.length, tools };

      if (args.outDir) {
        const outDir = resolve(args.outDir as string);
        for (const f of files) {
          const dest = join(outDir, f.path);
          mkdirSync(dirname(dest), { recursive: true });
          writeFileSync(dest, f.content);
        }
        return JSON.stringify({ summary, outDir, notes }, null, 2);
      }
      return JSON.stringify({ summary, files, notes }, null, 2);
    },
  },
  {
    name: "explain_variants",
    description: "Explain the request variants reqweave would generate for one endpoint.",
    inputSchema: {
      type: "object",
      properties: { ...sourceProps, endpointId: { type: "string" }, depth: { type: "string", enum: [...DEPTH_LEVELS] } },
      required: ["endpointId"],
    },
    handler(args) {
      const ir = irFrom(args);
      const ep = ir.endpoints.find((e) => e.id === args.endpointId);
      if (!ep) throw new Error(`no endpoint '${String(args.endpointId)}'`);
      const { variants } = generateVariants(ep, { depth: resolveDepth(args.depth) });
      return JSON.stringify(
        {
          endpoint: { id: ep.id, method: ep.method, route: ep.routeTemplate },
          variants: variants.map((v) => ({ name: v.name, expectedStatus: v.expectedStatus, provenance: v.provenance })),
        },
        null,
        2,
      );
    },
  },
];
