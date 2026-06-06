/**
 * Turns Python source into "logical lines": physical lines joined across open
 * brackets/backslash continuations, with comments stripped and string contents
 * skipped (so brackets/`#` inside strings and multi-line docstrings never confuse
 * the readers). Each logical line records its indentation. This is the shared
 * foundation for the pattern-based FastAPI/Flask/model readers — no parser dep.
 */
export interface LogicalLine {
  indent: number;
  code: string;
}

export function buildLogicalLines(text: string): LogicalLine[] {
  const out: LogicalLine[] = [];
  let i = 0;
  const n = text.length;

  let depth = 0;
  let code = ""; // accumulated code for the current logical line (comments/strings handled)
  let started = false;
  let indent = 0;
  let pendingContinuation = false;

  const pushLine = () => {
    if (started) {
      const trimmed = code.replace(/\s+$/g, "");
      out.push({ indent, code: trimmed.trimStart() });
    }
    code = "";
    started = false;
    indent = 0;
  };

  while (i < n) {
    const ch = text[i] as string;

    // Comment (outside strings): skip to end of line.
    if (ch === "#") {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }

    // String literal: copy the whole literal verbatim (so paths/enum values are
    // preserved) but consume it in one step so its contents never affect bracket
    // depth or comment detection.
    if (ch === '"' || ch === "'") {
      if (!started) startLine();
      const triple = text.slice(i, i + 3);
      const isTriple = triple === '"""' || triple === "'''";
      const end = skipString(text, i + (isTriple ? 3 : 1), isTriple ? triple : ch);
      code += text.slice(i, end);
      i = end;
      continue;
    }

    if (ch === "\n") {
      if (depth > 0 || pendingContinuation) {
        // continuation — join with a space, keep accumulating
        code += " ";
        pendingContinuation = false;
        i++;
        continue;
      }
      pushLine();
      i++;
      continue;
    }

    if (ch === "\\" && text[i + 1] === "\n") {
      pendingContinuation = true;
      i += 2;
      code += " ";
      continue;
    }

    if (!started) {
      // measure indentation (leading whitespace of the first physical line)
      if (ch === " " || ch === "\t") {
        indent += ch === "\t" ? 4 : 1;
        i++;
        continue;
      }
      startLine();
    }

    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1);

    code += ch;
    i++;
  }
  pushLine();
  return out.filter((l) => l.code.length > 0);

  function startLine(): void {
    started = true;
  }
}

/** Skip from `i` (just past the opening quote) to just past the matching close. */
function skipString(text: string, i: number, close: string): number {
  const n = text.length;
  const single = close.length === 1;
  while (i < n) {
    const ch = text[i];
    if (single && ch === "\\") {
      i += 2; // escape
      continue;
    }
    if (text.slice(i, i + close.length) === close) return i + close.length;
    i++;
  }
  return n;
}
