/**
 * Spring Boot extractor: @RestController/@Controller classes, @RequestMapping base
 * paths, @GetMapping/... methods, @PathVariable/@RequestParam/@RequestHeader/
 * @RequestBody params, return-type responses, @ResponseStatus, and
 * @PreAuthorize/@Secured auth. Brace-aware scanning (no parser dependency).
 */
import type { Endpoint, Param, Auth, Diagnostic } from "../../ir/schema.js";
import { matchBracket, splitArgs, firstStringLiteral } from "../clike/lex.js";
import { findRegions, type JavaClass } from "./models.js";
import { mapJavaType, unwrapResponse, newJavaCtx, type JavaCtx } from "./types.js";

const MAPPING_RE = /@(Get|Post|Put|Delete|Patch)Mapping\b|@RequestMapping\b/g;
const VERB: Record<string, Endpoint["method"]> = {
  Get: "GET", Post: "POST", Put: "PUT", Delete: "DELETE", Patch: "PATCH",
};
const SKIP_PARAM_TYPES = new Set([
  "HttpServletRequest", "HttpServletResponse", "ServletRequest", "ServletResponse",
  "Model", "ModelMap", "Principal", "Authentication", "Pageable", "BindingResult",
  "UriComponentsBuilder", "HttpSession", "Locale", "WebRequest", "RedirectAttributes",
]);
const STATUS: Record<string, number> = {
  OK: 200, CREATED: 201, ACCEPTED: 202, NO_CONTENT: 204, NOT_FOUND: 404,
  BAD_REQUEST: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_MODIFIED: 304,
};

export function extractSpring(clean: string, index: Map<string, JavaClass>, diags: Diagnostic[]): Endpoint[] {
  const endpoints: Endpoint[] = [];
  const regions = findRegions(clean);
  const controllers = regions.filter((r) => /@RestController\b|@Controller\b/.test(r.annotations));

  for (const region of controllers) {
    const basePath = mappingPath(requestMappingArgs(region.annotations));
    const classAuth = authFrom(region.annotations);

    MAPPING_RE.lastIndex = region.bodyStart;
    let m: RegExpExecArray | null;
    while ((m = MAPPING_RE.exec(clean)) && m.index < region.bodyEnd) {
      const annName = m[0];
      const after = skipWs(clean, m.index + annName.length);
      let args = "";
      let argsEnd = after;
      if (clean[after] === "(") {
        const close = matchBracket(clean, after);
        if (close !== -1) {
          args = clean.slice(after + 1, close);
          argsEnd = close + 1;
        }
      }

      const methods = annName.includes("RequestMapping") ? methodsFromArgs(args) : [VERB[m[1] as string] as Endpoint["method"]];
      if (methods.length === 0) continue;

      const member = parseMember(clean, argsEnd);
      if (!member) continue;

      const window = clean.slice(Math.max(region.bodyStart, m.index - 250), member.end);
      const status = responseStatus(window);
      const ctx = newJavaCtx(index, diags);
      const sub = mappingPath(args);
      const route = joinRoute(basePath, sub);

      const { params, body } = parseParams(member.params, route, ctx);
      const respSchema = buildSchema(member.returnType, ctx);
      const auth = authFrom(window) ?? classAuth ?? { required: false, schemes: [{ type: "none" }] };

      for (const method of methods) {
        const ep: Endpoint = {
          id: `${region.name}.${member.name}`,
          method,
          routeTemplate: route,
          params: params.map((p) => ({ ...p })),
          responses: [respSchema ? { status: status ?? defaultStatus(method), contentType: "application/json", schema: respSchema } : { status: status ?? defaultStatus(method) }],
          auth,
        };
        if (body) ep.requestBody = { ...body };
        endpoints.push(ep);
      }
    }
  }
  return endpoints;
}

function parseParams(paramStr: string, route: string, ctx: JavaCtx): { params: Param[]; body?: Endpoint["requestBody"] } {
  const params: Param[] = [];
  let body: Endpoint["requestBody"] | undefined;
  const tokens = new Set(routeTokens(route));
  const seenRoute = new Set<string>();

  for (const raw of splitArgs(paramStr)) {
    const p = raw.trim();
    if (!p) continue;
    const anns = [...p.matchAll(/@(\w+)\s*(\(([^)]*)\))?/g)].map((x) => ({ name: x[1] as string, args: x[3] ?? "" }));
    const bare = p.replace(/@\w+\s*(\([^)]*\))?/g, " ").replace(/\bfinal\b/g, " ").trim();
    const tm = /^(.*[\w>\]])\s+([A-Za-z_]\w*)$/.exec(bare);
    if (!tm) continue;
    const type = (tm[1] as string).trim();
    const varName = tm[2] as string;
    if (SKIP_PARAM_TYPES.has(type.split("<")[0]!.split(".").pop() as string)) continue;
    if (anns.some((a) => a.name === "AuthenticationPrincipal")) continue;

    const ann = anns.find((a) => ["PathVariable", "RequestParam", "RequestHeader", "RequestBody"].includes(a.name));
    if (ann?.name === "RequestBody") {
      body = { required: !/required\s*=\s*false/.test(ann.args), contentType: "application/json", schema: mapJavaType(type, ctx) };
    } else if (ann?.name === "PathVariable") {
      const name = nameArg(ann.args) ?? varName;
      params.push({ name, in: "route", required: true, schema: mapJavaType(type, ctx) });
      seenRoute.add(name);
    } else if (ann?.name === "RequestHeader") {
      params.push({ name: nameArg(ann.args) ?? varName, in: "header", required: !optional(ann.args), schema: mapJavaType(type, ctx) });
    } else if (ann?.name === "RequestParam") {
      params.push({ name: nameArg(ann.args) ?? varName, in: "query", required: !optional(ann.args), schema: mapJavaType(type, ctx) });
    } else if (tokens.has(varName)) {
      params.push({ name: varName, in: "route", required: true, schema: mapJavaType(type, ctx) });
      seenRoute.add(varName);
    } else {
      params.push({ name: varName, in: "query", required: false, schema: mapJavaType(type, ctx) });
    }
  }

  for (const tok of tokens) {
    if (!seenRoute.has(tok)) params.push({ name: tok, in: "route", required: true, schema: { type: "string" } });
  }
  return body ? { params, body } : { params };
}

function buildSchema(returnType: string, ctx: JavaCtx) {
  const unwrapped = unwrapResponse(returnType);
  if (/^void$|^Void$/.test(unwrapped.trim())) return undefined;
  const schema = mapJavaType(unwrapped, ctx);
  return Object.keys(schema).length === 0 || schema.type === "null" ? undefined : schema;
}

// --- signature parsing -------------------------------------------------------
interface Member {
  returnType: string;
  name: string;
  params: string;
  end: number;
}

function parseMember(clean: string, from: number): Member | null {
  let i = skipWs(clean, from);
  const MODS = /^(public|private|protected|static|final|abstract|synchronized|native|default|transient)\b/;
  for (let guard = 0; guard < 100; guard++) {
    if (clean[i] === "@") {
      i += 1;
      while (i < clean.length && /[\w.]/.test(clean[i] as string)) i++;
      i = skipWs(clean, i);
      if (clean[i] === "(") {
        const c = matchBracket(clean, i);
        if (c === -1) return null;
        i = skipWs(clean, c + 1);
      }
      continue;
    }
    if (clean[i] === "<") {
      const c = matchAngle(clean, i);
      if (c === -1) return null;
      i = skipWs(clean, c + 1);
      continue;
    }
    const rest = clean.slice(i, i + 14);
    const mm = MODS.exec(rest);
    if (mm) {
      i = skipWs(clean, i + (mm[0] as string).length);
      continue;
    }
    break;
  }
  const rt = readType(clean, i);
  if (!rt) return null;
  let j = skipWs(clean, rt.end);
  const nm = /^[A-Za-z_]\w*/.exec(clean.slice(j));
  if (!nm) return null;
  const name = nm[0];
  j = skipWs(clean, j + name.length);
  if (clean[j] !== "(") return null;
  const close = matchBracket(clean, j);
  if (close === -1) return null;
  return { returnType: rt.text, name, params: clean.slice(j + 1, close), end: close + 1 };
}

function readType(clean: string, i: number): { text: string; end: number } | null {
  const start = i;
  const idn = /^[A-Za-z_][\w.]*/.exec(clean.slice(i));
  if (!idn) return null;
  i += (idn[0] as string).length;
  if (clean[i] === "<") {
    const c = matchAngle(clean, i);
    if (c === -1) return null;
    i = c + 1;
  }
  while (clean.slice(i, i + 2) === "[]") i += 2;
  return { text: clean.slice(start, i).trim(), end: i };
}

function matchAngle(clean: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === "<") depth++;
    else if (ch === ">") {
      depth--;
      if (depth === 0) return i;
    } else if (ch === ";" || ch === "{") return -1;
  }
  return -1;
}

function skipWs(s: string, i: number): number {
  while (i < s.length && /\s/.test(s[i] as string)) i++;
  return i;
}

// --- annotation-argument helpers --------------------------------------------
function requestMappingArgs(annText: string): string {
  const idx = annText.lastIndexOf("@RequestMapping");
  if (idx === -1) return "";
  const open = annText.indexOf("(", idx);
  if (open === -1) return "";
  const close = matchBracket(annText, open);
  return close === -1 ? "" : annText.slice(open + 1, close);
}

function mappingPath(args: string): string {
  return strKwarg(args, "value|path") ?? firstStringLiteral(args) ?? "";
}

/** Extract a `key = "..."` (or `key = {"..."}`) string value; linear regex. */
function strKwarg(args: string, key: string): string | undefined {
  const m = new RegExp(`(?:${key})\\s*=\\s*\\{?\\s*("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')`).exec(args);
  return m ? (m[1] as string).slice(1, -1) : undefined;
}

function methodsFromArgs(args: string): Endpoint["method"][] {
  const found = [...args.matchAll(/RequestMethod\.(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)/g)].map((x) => x[1] as Endpoint["method"]);
  return found.length ? found : ["GET"];
}

function responseStatus(window: string): number | undefined {
  const m = /@ResponseStatus\s*\(([^)]*)\)/.exec(window);
  if (!m) return undefined;
  const named = /HttpStatus\.(\w+)/.exec(m[1] as string);
  if (named && STATUS[named[1] as string]) return STATUS[named[1] as string];
  const num = /\b(\d{3})\b/.exec(m[1] as string);
  return num ? Number(num[1]) : undefined;
}

function authFrom(text: string): Auth | null {
  if (/@(PreAuthorize|Secured|RolesAllowed|PostAuthorize)\b/.test(text)) {
    return { required: true, schemes: [{ type: "bearer", location: "header", name: "Authorization" }] };
  }
  return null;
}

function nameArg(args: string): string | undefined {
  return strKwarg(args, "name|value") ?? firstStringLiteral(args);
}

function optional(args: string): boolean {
  return /required\s*=\s*false/.test(args) || /defaultValue\s*=/.test(args);
}

function defaultStatus(method: Endpoint["method"]): number {
  return method === "POST" ? 201 : 200;
}

// --- route helpers -----------------------------------------------------------
function normalizeRoute(route: string): string {
  let r = (route || "").trim();
  r = r.replace(/\{([A-Za-z0-9_]+)\s*:[^}]*\}/g, "{$1}"); // {id:\\d+} → {id}
  r = r.replace(/\/{2,}/g, "/");
  if (!r.startsWith("/")) r = "/" + r;
  if (r.length > 1 && r.endsWith("/")) r = r.slice(0, -1);
  return r || "/";
}

function joinRoute(base: string, sub: string): string {
  const b = base ? normalizeRoute(base) : "";
  const s = sub ? normalizeRoute(sub) : "";
  if (!b || b === "/") return s || "/";
  if (!s || s === "/") return b;
  return normalizeRoute(b + s);
}

function routeTokens(route: string): string[] {
  const out: string[] = [];
  const re = /\{([A-Za-z0-9_]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(route))) out.push(m[1] as string);
  return out;
}
