/**
 * Decorator helpers (TS 5.x API: ts.getDecorators, not the removed node.decorators).
 */
import type * as TS from "typescript";

export interface DecoratorInfo {
  name: string;
  args: TS.Expression[];
  node: TS.Decorator;
}

export function getDecorators(ts: typeof TS, node: TS.Node): DecoratorInfo[] {
  if (!ts.canHaveDecorators(node)) return [];
  const decs = ts.getDecorators(node) ?? [];
  const out: DecoratorInfo[] = [];
  for (const d of decs) {
    const expr = d.expression;
    if (ts.isCallExpression(expr)) {
      out.push({ name: idName(ts, expr.expression), args: [...expr.arguments], node: d });
    } else {
      out.push({ name: idName(ts, expr), args: [], node: d });
    }
  }
  return out;
}

export function findDecorator(ts: typeof TS, node: TS.Node, name: string): DecoratorInfo | undefined {
  return getDecorators(ts, node).find((d) => d.name === name);
}

/** The trailing identifier of a (possibly qualified) expression, e.g. `a.b.Get` → "Get". */
function idName(ts: typeof TS, expr: TS.Expression): string {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return expr.getText(expr.getSourceFile());
}

/** First string-literal argument of a decorator, if any (`@Get('x')` → "x"). */
export function firstStringArg(ts: typeof TS, dec: DecoratorInfo): string | undefined {
  const a = dec.args[0];
  if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) return a.text;
  // `@Controller({ path: 'x' })`
  if (a && ts.isObjectLiteralExpression(a)) {
    for (const p of a.properties) {
      if (ts.isPropertyAssignment(p) && p.name.getText(p.getSourceFile()) === "path") {
        const v = p.initializer;
        if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) return v.text;
      }
    }
  }
  return undefined;
}

/** First numeric-literal argument (e.g. `@HttpCode(204)` → 204). */
export function firstNumberArg(ts: typeof TS, dec: DecoratorInfo): number | undefined {
  const a = dec.args[0];
  if (a && ts.isNumericLiteral(a)) return Number(a.text);
  return undefined;
}
