/**
 * Express extractor: `app.<method>('/path', ...handlers)` / router calls. Express
 * is imperative and weakly typed, so route + path params are extracted precisely
 * while query/body are inferred best-effort from handler usage (with diagnostics).
 */
import type * as TS from "typescript";
import type { Endpoint, Param, Diagnostic } from "../../ir/schema.js";
import type { SourceIndex } from "./source-index.js";
import { normalizeRoute, routeTokens, slug } from "./util.js";

const METHODS: Record<string, Endpoint["method"]> = {
  get: "GET", post: "POST", put: "PUT", patch: "PATCH", delete: "DELETE", options: "OPTIONS", head: "HEAD",
};

export function extractExpress(index: SourceIndex, diags: Diagnostic[]): Endpoint[] {
  const ts = index.ts;
  const endpoints: Endpoint[] = [];

  for (const { sf } of index.sources) {
    visit(sf);
  }
  return endpoints;

  function visit(node: TS.Node): void {
    if (ts.isCallExpression(node)) tryRoute(node);
    node.forEachChild(visit);
  }

  function tryRoute(call: TS.CallExpression): void {
    const callee = call.expression;
    if (!ts.isPropertyAccessExpression(callee)) return;
    const method = METHODS[callee.name.text];
    if (!method) return;
    if (call.arguments.length < 2) return; // need path + at least one handler

    const first = call.arguments[0];
    if (!first || !(ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) return;
    const route = normalizeRoute(first.text);
    if (!route.startsWith("/")) return;

    const params: Param[] = [];
    for (const tok of routeTokens(route)) {
      params.push({ name: tok, in: "route", required: true, schema: { type: "string" } });
    }

    // Best-effort: scan the handler(s) for req.query.X and req.body usage.
    const handlerText = call.arguments.slice(1).map((a) => a.getText(a.getSourceFile())).join("\n");
    const queryNames = new Set<string>();
    const qre = /\.query\.([A-Za-z_$][A-Za-z0-9_$]*)/g;
    let m: RegExpExecArray | null;
    while ((m = qre.exec(handlerText))) queryNames.add(m[1] as string);
    for (const q of [...queryNames].sort()) {
      params.push({ name: q, in: "query", required: false, schema: { type: "string" } });
    }

    const id = `${method.toLowerCase()}_${slug(route)}`;
    const ep: Endpoint = {
      id,
      method,
      routeTemplate: route,
      params,
      responses: [{ status: method === "POST" ? 201 : 200 }],
      auth: { required: false, schemes: [{ type: "none" }] },
    };

    if (/\.body\b/.test(handlerText) && (method === "POST" || method === "PUT" || method === "PATCH")) {
      ep.requestBody = { required: false, contentType: "application/json", schema: { type: "object" } };
      diags.push({
        code: "assumedConvention",
        message: `${method} ${route}: Express body shape is untyped; emitted a generic JSON body`,
        endpointId: id,
        severity: "info",
      });
    }

    endpoints.push(ep);
  }
}
