/**
 * Tiny lexing helpers shared by the brace-delimited language readers (Java, Go).
 * No parser dependency: comment-stripping (strings preserved) plus string-aware
 * brace/paren matching and simple token readers.
 */

/** Replace // line and /* block comments with spaces (preserving offsets and
 * newlines); string and char literals are kept intact. */
export function stripComments(text: string): string {
  const out: string[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i] as string;
    const two = text.slice(i, i + 2);
    if (two === "//") {
      while (i < n && text[i] !== "\n") {
        out.push(" ");
        i++;
      }
      continue;
    }
    if (two === "/*") {
      while (i < n && text.slice(i, i + 2) !== "*/") {
        out.push(text[i] === "\n" ? "\n" : " ");
        i++;
      }
      if (i < n) {
        out.push("  ");
        i += 2;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = skipString(text, i + 1, ch);
      out.push(text.slice(i, end));
      i = end;
      continue;
    }
    out.push(ch);
    i++;
  }
  return out.join("");
}

/** Index just past the closing quote (handles backslash escapes for ' and "). */
export function skipString(text: string, i: number, quote: string): number {
  const n = text.length;
  const escapes = quote !== "`"; // Go raw strings (backtick) have no escapes
  while (i < n) {
    const ch = text[i];
    if (escapes && ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i++;
  }
  return n;
}

/** Given the index of an opening bracket, return the index of its match (or -1),
 * skipping string/char literals. Works for {} () []. */
export function matchBracket(text: string, openIndex: number): number {
  const open = text[openIndex] as string;
  const close = open === "{" ? "}" : open === "(" ? ")" : "]";
  let depth = 0;
  let i = openIndex;
  const n = text.length;
  while (i < n) {
    const ch = text[i] as string;
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(text, i + 1, ch);
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/** Split a top-level comma list (respecting () [] {} <> and strings). */
export function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let angle = 0;
  let cur = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i] as string;
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = skipString(s, i + 1, ch);
      cur += s.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "<") angle++;
    else if (ch === ">") angle = Math.max(0, angle - 1);
    if (ch === "," && depth === 0 && angle === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** First string-literal value in a parenthesized argument string. The alternatives
 * are mutually exclusive (no backslash/any overlap) so matching is linear. */
export function firstStringLiteral(args: string): string | undefined {
  const m = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`/.exec(args);
  return m ? m[0].slice(1, -1) : undefined;
}
