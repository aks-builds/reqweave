/**
 * Reconcile a static-analysis IR with a build-mode ground-truth IR (imported
 * from the project's generated OpenAPI). Build-mode wins on conflicts; every
 * divergence is surfaced as a diagnostic so nothing is silently overridden.
 */
import type { Ir, Endpoint, Diagnostic } from "./schema.js";

const key = (e: Endpoint): string => `${e.method} ${e.routeTemplate}`;
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function reconcile(staticIr: Ir, buildIr: Ir): Ir {
  const staticByKey = new Map(staticIr.endpoints.map((e) => [key(e), e]));
  const buildKeys = new Set(buildIr.endpoints.map(key));
  const recDiags: Diagnostic[] = [];
  const endpoints: Endpoint[] = [];

  // Build-mode wins: take every build endpoint.
  for (const be of buildIr.endpoints) {
    endpoints.push(be);
    const se = staticByKey.get(key(be));
    if (!se) {
      recDiags.push({
        code: "assumedConvention",
        message: `${key(be)}: in build-mode ground truth but not static analysis`,
        severity: "info",
        endpointId: be.id,
      });
    } else if (differs(se, be)) {
      recDiags.push({
        code: "assumedConvention",
        message: `${key(be)}: static and build-mode differ; used build-mode`,
        severity: "info",
        endpointId: be.id,
      });
    }
  }

  // Static-only endpoints: keep them (don't lose coverage) but flag.
  for (const se of staticIr.endpoints) {
    if (!buildKeys.has(key(se))) {
      endpoints.push(se);
      recDiags.push({
        code: "ambiguousRoute",
        message: `${key(se)}: found by static analysis but not in build-mode ground truth`,
        severity: "warning",
        endpointId: se.id,
      });
    }
  }

  endpoints.sort((a, b) => cmp(a.routeTemplate, b.routeTemplate) || cmp(a.method, b.method));

  const seen = new Set<string>();
  const unique = endpoints.map((e) => {
    let id = e.id;
    let n = 1;
    while (seen.has(id)) id = `${e.id}-${++n}`;
    seen.add(id);
    return id === e.id ? e : { ...e, id };
  });

  return {
    irVersion: buildIr.irVersion,
    service: buildIr.service,
    endpoints: unique,
    diagnostics: [...staticIr.diagnostics, ...buildIr.diagnostics, ...recDiags],
    meta: { ...buildIr.meta, mode: "build" },
  };
}

function differs(a: Endpoint, b: Endpoint): boolean {
  return (
    Boolean(a.requestBody) !== Boolean(b.requestBody) ||
    a.responses.length !== b.responses.length ||
    a.params.length !== b.params.length
  );
}
