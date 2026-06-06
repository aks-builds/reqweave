import type { Exporter, ExportContext, ExportedFile } from "./types.js";
import { assertionsFor, type AssertionSet } from "./assertions.js";
import { resolvePath, queryString, bodyText, deterministicId, groupByEndpoint, stableStringify, slug, usedVariables } from "./util.js";

function thunderTests(a: AssertionSet): unknown[] {
  const tests: unknown[] = [{ type: "res-code", custom: "", action: "equal", value: String(a.status) }];
  if (a.contentType) {
    tests.push({ type: "res-header", custom: "content-type", action: "contains", value: a.contentType });
  }
  return tests; // JSON-schema not expressible in Thunder tests -> fallback (status + content-type)
}

export const thunderExporter: Exporter = {
  id: "thunder-client",
  label: "Thunder Client",
  export(ctx: ExportContext): ExportedFile[] {
    const colId = deterministicId(`${ctx.ir.service.name}:thunder`);
    const at = ctx.options.generatedAt;
    let sort = 0;

    const requests: unknown[] = [];
    for (const g of groupByEndpoint(ctx.variants)) {
      for (const v of g.variants) {
        const body = bodyText(v);
        const request: Record<string, unknown> = {
          _id: deterministicId(`${v.endpointId}:${v.name}`),
          colId,
          containerId: "",
          name: v.name,
          url: `{{baseUrl}}${resolvePath(v.routeTemplate, v.pathParams)}${queryString(v.query)}`,
          method: v.method,
          sortNum: (sort += 1000),
          created: at,
          modified: at,
          headers: v.headers.map((h) => ({ name: h.name, value: h.value })),
          params: v.query.map((q) => ({ name: q.name, value: q.value, isPath: false })),
          body: body === undefined ? { type: "none" } : { type: "json", raw: body, form: [] },
        };
        if (ctx.options.tests) {
          request.tests = thunderTests(assertionsFor(ctx.ir, v));
        }
        requests.push(request);
      }
    }

    const collection = {
      clientName: "Thunder Client",
      collectionName: ctx.ir.service.name,
      colId,
      dateExported: at,
      version: "1.2",
      folders: [],
      requests,
    };

    const environment = {
      clientName: "Thunder Client",
      environmentName: `${ctx.ir.service.name} (reqweave)`,
      envId: deterministicId(`${ctx.ir.service.name}:thunder-env`),
      dateExported: at,
      version: "1.2",
      data: usedVariables(ctx.variants).map((k) => ({ name: k, value: k === "baseUrl" ? ctx.options.baseUrl : "" })),
    };

    const base = slug(ctx.ir.service.name);
    return [
      { path: `thunder-client/${base}.thunder-collection.json`, content: `${stableStringify(collection)}\n` },
      { path: `thunder-client/${base}.thunder-environment.json`, content: `${stableStringify(environment)}\n` },
    ];
  },
};
