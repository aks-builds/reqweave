/**
 * Minimal, dependency-free MCP stdio server (JSON-RPC 2.0, newline-delimited).
 * Implements initialize / tools/list / tools/call over the reqweave core.
 * `handleMessage` is pure and synchronous so it's directly unit-testable;
 * `startStdioServer` wires it to stdin/stdout.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TOOLS } from "./tools.js";

const PROTOCOL_VERSION = "2025-06-18";

function version(): string {
  try {
    return JSON.parse(readFileSync(resolve(__dirname, "..", "..", "package.json"), "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

interface JsonRpc {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

const ok = (id: JsonRpc["id"], result: unknown) => ({ jsonrpc: "2.0" as const, id, result });
const err = (id: JsonRpc["id"], code: number, message: string) => ({ jsonrpc: "2.0" as const, id, error: { code, message } });

/** Handle one JSON-RPC message; returns the response, or null for notifications. */
export function handleMessage(msg: JsonRpc): object | null {
  switch (msg.method) {
    case "initialize":
      return ok(msg.id ?? null, {
        protocolVersion: (msg.params?.protocolVersion as string) ?? PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "reqweave", version: version() },
      });

    case "tools/list":
      return ok(msg.id ?? null, {
        tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      });

    case "tools/call": {
      const name = msg.params?.name as string | undefined;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return err(msg.id ?? null, -32602, `unknown tool: ${name}`);
      try {
        const text = tool.handler((msg.params?.arguments as Record<string, unknown>) ?? {});
        return ok(msg.id ?? null, { content: [{ type: "text", text }] });
      } catch (e) {
        // Tool errors are reported in-band (isError) per MCP, not as protocol errors.
        return ok(msg.id ?? null, { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true });
      }
    }

    default:
      // Notifications (no id) get no response; unknown requests get method-not-found.
      if (msg.id === undefined || msg.id === null) return null;
      return err(msg.id, -32601, `method not found: ${msg.method}`);
  }
}

export function startStdioServer(): void {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg: JsonRpc;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // ignore unparseable lines
      }
      const response = handleMessage(msg);
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  });
  process.stdin.on("end", () => process.exit(0));
}
