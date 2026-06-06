/**
 * NestJS extractor: @Controller classes + @Get/@Post/... methods, with
 * @Param/@Query/@Headers/@Body params, @HttpCode + return-type responses, and
 * @UseGuards/@ApiBearerAuth auth. High fidelity (decorators carry the contract).
 */
import type * as TS from "typescript";
import type { Endpoint, Param, ApiResponse, Auth, Diagnostic, JsonSchemaNode } from "../../ir/schema.js";
import type { SourceIndex } from "./source-index.js";
import { getDecorators, findDecorator, firstStringArg, firstNumberArg } from "./decorators.js";
import { mapType, newContext, type MapContext } from "./schema-mapper.js";
import { joinRoute, routeTokens } from "./util.js";

const HTTP_DECORATORS: Record<string, Endpoint["method"]> = {
  Get: "GET", Post: "POST", Put: "PUT", Patch: "PATCH", Delete: "DELETE", Options: "OPTIONS", Head: "HEAD",
};

export function extractNestJs(index: SourceIndex, diags: Diagnostic[]): Endpoint[] {
  const ts = index.ts;
  const endpoints: Endpoint[] = [];
  for (const { sf } of index.sources) {
    visit(sf);
  }
  return endpoints;

  function visit(node: TS.Node): void {
    if (ts.isClassDeclaration(node)) {
      const controller = findDecorator(ts, node, "Controller");
      if (controller && node.name) {
        extractController(node, controller ? firstStringArg(ts, controller) ?? "" : "");
      }
    }
    node.forEachChild(visit);
  }

  function extractController(cls: TS.ClassDeclaration, basePath: string): void {
    const controllerName = cls.name!.text;
    const classAuth = detectAuth(cls);
    const tag = controllerName.replace(/Controller$/, "") || controllerName;

    for (const member of cls.members) {
      if (!ts.isMethodDeclaration(member) || !member.name) continue;
      const decs = getDecorators(ts, member);
      const httpDec = decs.find((d) => d.name in HTTP_DECORATORS);
      if (!httpDec) continue;

      const method = HTTP_DECORATORS[httpDec.name] as Endpoint["method"];
      const sub = firstStringArg(ts, httpDec) ?? "";
      const route = joinRoute(basePath, sub);
      const methodName = member.name.getText(member.getSourceFile());
      const ctx = newContext(index, diags);

      const { params, requestBody } = extractParams(member, route, ctx);
      const responses = extractResponses(member, method, ctx);
      const methodAuth = detectAuth(member);
      const auth = mergeAuth(classAuth, methodAuth);

      const ep: Endpoint = {
        id: `${controllerName}.${methodName}`,
        method,
        routeTemplate: route,
        params,
        responses,
        auth,
        tags: [tag],
      };
      if (requestBody) ep.requestBody = requestBody;
      endpoints.push(ep);
    }
  }

  function extractParams(
    member: TS.MethodDeclaration,
    route: string,
    ctx: MapContext,
  ): { params: Param[]; requestBody?: Endpoint["requestBody"] } {
    const params: Param[] = [];
    let requestBody: Endpoint["requestBody"] | undefined;
    const seenRoute = new Set<string>();

    for (const p of member.parameters) {
      const pType = p.type;
      const optional = Boolean(p.questionToken);
      const paramName = ts.isIdentifier(p.name) ? p.name.text : undefined;

      const paramDec = getDecorators(ts, p).find((d) => ["Param", "Query", "Headers", "Body"].includes(d.name));
      if (!paramDec) continue;
      const argName = firstStringArg(ts, paramDec);

      if (paramDec.name === "Body") {
        requestBody = { required: !optional, contentType: "application/json", schema: mapType(pType, ctx) };
      } else if (paramDec.name === "Param") {
        const name = argName ?? paramName;
        if (name) {
          params.push({ name, in: "route", required: true, schema: pType ? mapType(pType, ctx) : { type: "string" } });
          seenRoute.add(name);
        }
      } else if (paramDec.name === "Query") {
        if (argName) {
          params.push({ name: argName, in: "query", required: !optional, schema: pType ? mapType(pType, ctx) : { type: "string" } });
        } else if (pType) {
          // @Query() dto: T — expand the object's properties into query params.
          expandObjectToQuery(mapType(pType, ctx), params);
        }
      } else if (paramDec.name === "Headers") {
        if (argName) params.push({ name: argName, in: "header", required: !optional, schema: { type: "string" } });
      }
    }

    // Ensure every route token has a param (decorator may be omitted).
    for (const tok of routeTokens(route)) {
      if (!seenRoute.has(tok)) {
        params.push({ name: tok, in: "route", required: true, schema: { type: "string" } });
      }
    }
    return requestBody ? { params, requestBody } : { params };
  }

  function expandObjectToQuery(schema: JsonSchemaNode, params: Param[]): void {
    const props = schema.properties;
    if (!props) return;
    const required = new Set(schema.required ?? []);
    for (const [name, ps] of Object.entries(props)) {
      params.push({ name, in: "query", required: required.has(name), schema: ps });
    }
  }

  function extractResponses(member: TS.MethodDeclaration, method: Endpoint["method"], ctx: MapContext): ApiResponse[] {
    const httpCode = findDecorator(ts, member, "HttpCode");
    const status = httpCode ? firstNumberArg(ts, httpCode) ?? defaultStatus(method) : defaultStatus(method);
    const ret = member.type ? mapType(member.type, ctx) : undefined;
    const hasBody = ret && Object.keys(ret).length > 0 && ret.type !== "null";
    const res: ApiResponse = { status };
    if (hasBody) {
      res.contentType = "application/json";
      res.schema = ret;
    }
    return [res];
  }

  function detectAuth(node: TS.ClassDeclaration | TS.MethodDeclaration): { required: boolean; scheme?: Auth["schemes"][number]; assumed: boolean } {
    const decs = getDecorators(ts, node);
    const bearer = decs.find((d) => d.name === "ApiBearerAuth" || d.name === "ApiOAuth2");
    if (bearer) return { required: true, scheme: { type: bearer.name === "ApiOAuth2" ? "oauth2" : "bearer", location: "header", name: "Authorization" }, assumed: false };
    const guard = decs.find((d) => d.name === "UseGuards");
    if (guard) {
      const txt = guard.args.map((a) => a.getText(a.getSourceFile())).join(" ");
      if (/api[-_]?key/i.test(txt)) return { required: true, scheme: { type: "apiKey", location: "header", name: "X-API-Key" }, assumed: false };
      if (/basic/i.test(txt)) return { required: true, scheme: { type: "basic" }, assumed: false };
      const known = /jwt|bearer|auth/i.test(txt);
      if (!known) {
        diags.push({ code: "assumedConvention", message: `@UseGuards(${txt}) — assumed Bearer auth`, severity: "info" });
      }
      return { required: true, scheme: { type: "bearer", location: "header", name: "Authorization" }, assumed: !known };
    }
    return { required: false, assumed: false };
  }

  function mergeAuth(a: ReturnType<typeof detectAuth>, b: ReturnType<typeof detectAuth>): Auth {
    const chosen = b.required ? b : a;
    if (!chosen.required || !chosen.scheme) return { required: false, schemes: [{ type: "none" }] };
    return { required: true, schemes: [chosen.scheme] };
  }
}

function defaultStatus(method: Endpoint["method"]): number {
  return method === "POST" ? 201 : 200;
}
