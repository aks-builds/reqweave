/**
 * Scans Java source (comment-stripped) for type declarations: their brace ranges
 * (for controller detection) and their fields (for DTO schema resolution).
 */
import { matchBracket, skipString, splitArgs } from "../clike/lex.js";

export interface JavaField {
  name: string;
  type: string;
  required: boolean;
}

export interface JavaClass {
  name: string;
  kind: "class" | "interface" | "record" | "enum";
  fields: JavaField[];
  enumValues: string[];
}

export interface JavaRegion {
  name: string;
  kind: JavaClass["kind"];
  /** Annotation text immediately preceding the declaration. */
  annotations: string;
  bodyStart: number;
  bodyEnd: number;
}

const DECL_RE = /\b(class|interface|record|enum)\s+([A-Za-z_]\w*)/g;
const REQUIRED_ANN = /@(NotNull|NotBlank|NotEmpty|NonNull)\b/;
const PRIMITIVE = new Set(["byte", "short", "int", "long", "float", "double", "boolean", "char"]);

/** All top-level/nested declarations with their brace ranges and leading annotations. */
export function findRegions(clean: string): JavaRegion[] {
  const regions: JavaRegion[] = [];
  DECL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DECL_RE.exec(clean))) {
    const kind = m[1] as JavaClass["kind"];
    const name = m[2] as string;
    const bodyStart = nextBrace(clean, m.index + m[0].length);
    if (bodyStart === -1) continue;
    const bodyEnd = matchBracket(clean, bodyStart);
    if (bodyEnd === -1) continue;
    const annStart = Math.max(0, m.index - 600);
    regions.push({ name, kind, annotations: clean.slice(annStart, m.index), bodyStart, bodyEnd });
  }
  return regions;
}

/** Build a DTO/enum index by name from all files' cleaned text. */
export function buildJavaIndex(cleans: string[]): Map<string, JavaClass> {
  const index = new Map<string, JavaClass>();
  for (const clean of cleans) {
    for (const r of findRegions(clean)) {
      if (index.has(r.name)) continue;
      const body = clean.slice(r.bodyStart + 1, r.bodyEnd);
      if (r.kind === "enum") {
        index.set(r.name, { name: r.name, kind: "enum", fields: [], enumValues: enumValues(body) });
        continue;
      }
      const fields = r.kind === "record" ? recordComponents(clean, r) : classFields(body);
      index.set(r.name, { name: r.name, kind: r.kind, fields, enumValues: [] });
    }
  }
  return index;
}

function enumValues(body: string): string[] {
  // Enum constants are the leading comma-separated identifiers before ';' or '}'.
  const head = body.split(";")[0] as string;
  const top = stripNestedBlocks(head);
  return splitArgs(top)
    .map((c) => /^[A-Za-z_]\w*/.exec(c.trim())?.[0])
    .filter((x): x is string => Boolean(x));
}

function recordComponents(clean: string, r: JavaRegion): JavaField[] {
  // record Name(<generics>?) (components) { ... } — find the parens before bodyStart.
  const header = clean.slice(0, r.bodyStart);
  const open = header.lastIndexOf("(");
  if (open === -1) return [];
  const close = matchBracket(clean, open);
  if (close === -1 || close > r.bodyStart) return [];
  return splitArgs(clean.slice(open + 1, close))
    .map((c) => parseFieldDecl(c, true))
    .filter((f): f is JavaField => Boolean(f));
}

function classFields(body: string): JavaField[] {
  const top = stripNestedBlocks(body);
  const out: JavaField[] = [];
  for (const seg of top.split(";")) {
    const s = seg.trim();
    if (!s || /\)/.test(s)) continue; // skip method signatures / anything with parens
    const f = parseFieldDecl(s, false);
    if (f) out.push(f);
  }
  return out;
}

function parseFieldDecl(decl: string, recordComponent: boolean): JavaField | null {
  let s = decl.trim();
  const required = recordComponent ? !/Optional\s*</.test(s) : REQUIRED_ANN.test(s) || isPrimitive(s);
  s = s.replace(/@\w+\s*(\([^)]*\))?/g, " "); // strip annotations
  s = s.replace(/\b(private|public|protected|static|final|transient|volatile)\b/g, " ");
  s = s.split("=")[0]!.trim();
  const m = /^(.*[\w>\]])\s+([A-Za-z_]\w*)$/.exec(s);
  if (!m) return null;
  return { name: m[2] as string, type: (m[1] as string).trim(), required };
}

function isPrimitive(decl: string): boolean {
  const m = /([A-Za-z_]\w*)\s+[A-Za-z_]\w*\s*$/.exec(decl.replace(/=.*/, "").trim());
  return m ? PRIMITIVE.has(m[1] as string) : false;
}

function nextBrace(clean: string, from: number): number {
  let i = from;
  const n = clean.length;
  while (i < n) {
    const ch = clean[i] as string;
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(clean, i + 1, ch);
      continue;
    }
    if (ch === "{") return i;
    if (ch === ";") return -1; // abstract method / no body
    i++;
  }
  return -1;
}

/** Remove nested {…} blocks (e.g. method bodies), keeping only top-level text. */
function stripNestedBlocks(s: string): string {
  let depth = 0;
  let out = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i] as string;
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = skipString(s, i + 1, ch);
      if (depth === 0) out += s.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
    i++;
  }
  return out;
}
