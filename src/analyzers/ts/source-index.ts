/**
 * Parses project TypeScript files (syntactically — no type-checker/Program) and
 * indexes declarations by name for cross-file DTO resolution. Mirrors the .NET
 * analyzer's SourceIndex.
 */
import type * as TS from "typescript";
import { loadTs, collectSourceFiles, type SourceFile } from "./util.js";

export type TypeDecl =
  | TS.InterfaceDeclaration
  | TS.ClassDeclaration
  | TS.TypeAliasDeclaration
  | TS.EnumDeclaration;

export class SourceIndex {
  readonly ts: typeof TS;
  readonly sources: { path: string; sf: TS.SourceFile }[] = [];
  private readonly byName = new Map<string, TypeDecl>();

  constructor(files: SourceFile[]) {
    this.ts = loadTs();
    const ts = this.ts;
    for (const f of files) {
      const sf = ts.createSourceFile(f.path, f.text, ts.ScriptTarget.Latest, /*setParentNodes*/ true, scriptKind(ts, f.path));
      this.sources.push({ path: f.path, sf });
      sf.forEachChild((node) => this.indexNode(node));
    }
  }

  private indexNode(node: TS.Node): void {
    const ts = this.ts;
    if (
      ts.isInterfaceDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node)
    ) {
      if (node.name) {
        const name = node.name.getText(node.getSourceFile());
        if (!this.byName.has(name)) this.byName.set(name, node as TypeDecl);
      }
    }
  }

  /** Look up a declared type by simple name. */
  find(name: string): TypeDecl | undefined {
    return this.byName.get(name);
  }

  static fromPath(sourcePath: string): SourceIndex {
    return new SourceIndex(collectSourceFiles(sourcePath));
  }
}

function scriptKind(ts: typeof TS, path: string): TS.ScriptKind {
  return /\.tsx$/i.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}
