using System.Text.Json.Nodes;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using static Reqweave.Analyzer.SyntaxHelpers;

namespace Reqweave.Analyzer;

/// <summary>
/// Maps a C# type (as written in source) to a JSON-Schema-ish node, resolving
/// DTOs/enums from the <see cref="SourceIndex"/>. Pure syntax — unresolved types
/// degrade to an empty schema plus a diagnostic, never a crash.
/// </summary>
public sealed class SchemaMapper
{
    private const int MaxDepth = 64; // guard against pathological nesting

    private readonly SourceIndex _index;
    private readonly List<Diagnostic> _diagnostics;

    public SchemaMapper(SourceIndex index, List<Diagnostic> diagnostics)
    {
        _index = index;
        _diagnostics = diagnostics;
    }

    public JsonObject Map(TypeSyntax type) => Map(type, new HashSet<string>(StringComparer.Ordinal), 0);

    private JsonObject Map(TypeSyntax type, HashSet<string> visiting, int depth)
    {
        if (depth > MaxDepth)
        {
            return new JsonObject { ["type"] = "object" };
        }

        switch (type)
        {
            case NullableTypeSyntax nt:
                var inner = Map(nt.ElementType, visiting, depth + 1);
                inner["nullable"] = true;
                return inner;

            case PredefinedTypeSyntax p:
                return Primitive(p.Keyword.Text);

            case ArrayTypeSyntax a:
                return new JsonObject { ["type"] = "array", ["items"] = Map(a.ElementType, visiting, depth + 1) };

            case GenericNameSyntax g:
                return Generic(g, visiting, depth);

            case IdentifierNameSyntax id:
                return Named(id.Identifier.Text, visiting, depth);

            case QualifiedNameSyntax q:
                return Named(q.Right.Identifier.Text, visiting, depth);

            default:
                return Unknown(type.ToString());
        }
    }

    private static JsonObject Primitive(string keyword) => keyword switch
    {
        "string" or "char" => new JsonObject { ["type"] = "string" },
        "bool" => new JsonObject { ["type"] = "boolean" },
        "byte" or "sbyte" or "short" or "ushort" or "int" or "uint" or "long" or "ulong"
            => new JsonObject { ["type"] = "integer" },
        "float" or "double" or "decimal" => new JsonObject { ["type"] = "number" },
        "object" or "dynamic" => new JsonObject(),
        _ => new JsonObject { ["type"] = "string" },
    };

    private JsonObject Named(string name, HashSet<string> visiting, int depth)
    {
        switch (name)
        {
            case "Guid":
                return new JsonObject { ["type"] = "string", ["format"] = "uuid" };
            case "DateTime" or "DateTimeOffset":
                return new JsonObject { ["type"] = "string", ["format"] = "date-time" };
            case "DateOnly":
                return new JsonObject { ["type"] = "string", ["format"] = "date" };
            case "TimeOnly" or "TimeSpan":
                return new JsonObject { ["type"] = "string" };
            case "Uri":
                return new JsonObject { ["type"] = "string", ["format"] = "uri" };
            case "Decimal" or "Double" or "Single":
                return new JsonObject { ["type"] = "number" };
            case "Int16" or "Int32" or "Int64" or "Byte" or "UInt16" or "UInt32" or "UInt64":
                return new JsonObject { ["type"] = "integer" };
            case "Boolean":
                return new JsonObject { ["type"] = "boolean" };
            case "String":
                return new JsonObject { ["type"] = "string" };
            case "Object":
                return new JsonObject();
        }

        var en = _index.FindEnum(name);
        if (en is not null)
        {
            var values = new JsonArray();
            foreach (var member in en.Members)
            {
                values.Add(member.Identifier.Text);
            }

            return new JsonObject { ["type"] = "string", ["enum"] = values };
        }

        var decl = _index.FindType(name);
        if (decl is not null)
        {
            return MapType(decl, visiting, depth);
        }

        return Unknown(name);
    }

    private JsonObject Generic(GenericNameSyntax g, HashSet<string> visiting, int depth)
    {
        var name = g.Identifier.Text;
        var args = g.TypeArgumentList.Arguments;

        switch (name)
        {
            case "Nullable" when args.Count == 1:
                var n = Map(args[0], visiting, depth + 1);
                n["nullable"] = true;
                return n;

            case "Task" or "ValueTask" or "ActionResult" or "Results" when args.Count == 1:
                return Map(args[0], visiting, depth + 1); // unwrap

            case "List" or "IList" or "IEnumerable" or "ICollection" or "IReadOnlyList"
                or "IReadOnlyCollection" or "HashSet" or "ISet" or "Collection"
                when args.Count == 1:
                return new JsonObject { ["type"] = "array", ["items"] = Map(args[0], visiting, depth + 1) };

            case "Dictionary" or "IDictionary" or "IReadOnlyDictionary" when args.Count == 2:
                return new JsonObject
                {
                    ["type"] = "object",
                    ["additionalProperties"] = Map(args[1], visiting, depth + 1),
                };

            default:
                _diagnostics.Add(new Diagnostic(
                    "unsupportedFeature",
                    $"Unsupported generic type '{name}<...>'; emitted as an open object.",
                    "warning"));
                return new JsonObject { ["type"] = "object" };
        }
    }

    private JsonObject MapType(TypeDeclarationSyntax decl, HashSet<string> visiting, int depth)
    {
        var name = decl.Identifier.Text;
        if (!visiting.Add(name) || depth > MaxDepth)
        {
            return new JsonObject { ["type"] = "object" }; // cycle / too deep
        }

        var properties = new JsonObject();
        var required = new JsonArray();

        foreach (var prop in decl.Members.OfType<PropertyDeclarationSyntax>())
        {
            if (!IsPublic(prop))
            {
                continue;
            }

            var jsonName = JsonName(prop);
            var schema = Map(prop.Type, visiting, depth + 1);
            ApplyValidation(prop, schema, required, jsonName);
            properties[jsonName] = schema;
        }

        AddRecordParams(decl, properties, visiting, depth);
        MergeBaseProperties(decl, properties, required, visiting, depth);

        visiting.Remove(name);

        var obj = new JsonObject { ["type"] = "object", ["properties"] = properties };
        if (required.Count > 0)
        {
            obj["required"] = required;
        }

        return obj;
    }

    // Record primary-constructor parameters are serialized properties too.
    private void AddRecordParams(TypeDeclarationSyntax decl, JsonObject properties, HashSet<string> visiting, int depth)
    {
        if (decl is not RecordDeclarationSyntax rec || rec.ParameterList is null)
        {
            return;
        }

        foreach (var p in rec.ParameterList.Parameters)
        {
            if (p.Type is null)
            {
                continue;
            }

            var jsonName = CamelCase(p.Identifier.Text);
            if (!properties.ContainsKey(jsonName))
            {
                properties[jsonName] = Map(p.Type, visiting, depth + 1);
            }
        }
    }

    // Merge inherited properties from base classes (declared/derived members win).
    private void MergeBaseProperties(
        TypeDeclarationSyntax decl,
        JsonObject properties,
        JsonArray required,
        HashSet<string> visiting,
        int depth)
    {
        if (decl.BaseList is null)
        {
            return;
        }

        foreach (var baseType in decl.BaseList.Types)
        {
            var baseName = BaseName(baseType.Type);
            if (visiting.Contains(baseName) || _index.FindType(baseName) is not { } baseDecl)
            {
                continue;
            }

            var baseObj = MapType(baseDecl, visiting, depth + 1);
            if (baseObj["properties"] is JsonObject baseProps)
            {
                foreach (var kv in baseProps)
                {
                    if (!properties.ContainsKey(kv.Key))
                    {
                        properties[kv.Key] = kv.Value?.DeepClone();
                    }
                }
            }

            if (baseObj["required"] is JsonArray baseReq)
            {
                foreach (var r in baseReq)
                {
                    var rv = r?.GetValue<string>();
                    if (rv is not null && !required.Any((x) => x?.GetValue<string>() == rv))
                    {
                        required.Add(rv);
                    }
                }
            }
        }
    }

    private static string BaseName(TypeSyntax t) => t switch
    {
        IdentifierNameSyntax id => id.Identifier.Text,
        GenericNameSyntax g => g.Identifier.Text,
        QualifiedNameSyntax q => q.Right.Identifier.Text,
        _ => t.ToString(),
    };

    private static string JsonName(PropertyDeclarationSyntax prop)
    {
        var jsonAttr = FindAttr(prop.AttributeLists, "JsonPropertyName");
        if (jsonAttr is not null && StringArg(jsonAttr) is { } explicitName)
        {
            return explicitName;
        }

        return CamelCase(prop.Identifier.Text);
    }

    private static void ApplyValidation(
        PropertyDeclarationSyntax prop,
        JsonObject schema,
        JsonArray required,
        string jsonName)
    {
        var attrs = prop.AttributeLists;

        if (HasAttr(attrs, "Required"))
        {
            required.Add(jsonName);
        }

        if (FindAttr(attrs, "Range") is { } range)
        {
            if (NumberArg(range, 0) is { } min)
            {
                schema["minimum"] = min;
            }

            if (NumberArg(range, 1) is { } max)
            {
                schema["maximum"] = max;
            }
        }

        if (FindAttr(attrs, "StringLength") is { } strLen)
        {
            if (NumberArg(strLen, 0) is { } maxLen)
            {
                schema["maxLength"] = (int)maxLen;
            }

            if (NamedIntArg(strLen, "MinimumLength") is { } minLen)
            {
                schema["minLength"] = minLen;
            }
        }

        if (FindAttr(attrs, "MaxLength") is { } maxLenAttr && NumberArg(maxLenAttr, 0) is { } ml)
        {
            schema["maxLength"] = (int)ml;
        }

        if (FindAttr(attrs, "MinLength") is { } minLenAttr && NumberArg(minLenAttr, 0) is { } nl)
        {
            schema["minLength"] = (int)nl;
        }

        if (FindAttr(attrs, "RegularExpression") is { } regex && StringArg(regex) is { } pattern)
        {
            schema["pattern"] = pattern;
        }

        if (HasAttr(attrs, "EmailAddress"))
        {
            schema["format"] = "email";
        }
    }

    private JsonObject Unknown(string typeName)
    {
        _diagnostics.Add(new Diagnostic(
            "unresolvedType",
            $"Could not resolve type '{typeName}' from source; emitted as an open schema.",
            "warning"));
        return new JsonObject();
    }
}
