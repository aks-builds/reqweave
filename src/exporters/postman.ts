import type { Exporter, ExportContext, ExportedFile } from "./types.js";
import type { RequestVariant } from "../variants/index.js";
import { assertionsFor, type AssertionSet } from "./assertions.js";
import {
  resolvePath,
  queryString,
  deterministicId,
  groupByTag,
  bodyText,
  stableStringify,
  slug,
  usedVariables,
} from "./util.js";

function testEvent(a: AssertionSet): unknown {
  const exec = [`pm.test("status is ${a.status}", function () { pm.response.to.have.status(${a.status}); });`];
  if (a.contentType) {
    exec.push(
      `pm.test("content-type is ${a.contentType}", function () { pm.expect(String(pm.response.headers.get("Content-Type") || "")).to.include("${a.contentType}"); });`,
    );
  }
  if (a.jsonSchema) {
    exec.push(
      `pm.test("response matches schema", function () { pm.response.to.have.jsonSchema(${JSON.stringify(a.jsonSchema)}); });`,
    );
  }
  return { listen: "test", script: { type: "text/javascript", exec } };
}

function requestItem(v: RequestVariant, assertions?: AssertionSet): unknown {
  const path = resolvePath(v.routeTemplate, v.pathParams).split("/").filter(Boolean);
  const url: Record<string, unknown> = {
    raw: `{{baseUrl}}${resolvePath(v.routeTemplate, v.pathParams)}${queryString(v.query)}`,
    host: ["{{baseUrl}}"],
    path,
  };
  if (v.query.length > 0) {
    url.query = v.query.map((q) => ({ key: q.name, value: q.value }));
  }

  const request: Record<string, unknown> = {
    method: v.method,
    header: v.headers.map((h) => ({ key: h.name, value: h.value })),
    url,
  };

  const body = bodyText(v);
  if (body !== undefined) {
    request.body = { mode: "raw", raw: body, options: { raw: { language: "json" } } };
  }

  const item: Record<string, unknown> = { name: v.name, request };
  if (assertions) {
    item.event = [testEvent(assertions)];
  }
  return item;
}

export const postmanExporter: Exporter = {
  id: "postman",
  label: "Postman v2.1",
  export(ctx: ExportContext): ExportedFile[] {
    const collection = {
      info: {
        _postman_id: deterministicId(`${ctx.ir.service.name}:postman`),
        name: ctx.ir.service.name,
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      },
      item: groupByTag(ctx.ir, ctx.variants).map((tg) => {
        const endpointFolders = tg.endpoints.map((g) => ({
          name: g.endpointId,
          item: g.variants.map((v) => requestItem(v, ctx.options.tests ? assertionsFor(ctx.ir, v) : undefined)),
        }));
        // Untagged endpoint (tag === id, single endpoint): don't double-wrap.
        if (tg.endpoints.length === 1 && tg.tag === tg.endpoints[0]?.endpointId) {
          return endpointFolders[0];
        }
        return { name: tg.tag, item: endpointFolders };
      }),
      variable: [{ key: "baseUrl", value: ctx.options.baseUrl }],
    };

    const environment = {
      id: deterministicId(`${ctx.ir.service.name}:postman-env`),
      name: `${ctx.ir.service.name} (reqweave)`,
      values: usedVariables(ctx.variants).map((key) => ({
        key,
        value: key === "baseUrl" ? ctx.options.baseUrl : "",
        enabled: true,
      })),
      _postman_variable_scope: "environment",
    };

    const base = slug(ctx.ir.service.name);
    return [
      { path: `postman/${base}.postman_collection.json`, content: `${stableStringify(collection)}\n` },
      { path: `postman/${base}.postman_environment.json`, content: `${stableStringify(environment)}\n` },
    ];
  },
};
