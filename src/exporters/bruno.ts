import type { Exporter, ExportContext, ExportedFile } from "./types.js";
import type { RequestVariant } from "../variants/index.js";
import { assertionsFor, type AssertionSet } from "./assertions.js";
import { resolvePath, queryString, bodyText, groupByEndpoint, slug, usedVariables } from "./util.js";

function indentBlock(text: string): string {
  return text
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n");
}

function bru(v: RequestVariant, seq: number, assertions?: AssertionSet): string {
  const out: string[] = [];
  out.push("meta {", `  name: ${v.name}`, "  type: http", `  seq: ${seq}`, "}", "");

  const url = `{{baseUrl}}${resolvePath(v.routeTemplate, v.pathParams)}${queryString(v.query)}`;
  out.push(`${v.method.toLowerCase()} {`, `  url: ${url}`, `  body: ${v.body ? "json" : "none"}`, "  auth: none", "}", "");

  if (v.query.length > 0) {
    out.push("params:query {");
    for (const q of v.query) out.push(`  ${q.name}: ${q.value}`);
    out.push("}", "");
  }

  if (v.headers.length > 0) {
    out.push("headers {");
    for (const h of v.headers) out.push(`  ${h.name}: ${h.value}`);
    out.push("}", "");
  }

  const body = bodyText(v);
  if (body !== undefined) {
    out.push("body:json {", indentBlock(body), "}", "");
  }

  if (assertions) {
    out.push("assert {", `  res.status: eq ${assertions.status}`);
    if (assertions.contentType) out.push(`  res.headers.content-type: contains ${assertions.contentType}`);
    out.push("}", ""); // JSON-schema not expressible in Bruno assert -> fallback
  }

  return out.join("\n").trimEnd() + "\n";
}

export const brunoExporter: Exporter = {
  id: "bruno",
  label: "Bruno",
  export(ctx: ExportContext): ExportedFile[] {
    const files: ExportedFile[] = [];

    files.push({
      path: "bruno/bruno.json",
      content: `${JSON.stringify({ version: "1", name: ctx.ir.service.name, type: "collection", ignore: ["node_modules", ".git"] }, null, 2)}\n`,
    });

    const used = new Set<string>();
    let seq = 0;
    for (const g of groupByEndpoint(ctx.variants)) {
      for (const v of g.variants) {
        let name = `${slug(g.endpointId)}__${slug(v.name)}`;
        let n = 1;
        while (used.has(name)) name = `${slug(g.endpointId)}__${slug(v.name)}-${++n}`;
        used.add(name);
        const assertions = ctx.options.tests ? assertionsFor(ctx.ir, v) : undefined;
        files.push({ path: `bruno/${name}.bru`, content: bru(v, ++seq, assertions) });
      }
    }

    const vars = usedVariables(ctx.variants)
      .map((k) => `  ${k}: ${k === "baseUrl" ? ctx.options.baseUrl : ""}`)
      .join("\n");
    files.push({ path: "bruno/environments/Local.bru", content: `vars {\n${vars}\n}\n` });

    return files;
  },
};
