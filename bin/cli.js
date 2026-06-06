#!/usr/bin/env node
"use strict";
/*
 * reqweave CLI entry point. Thin wrapper that runs the compiled core.
 * Read your service code; generate ready-to-import API collections for every
 * API testing tool, with exhaustive request variants per endpoint.
 */
const path = require("path");

let cli;
try {
  cli = require(path.join(__dirname, "..", "dist", "cli", "index.js"));
} catch (e) {
  console.error(
    `reqweave: build output not found (dist/). Run \`npm run build\` first.\n  (${e && e.message})`,
  );
  process.exit(1);
}

try {
  process.exit(cli.run(process.argv.slice(2)));
} catch (e) {
  console.error(`reqweave: ${(e && e.message) || e}`);
  process.exit(1);
}
