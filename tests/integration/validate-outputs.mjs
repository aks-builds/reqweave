#!/usr/bin/env node
// Validates a `reqweave generate --tools all` output directory end to end.
// Dependency-free; used by .github/workflows/integration.yml after the real
// analyzer (dotnet) -> CLI run. Exits non-zero on any failure.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const outDir = process.argv[2];
if (!outDir || !existsSync(outDir)) {
  console.error(`validate: output dir not found: ${outDir}`);
  process.exit(2);
}

let failures = 0;
const check = (label, cond) => {
  console.log(`${cond ? "  ok  " : " FAIL "} ${label}`);
  if (!cond) failures++;
};

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const files = walk(outDir);
const find = (needle) => files.find((f) => f.replace(/\\/g, "/").includes(needle));
const readJson = (needle) => {
  const f = find(needle);
  if (!f) throw new Error(`missing file matching ${needle}`);
  return JSON.parse(readFileSync(f, "utf8"));
};

try {
  // All JSON outputs parse.
  for (const f of files.filter((x) => x.endsWith(".json"))) {
    try {
      JSON.parse(readFileSync(f, "utf8"));
    } catch (e) {
      check(`valid JSON: ${f}`, false);
    }
  }

  const postman = readJson(".postman_collection.json");
  check("postman: v2.1 schema", String(postman.info?.schema).includes("v2.1.0"));
  check("postman: grouped into 5 endpoints", Array.isArray(postman.item) && postman.item.length === 5);
  check("postman: uses {{baseUrl}}", JSON.stringify(postman).includes("{{baseUrl}}"));

  const openapi = readJson(".openapi.json");
  check("openapi: 3.1.0", openapi.openapi === "3.1.0");
  check("openapi: /api/Pets path", Boolean(openapi.paths?.["/api/Pets"]));
  check("openapi: /api/Pets/{id} path", Boolean(openapi.paths?.["/api/Pets/{id}"]));
  check("openapi: bearer security scheme", openapi.components?.securitySchemes?.bearerAuth?.scheme === "bearer");

  const insomnia = readJson(".insomnia.json");
  check("insomnia: v4 export", insomnia.__export_format === 4);
  check("insomnia: {{ _.var }} syntax", JSON.stringify(insomnia).includes("{{ _.baseUrl }}"));

  check("hoppscotch: <<var>> syntax", readFileSync(find(".hoppscotch-collection.json"), "utf8").includes("<<baseUrl>>"));

  check("bruno: collection manifest", Boolean(find("bruno/bruno.json")));
  check("bruno: has .bru request files", files.some((f) => f.endsWith(".bru") && !f.includes("environments")));

  const thunder = readJson(".thunder-collection.json");
  check("thunder: deterministic dateExported", thunder.dateExported === "2026-01-01T00:00:00Z");

  const httpFile = find(".http");
  check("http: REST Client file present", Boolean(httpFile));
  if (httpFile) check("http: uses {{baseUrl}}", readFileSync(httpFile, "utf8").includes("{{baseUrl}}"));

  // No secrets leaked: every env template leaves secret slots blank.
  const postmanEnv = readJson(".postman_environment.json");
  const bearer = postmanEnv.values.find((v) => v.key === "bearerToken");
  check("env: bearerToken blank (no secret leak)", bearer && bearer.value === "");
} catch (e) {
  console.error(`validate: ${e.message}`);
  process.exit(1);
}

console.log("");
if (failures > 0) {
  console.error(`validate: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log(`validate: all checks passed (${files.length} files).`);
