import type { Exporter, ExportContext, ExportedFile } from "./types.js";
import type { RequestVariant } from "../variants/index.js";
import { assertionsFor, type AssertionSet } from "./assertions.js";
import { resolvePath, rewritePlaceholders, bodyText, groupByEndpoint, stableStringify, slug, usedVariables } from "./util.js";

const tx = (s: string) => rewritePlaceholders(s, "angle");

function testScript(a: AssertionSet): string {
  const lines = [`pw.test("status is ${a.status}", () => { pw.expect(pw.response.status).toBe(${a.status}); });`];
  if (a.contentType) {
    lines.push(
      `pw.test("content-type is ${a.contentType}", () => { pw.expect(pw.response.headers["content-type"] || "").toInclude("${a.contentType}"); });`,
    );
  }
  return lines.join("\n"); // JSON-schema not expressible -> fallback (status + content-type)
}

function request(v: RequestVariant, assertions?: AssertionSet): unknown {
  const body = bodyText(v);
  return {
    v: "11",
    name: v.name,
    method: v.method,
    endpoint: tx(`<<baseUrl>>${resolvePath(v.routeTemplate, v.pathParams)}`),
    params: v.query.map((q) => ({ key: q.name, value: tx(q.value), active: true })),
    headers: v.headers.map((h) => ({ key: h.name, value: tx(h.value), active: true })),
    body:
      body === undefined
        ? { contentType: null, body: null }
        : { contentType: v.body!.contentType, body: tx(body) },
    auth: { authType: "none", authActive: false },
    preRequestScript: "",
    testScript: assertions ? testScript(assertions) : "",
  };
}

export const hoppscotchExporter: Exporter = {
  id: "hoppscotch",
  label: "Hoppscotch",
  export(ctx: ExportContext): ExportedFile[] {
    const collection = {
      v: 6,
      name: ctx.ir.service.name,
      folders: groupByEndpoint(ctx.variants).map((g) => ({
        v: 6,
        name: g.endpointId,
        folders: [],
        requests: g.variants.map((v) => request(v, ctx.options.tests ? assertionsFor(ctx.ir, v) : undefined)),
        auth: { authType: "none", authActive: false },
        headers: [],
      })),
      requests: [],
      auth: { authType: "none", authActive: false },
      headers: [],
    };

    const environment = {
      v: 2,
      name: `${ctx.ir.service.name} (reqweave)`,
      variables: usedVariables(ctx.variants).map((key) => ({
        key,
        value: key === "baseUrl" ? ctx.options.baseUrl : "",
        secret: key !== "baseUrl",
      })),
    };

    const base = slug(ctx.ir.service.name);
    return [
      { path: `hoppscotch/${base}.hoppscotch-collection.json`, content: `${stableStringify(collection)}\n` },
      { path: `hoppscotch/${base}.hoppscotch-environment.json`, content: `${stableStringify(environment)}\n` },
    ];
  },
};
