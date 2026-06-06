import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { handleMessage } from "../src/mcp/server";
import { parseIr } from "../src/ir/index";
import { generateAll } from "../src/variants/index";
import { exportCollections } from "../src/exporters/index";

const here = path.dirname(fileURLToPath(import.meta.url));
const irFixture = path.join(here, "fixtures", "ir", "valid-petstore.json");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (name: string, args: Record<string, unknown>): any =>
  handleMessage({ jsonrpc: "2.0", id: 99, method: "tools/call", params: { name, arguments: args } });

describe("mcp protocol", () => {
  it("initialize returns reqweave serverInfo and echoes protocol version", () => {
    const r = handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) as any;
    expect(r.result.serverInfo.name).toBe("reqweave");
    expect(r.result.protocolVersion).toBe("2025-06-18");
    expect(r.result.capabilities.tools).toBeDefined();
  });

  it("tools/list advertises the three tools with input schemas", () => {
    const r = handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }) as any;
    const names = r.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(["list_endpoints", "generate_collection", "explain_variants"]));
    expect(r.result.tools[0].inputSchema.type).toBe("object");
  });

  it("notifications get no response", () => {
    expect(handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  });

  it("unknown method -> -32601; unknown tool -> -32602", () => {
    const m = handleMessage({ jsonrpc: "2.0", id: 3, method: "no/such" }) as any;
    expect(m.error.code).toBe(-32601);
    const t = handleMessage({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "bogus" } }) as any;
    expect(t.error.code).toBe(-32602);
  });
});

describe("mcp tools", () => {
  it("list_endpoints returns the IR endpoints", () => {
    const data = JSON.parse(call("list_endpoints", { ir: irFixture }).result.content[0].text);
    expect(data.endpoints).toHaveLength(2);
  });

  it("explain_variants explains an endpoint; unknown id is reported in-band", () => {
    const ok = call("explain_variants", { ir: irFixture, endpointId: "getPetById" });
    expect(JSON.parse(ok.result.content[0].text).variants.length).toBeGreaterThan(0);

    const bad = call("explain_variants", { ir: irFixture, endpointId: "nope" });
    expect(bad.result.isError).toBe(true);
  });

  it("generate_collection (inline) is byte-identical to a direct exportCollections call (CLI/MCP parity)", () => {
    const res = call("generate_collection", { ir: irFixture, tools: ["postman", "openapi"], depth: "standard" });
    const viaMcp = JSON.parse(res.result.content[0].text).files;

    const ir = parseIr(readFileSync(irFixture, "utf8"));
    const { variants } = generateAll(ir, { depth: "standard" });
    const direct = exportCollections({
      ir,
      variants,
      tools: ["postman", "openapi"],
      options: { baseUrl: "http://localhost:5000", generatedAt: "1970-01-01T00:00:00Z" },
    });

    expect(viaMcp).toEqual(direct);
  });
});
