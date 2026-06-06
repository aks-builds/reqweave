#!/usr/bin/env node
"use strict";
/* reqweave MCP server entry point (stdio). Exposes the reqweave core as MCP
 * tools for any MCP-capable agent. */
const path = require("path");

let mcp;
try {
  mcp = require(path.join(__dirname, "..", "dist", "mcp", "server.js"));
} catch (e) {
  console.error(`reqweave-mcp: build output not found (dist/). Run \`npm run build\`.\n  (${e && e.message})`);
  process.exit(1);
}

mcp.startStdioServer();
