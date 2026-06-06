/**
 * Pairs decorators with the function they decorate and parses the signature.
 * Operates on logical lines (lines.ts), so signatures spanning multiple physical
 * lines are already joined.
 */
import type { LogicalLine } from "./lines.js";

export interface PyParam {
  name: string;
  type?: string;
  default?: string;
}

export interface PyFunction {
  name: string;
  decorators: string[];
  params: PyParam[];
  returnType?: string;
  body: string;
}

const DEF_RE = /^(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)\s*(?:->\s*(.+?))?\s*:$/;

export function extractFunctions(lines: LogicalLine[]): PyFunction[] {
  const out: PyFunction[] = [];
  let pending: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as LogicalLine;
    if (line.code.startsWith("@")) {
      pending.push(line.code.slice(1).trim());
      continue;
    }
    const m = DEF_RE.exec(line.code);
    if (m) {
      const body: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const b = lines[j] as LogicalLine;
        if (b.indent <= line.indent) break;
        body.push(b.code);
      }
      out.push({
        name: m[1] as string,
        decorators: pending,
        params: parseParams(m[2] as string),
        returnType: m[3]?.trim(),
        body: body.join("\n"),
      });
      pending = [];
      continue;
    }
    // Any other non-blank logical line breaks the decorator chain.
    pending = [];
  }
  return out;
}

function parseParams(s: string): PyParam[] {
  return splitTopLevel(s, ",")
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith("*") && p !== "self" && p !== "cls" && p !== "/")
    .map(parseParam);
}

function parseParam(p: string): PyParam {
  const colon = topLevelIndexOf(p, ":");
  const eq = topLevelIndexOf(p, "=");
  if (colon !== -1) {
    const name = p.slice(0, colon).trim();
    const typeEnd = eq !== -1 && eq > colon ? eq : p.length;
    const type = p.slice(colon + 1, typeEnd).trim();
    const def = eq !== -1 && eq > colon ? p.slice(eq + 1).trim() : undefined;
    return def !== undefined ? { name, type, default: def } : { name, type };
  }
  if (eq !== -1) {
    return { name: p.slice(0, eq).trim(), default: p.slice(eq + 1).trim() };
  }
  return { name: p.trim() };
}

function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "[" || ch === "(" || ch === "{") depth++;
    else if (ch === "]" || ch === ")" || ch === "}") depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function topLevelIndexOf(s: string, sep: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "[" || ch === "(" || ch === "{") depth++;
    else if (ch === "]" || ch === ")" || ch === "}") depth--;
    else if (ch === sep && depth === 0) return i;
  }
  return -1;
}
