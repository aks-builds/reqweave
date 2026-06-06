/**
 * Flask extractor: `@app.route("/path", methods=[...])` and Flask 2.0
 * `@app.<method>("/path")`. `<int:id>` → `{id}` route params (typed from the view
 * signature); query/body inferred best-effort from `request.args`/`request.json`
 * usage with diagnostics.
 */
import type { Endpoint, Param, Auth, Diagnostic } from "../../ir/schema.js";
import type { LogicalLine } from "./lines.js";
import { extractFunctions, type PyFunction } from "./defs.js";
import { mapPyType, newCtx, type ModelIndex } from "./types.js";
import { normalizeRoute, routeTokens, slug } from "./util.js";

const ROUTE_DEC = /^([A-Za-z_][A-Za-z0-9_.]*)\.(route|get|post|put|patch|delete|options|head)\s*\((.*)\)$/;
const HTTP = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);

export function extractFlask(filesLines: LogicalLine[][], index: ModelIndex, diags: Diagnostic[]): Endpoint[] {
  const endpoints: Endpoint[] = [];
  for (const lines of filesLines) {
    for (const fn of extractFunctions(lines)) {
      for (const dec of fn.decorators) {
        const m = ROUTE_DEC.exec(dec);
        if (!m) continue;
        const verb = m[2] as string;
        const args = m[3] as string;
        const path = firstStringArg(args);
        if (path === undefined) continue;
        const route = normalizeRoute(path);
        const methods = verb === "route" ? methodsKwarg(args) : [verb.toUpperCase()];
        for (const method of methods) {
          if (HTTP.has(method)) endpoints.push(buildEndpoint(fn, method as Endpoint["method"], route, index, diags));
        }
      }
    }
  }
  return endpoints;
}

function buildEndpoint(
  fn: PyFunction,
  method: Endpoint["method"],
  route: string,
  index: ModelIndex,
  diags: Diagnostic[],
): Endpoint {
  const ctx = newCtx(index, diags);
  const annByName = new Map(fn.params.map((p) => [p.name, p.type]));
  const params: Param[] = [];

  for (const tok of routeTokens(route)) {
    const ann = annByName.get(tok);
    params.push({ name: tok, in: "route", required: true, schema: ann ? mapPyType(ann, ctx) : { type: "string" } });
  }

  // Query usage: request.args.get('x') / request.args['x']
  const queryNames = new Set<string>();
  const qre = /request\.args(?:\.get\(\s*|\[\s*)['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = qre.exec(fn.body))) queryNames.add(m[1] as string);
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
    auth: detectAuth(fn),
  };

  if (/request\.(json|get_json\(|form\b|data\b)/.test(fn.body) && (method === "POST" || method === "PUT" || method === "PATCH")) {
    ep.requestBody = { required: false, contentType: "application/json", schema: { type: "object" } };
    diags.push({
      code: "assumedConvention",
      message: `${method} ${route}: Flask body shape is untyped; emitted a generic JSON body`,
      endpointId: id,
      severity: "info",
    });
  }
  return ep;
}

function detectAuth(fn: PyFunction): Auth {
  const decs = fn.decorators.join(" ");
  if (/jwt_required|token_required|@?\bbearer/i.test(decs)) {
    return { required: true, schemes: [{ type: "bearer", location: "header", name: "Authorization" }] };
  }
  if (/login_required|auth_required|requires_auth/i.test(decs)) {
    return { required: true, schemes: [{ type: "bearer", location: "header", name: "Authorization" }] };
  }
  return { required: false, schemes: [{ type: "none" }] };
}

function firstStringArg(args: string): string | undefined {
  const m = /^\s*(?:r|f)?(['"])((?:\\.|(?!\1).)*)\1/.exec(args);
  return m ? m[2] : undefined;
}

function methodsKwarg(args: string): string[] {
  const m = /methods\s*=\s*[[(]([^\])]*)[\])]/.exec(args);
  if (!m) return ["GET"];
  const list = [...(m[1] as string).matchAll(/['"]([A-Za-z]+)['"]/g)].map((x) => (x[1] as string).toUpperCase());
  return list.length ? list : ["GET"];
}
