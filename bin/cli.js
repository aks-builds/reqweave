#!/usr/bin/env node
"use strict";
/*
 * reqweave — agent-agnostic CLI (Phase 0 stub).
 *
 * Reads a service codebase and generates ready-to-import API collections for
 * every major API testing tool, with exhaustive request variants per endpoint.
 *
 * This is the Phase 0 bootstrap entry point: it wires up `--help` / `--version`
 * and stubs the planned commands so the package is installable and the surface
 * is testable. Real command implementations land in later phases (see
 * docs/superpowers/plans).
 */
const path = require("path");

const VERSION = require(path.join(__dirname, "..", "package.json")).version;

const COMMANDS = {
  generate: "Generate API collections from a service codebase (coming soon).",
  "list-endpoints": "List the endpoints discovered in a codebase (coming soon).",
  inspect: "Inspect a single endpoint and its generated variants (coming soon).",
};

function usage() {
  const cmds = Object.entries(COMMANDS)
    .map(([name, desc]) => `  ${name.padEnd(16)} ${desc}`)
    .join("\n");
  console.log(`reqweave v${VERSION} — code in, importable API collections out.

Usage:
  reqweave <command> [options]

Commands:
${cmds}

Options:
  -h, --help       Show this help.
  -v, --version    Print the version.

Docs: https://github.com/aks-builds/reqweave#readme
`);
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === "-h" || cmd === "--help") {
    usage();
    return 0;
  }
  if (cmd === "-v" || cmd === "--version") {
    console.log(VERSION);
    return 0;
  }
  if (cmd in COMMANDS) {
    console.error(`reqweave: '${cmd}' is not implemented yet (Phase 0 stub).`);
    return 3;
  }
  console.error(`reqweave: unknown command '${cmd}'. Run 'reqweave --help'.`);
  return 2;
}

process.exit(main());
