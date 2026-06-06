/**
 * FastAPI extractor: `@app/@router.<method>("/path", …)` (and `api_route(methods=)`)
 * with function-signature params, `response_model`/return-type responses, and
 * Pydantic-model bodies resolved via the model index.
 */
import type { Endpoint, Param, ApiResponse, Auth, Diagnostic } from "../../ir/schema.js";
import type { LogicalLine } from "./lines.js";
import { extractFunctions, type PyFunction, type PyParam } from "./defs.js";
import { mapPyType, newCtx, type ModelIndex } from "./types.js";
import { normalizeRoute, routeTokens, slug } from "./util.js";

const ROUTE_DEC = /^([A-Za-z_][A-Za-z0-9_.]*)\.(get|post|put|patch|delete|options|head|api_route)\s*\((.*)\)$/;
const HTTP = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);

export function extractFastApi(filesLines: LogicalLine[][], index: ModelIndex, diags: Diagnostic[]): Endpoint[] {
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

        const methods = verb === "api_route" ? methodsKwarg(args) : [verb.toUpperCase()];
        for (const method of methods) {
          if (!HTTP.has(method)) continue;
          endpoints.push(buildEndpoint(fn, method as Endpoint["method"], route, args, index, diags));
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
  decArgs: string,
  index: ModelIndex,
  diags: Diagnostic[],
): Endpoint {
  const ctx = newCtx(index, diags);
  const tokens = new Set(routeTokens(route));
  const params: Param[] = [];
  let requestBody: Endpoint["requestBody"];

  for (const p of fn.params) {
    if (isDependency(p)) continue;
    const required = p.default === undefined && !/Optional\[|\|\s*None/.test(p.type ?? "");

    if (tokens.has(p.name) || has(p.default, "Path(")) {
      params.push({ name: p.name, in: "route", required: true, schema: p.type ? mapPyType(p.type, ctx) : { type: "string" } });
    } else if (has(p.default, "Body(")) {
      requestBody = { required, contentType: "application/json", schema: p.type ? mapPyType(p.type, ctx) : {} };
    } else if (has(p.default, "Header(")) {
      params.push({ name: p.name, in: "header", required, schema: { type: "string" } });
    } else if (has(p.default, "Query(")) {
      params.push({ name: p.name, in: "query", required, schema: p.type ? mapPyType(p.type, ctx) : { type: "string" } });
    } else if (p.type && resolvesToModel(p.type, index)) {
      requestBody = { required, contentType: "application/json", schema: mapPyType(p.type, ctx) };
    } else {
      params.push({ name: p.name, in: "query", required, schema: p.type ? mapPyType(p.type, ctx) : { type: "string" } });
    }
  }

  // Ensure every route token has a param.
  for (const tok of tokens) {
    if (!params.some((x) => x.in === "route" && x.name === tok)) {
      params.push({ name: tok, in: "route", required: true, schema: { type: "string" } });
    }
  }

  const status = numberKwarg(decArgs, "status_code") ?? 200;
  const responses: ApiResponse[] = [buildResponse(fn, status, decArgs, ctx)];
  const auth = detectAuth(fn, decArgs);
  const tags = stringListKwarg(decArgs, "tags");

  const ep: Endpoint = {
    id: fn.name,
    method,
    routeTemplate: route,
    params,
    responses,
    auth,
  };
  if (requestBody) ep.requestBody = requestBody;
  if (tags.length) ep.tags = tags;
  return ep;
}

function buildResponse(fn: PyFunction, status: number, decArgs: string, ctx: ReturnType<typeof newCtx>): ApiResponse {
  const model = stringValueKwarg(decArgs, "response_model");
  let schema = model ? mapPyType(model, ctx) : fn.returnType ? mapPyType(fn.returnType, ctx) : undefined;
  if (schema && (Object.keys(schema).length === 0 || schema.type === "null")) schema = undefined;
  const res: ApiResponse = { status };
  if (schema) {
    res.contentType = "application/json";
    res.schema = schema;
  }
  return res;
}

function detectAuth(fn: PyFunction, decArgs: string): Auth {
  const hay = [decArgs, ...fn.params.map((p) => p.default ?? ""), ...fn.params.map((p) => p.type ?? "")].join(" ");
  if (/HTTPBasic\b/.test(hay)) return { required: true, schemes: [{ type: "basic" }] };
  if (/APIKeyHeader|APIKeyQuery|api_key/i.test(hay)) {
    return { required: true, schemes: [{ type: "apiKey", location: "header", name: "X-API-Key" }] };
  }
  if (/Security\(|oauth2|OAuth2|HTTPBearer|get_current_user|Depends\([^)]*token/i.test(hay)) {
    return { required: true, schemes: [{ type: "bearer", location: "header", name: "Authorization" }] };
  }
  return { required: false, schemes: [{ type: "none" }] };
}

function isDependency(p: PyParam): boolean {
  if (has(p.default, "Depends(")) return true;
  const t = (p.type ?? "").split("[")[0]?.split(".").pop() ?? "";
  return ["Request", "Response", "BackgroundTasks", "Session", "WebSocket", "UploadFile"].includes(t);
}

function resolvesToModel(type: string, index: ModelIndex): boolean {
  const core = coreName(type);
  return core ? index.get(core)?.kind === "model" : false;
}

/** Unwrap Optional[X]/List[X]/X|None down to a single named type, if any. */
function coreName(type: string): string | undefined {
  let t = type.trim();
  for (let i = 0; i < 8; i++) {
    t = t.replace(/\|\s*None|None\s*\|/g, "").trim();
    const open = t.indexOf("[");
    if (open !== -1 && t.endsWith("]")) {
      const base = t.slice(0, open).trim().split(".").pop() as string;
      if (["List", "list", "Optional", "Sequence", "Set", "FrozenSet", "Iterable"].includes(base)) {
        t = t.slice(open + 1, t.lastIndexOf("]")).trim();
        // for List[X] there's one arg; for Dict skip
        if (base.toLowerCase() === "dict" || base.toLowerCase() === "mapping") return undefined;
        continue;
      }
      return undefined; // some other generic
    }
    break;
  }
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(t) ? (t.split(".").pop() as string) : undefined;
}

// --- decorator-argument helpers ---------------------------------------------
function firstStringArg(args: string): string | undefined {
  const m = /^\s*(?:r|f)?(['"])((?:\\.|(?!\1).)*)\1/.exec(args);
  return m ? m[2] : undefined;
}

function methodsKwarg(args: string): string[] {
  const m = /methods\s*=\s*\[([^\]]*)\]/.exec(args);
  if (!m) return [];
  return [...(m[1] as string).matchAll(/['"]([A-Za-z]+)['"]/g)].map((x) => (x[1] as string).toUpperCase());
}

function numberKwarg(args: string, key: string): number | undefined {
  const m = new RegExp(`${key}\\s*=\\s*(\\d+)`).exec(args);
  return m ? Number(m[1]) : undefined;
}

function stringValueKwarg(args: string, key: string): string | undefined {
  const m = new RegExp(`${key}\\s*=\\s*([A-Za-z_][A-Za-z0-9_.\\[\\], ]*)`).exec(args);
  return m ? (m[1] as string).trim() : undefined;
}

function stringListKwarg(args: string, key: string): string[] {
  const m = new RegExp(`${key}\\s*=\\s*\\[([^\\]]*)\\]`).exec(args);
  if (!m) return [];
  return [...(m[1] as string).matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1] as string);
}

function has(s: string | undefined, needle: string): boolean {
  return Boolean(s && s.includes(needle));
}
