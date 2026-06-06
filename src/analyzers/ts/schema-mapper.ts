/**
 * Maps a TypeScript type node to the IR's JsonSchemaNode, resolving named types
 * across files via the SourceIndex. Mirrors the .NET SchemaMapper: bounded
 * recursion, cycle guard, generics (Array/Promise/Record/Partial), enums.
 */
import type * as TS from "typescript";
import type { JsonSchemaNode, Diagnostic } from "../../ir/schema.js";
import type { SourceIndex } from "./source-index.js";

const MAX_DEPTH = 64;

export interface MapContext {
  index: SourceIndex;
  diags: Diagnostic[];
  visiting: Set<string>;
  unresolved: Set<string>;
  depth: number;
}

export function newContext(index: SourceIndex, diags: Diagnostic[]): MapContext {
  return { index, diags, visiting: new Set(), unresolved: new Set(), depth: 0 };
}

export function mapType(node: TS.TypeNode | undefined, ctx: MapContext): JsonSchemaNode {
  const ts = ctx.index.ts;
  if (!node || ctx.depth > MAX_DEPTH) return {};
  const next = { ...ctx, depth: ctx.depth + 1 };

  if (ts.isParenthesizedTypeNode(node)) return mapType(node.type, next);
  if (ts.isArrayTypeNode(node)) return { type: "array", items: mapType(node.elementType, next) };
  if (ts.isLiteralTypeNode(node)) return mapLiteral(ts, node);
  if (ts.isUnionTypeNode(node)) return mapUnion(node, next);
  if (ts.isTypeLiteralNode(node)) return mapMembers(node.members, next);
  if (ts.isTypeReferenceNode(node)) return mapReference(node, next);

  switch (node.kind) {
    case ts.SyntaxKind.StringKeyword:
      return { type: "string" };
    case ts.SyntaxKind.NumberKeyword:
      return { type: "number" };
    case ts.SyntaxKind.BigIntKeyword:
      return { type: "integer" };
    case ts.SyntaxKind.BooleanKeyword:
      return { type: "boolean" };
    case ts.SyntaxKind.NullKeyword:
      return { type: "null" };
    case ts.SyntaxKind.ObjectKeyword:
      return { type: "object" };
    default:
      return {}; // any/unknown/void/never/etc.
  }
}

function mapLiteral(ts: typeof TS, node: TS.LiteralTypeNode): JsonSchemaNode {
  const lit = node.literal;
  if (ts.isStringLiteral(lit)) return { type: "string", enum: [lit.text] };
  if (ts.isNumericLiteral(lit)) return { type: "number", enum: [Number(lit.text)] };
  if (lit.kind === ts.SyntaxKind.TrueKeyword) return { type: "boolean", enum: [true] };
  if (lit.kind === ts.SyntaxKind.FalseKeyword) return { type: "boolean", enum: [false] };
  if (lit.kind === ts.SyntaxKind.NullKeyword) return { type: "null" };
  return {};
}

function mapUnion(node: TS.UnionTypeNode, ctx: MapContext): JsonSchemaNode {
  const ts = ctx.index.ts;
  let nullable = false;
  const members: TS.TypeNode[] = [];
  for (const t of node.types) {
    if (t.kind === ts.SyntaxKind.UndefinedKeyword || t.kind === ts.SyntaxKind.NullKeyword) {
      nullable = true;
      continue;
    }
    if (ts.isLiteralTypeNode(t) && t.literal.kind === ts.SyntaxKind.NullKeyword) {
      nullable = true;
      continue;
    }
    members.push(t);
  }
  const mapped = members.map((m) => mapType(m, ctx));

  // All string literals → a single string enum.
  if (mapped.length > 0 && mapped.every((m) => m.type === "string" && Array.isArray(m.enum))) {
    const values = mapped.flatMap((m) => m.enum as unknown[]);
    return withNullable({ type: "string", enum: values }, nullable);
  }
  if (mapped.length === 1) return withNullable(mapped[0] as JsonSchemaNode, nullable);
  if (mapped.length === 0) return withNullable({}, nullable);
  return withNullable({ oneOf: mapped }, nullable);
}

function withNullable(schema: JsonSchemaNode, nullable: boolean): JsonSchemaNode {
  return nullable ? { ...schema, nullable: true } : schema;
}

function mapReference(node: TS.TypeReferenceNode, ctx: MapContext): JsonSchemaNode {
  const ts = ctx.index.ts;
  const name = entityName(ts, node.typeName);
  const args = node.typeArguments ?? [];

  switch (name) {
    case "Array":
    case "ReadonlyArray":
      return { type: "array", items: args[0] ? mapType(args[0], ctx) : {} };
    case "Promise":
    case "Observable":
    case "Partial":
    case "Required":
    case "Readonly":
    case "NonNullable":
      return args[0] ? mapType(args[0], ctx) : {};
    case "Record":
    case "Map":
      return { type: "object", additionalProperties: args[1] ? mapType(args[1], ctx) : {} };
    case "Date":
      return { type: "string", format: "date-time" };
  }

  if (ctx.visiting.has(name)) return { type: "object" }; // cycle
  const decl = ctx.index.find(name);
  if (!decl) {
    if (!ctx.unresolved.has(name)) {
      ctx.unresolved.add(name);
      ctx.diags.push({ code: "unresolvedType", message: `unresolved type '${name}'`, severity: "info" });
    }
    return {};
  }

  const visiting = new Set(ctx.visiting).add(name);
  const sub = { ...ctx, visiting };
  if (ts.isEnumDeclaration(decl)) return mapEnum(ts, decl);
  if (ts.isTypeAliasDeclaration(decl)) return mapType(decl.type, sub);
  if (ts.isInterfaceDeclaration(decl) || ts.isClassDeclaration(decl)) {
    return mapDeclaration(decl, sub);
  }
  return {};
}

function mapDeclaration(decl: TS.InterfaceDeclaration | TS.ClassDeclaration, ctx: MapContext): JsonSchemaNode {
  const ts = ctx.index.ts;
  const schema = mapMembers(decl.members, ctx);
  // Merge inherited members (extends ...).
  for (const clause of decl.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    for (const t of clause.types) {
      const baseName = entityName(ts, t.expression as TS.EntityName | TS.Expression);
      if (!baseName || ctx.visiting.has(baseName)) continue;
      const base = ctx.index.find(baseName);
      if (base && (ts.isInterfaceDeclaration(base) || ts.isClassDeclaration(base))) {
        const baseSchema = mapDeclaration(base, { ...ctx, visiting: new Set(ctx.visiting).add(baseName) });
        schema.properties = { ...(baseSchema.properties ?? {}), ...(schema.properties ?? {}) };
        const req = new Set([...(baseSchema.required ?? []), ...(schema.required ?? [])]);
        if (req.size) schema.required = [...req];
      }
    }
  }
  return schema;
}

function mapMembers(members: readonly TS.TypeElement[] | readonly TS.ClassElement[], ctx: MapContext): JsonSchemaNode {
  const ts = ctx.index.ts;
  const properties: Record<string, JsonSchemaNode> = {};
  const required: string[] = [];
  for (const m of members) {
    const isProp = ts.isPropertySignature(m) || ts.isPropertyDeclaration(m);
    if (!isProp || !m.name) continue;
    if (isPrivateOrStatic(ts, m)) continue;
    const propName = memberName(ts, m.name);
    if (!propName) continue;
    const typeNode = (m as TS.PropertySignature | TS.PropertyDeclaration).type;
    properties[propName] = mapType(typeNode, ctx);
    const optional = Boolean((m as TS.PropertySignature | TS.PropertyDeclaration).questionToken);
    if (!optional) required.push(propName);
  }
  const out: JsonSchemaNode = { type: "object", properties };
  if (required.length) out.required = required;
  return out;
}

function mapEnum(ts: typeof TS, decl: TS.EnumDeclaration): JsonSchemaNode {
  const names: string[] = [];
  const numbers: number[] = [];
  let allNumeric = decl.members.length > 0;
  for (const m of decl.members) {
    names.push(m.name.getText(m.getSourceFile()).replace(/['"]/g, ""));
    if (m.initializer && ts.isNumericLiteral(m.initializer)) numbers.push(Number(m.initializer.text));
    else if (m.initializer && ts.isStringLiteral(m.initializer)) {
      allNumeric = false;
      names[names.length - 1] = m.initializer.text;
    } else allNumeric = false;
  }
  if (allNumeric && numbers.length === decl.members.length) return { type: "integer", enum: numbers };
  return { type: "string", enum: names };
}

function isPrivateOrStatic(ts: typeof TS, m: TS.ClassElement | TS.TypeElement): boolean {
  const mods = ts.canHaveModifiers(m) ? ts.getModifiers(m) : undefined;
  return Boolean(mods?.some((x) => x.kind === ts.SyntaxKind.PrivateKeyword || x.kind === ts.SyntaxKind.StaticKeyword));
}

function memberName(ts: typeof TS, name: TS.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

function entityName(ts: typeof TS, name: TS.EntityName | TS.Expression): string {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isQualifiedName(name)) return name.right.text;
  if (ts.isPropertyAccessExpression(name)) return name.name.text;
  return name.getText(name.getSourceFile());
}
