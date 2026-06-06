import type { Exporter, ExportContext, ExportedFile } from "./types.js";
import type { RequestVariant } from "../variants/index.js";
import {
  resolvePath,
  queryString,
  deterministicId,
  groupByEndpoint,
  bodyText,
  stableStringify,
  slug,
  usedVariables,
} from "./util.js";

function requestItem(v: RequestVariant): unknown {
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

  return { name: v.name, request };
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
      item: groupByEndpoint(ctx.variants).map((g) => ({
        name: g.endpointId,
        item: g.variants.map(requestItem),
      })),
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
