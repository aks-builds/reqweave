using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using static Reqweave.Analyzer.SyntaxHelpers;

namespace Reqweave.Analyzer;

/// <summary>
/// Discovers attribute-routed ASP.NET Core controllers and their actions from
/// syntax and turns them into IR endpoints. Tolerant: anything it can't resolve
/// becomes a diagnostic, never a crash.
/// </summary>
public sealed class ControllerAnalyzer
{
    private static readonly Dictionary<string, string> HttpAttrToVerb = new(StringComparer.Ordinal)
    {
        ["HttpGet"] = "GET",
        ["HttpPost"] = "POST",
        ["HttpPut"] = "PUT",
        ["HttpPatch"] = "PATCH",
        ["HttpDelete"] = "DELETE",
        ["HttpHead"] = "HEAD",
        ["HttpOptions"] = "OPTIONS",
    };

    private static readonly HashSet<string> BodyVerbs = new(StringComparer.Ordinal) { "POST", "PUT", "PATCH" };

    private static readonly HashSet<string> ActionResultNames = new(StringComparer.Ordinal)
    {
        "IActionResult", "ActionResult", "IResult", "Task", "ValueTask", "void", "Void",
    };

    private static readonly HashSet<string> SkipParamTypes = new(StringComparer.Ordinal)
    {
        "CancellationToken", "HttpContext", "HttpRequest", "HttpResponse", "ClaimsPrincipal",
    };

    private static readonly Regex StatusMember = new(@"Status(\d{3})", RegexOptions.Compiled);

    private readonly SourceIndex _index;
    private readonly SchemaMapper _mapper;
    private readonly List<Diagnostic> _diagnostics = new();

    public ControllerAnalyzer(SourceIndex index)
    {
        _index = index;
        _mapper = new SchemaMapper(index, _diagnostics);
    }

    public (IReadOnlyList<Endpoint> Endpoints, IReadOnlyList<Diagnostic> Diagnostics) Analyze()
    {
        var endpoints = new List<Endpoint>();

        foreach (var type in _index.Types)
        {
            if (type is ClassDeclarationSyntax cls && IsController(cls))
            {
                endpoints.AddRange(AnalyzeController(cls));
            }
        }

        endpoints.Sort((a, b) =>
        {
            var r = string.CompareOrdinal(a.RouteTemplate, b.RouteTemplate);
            return r != 0 ? r : string.CompareOrdinal(a.Method, b.Method);
        });

        return (endpoints, _diagnostics);
    }

    private static bool IsController(ClassDeclarationSyntax cls)
    {
        if (HasAttr(cls.AttributeLists, "ApiController"))
        {
            return true;
        }

        if (cls.BaseList is { } bases)
        {
            foreach (var b in bases.Types)
            {
                var name = b.Type.ToString();
                if (name.EndsWith("ControllerBase", StringComparison.Ordinal)
                    || name.EndsWith("Controller", StringComparison.Ordinal))
                {
                    return true;
                }
            }
        }

        return cls.Identifier.Text.EndsWith("Controller", StringComparison.Ordinal);
    }

    private static string ControllerName(ClassDeclarationSyntax cls)
    {
        var name = cls.Identifier.Text;
        return name.EndsWith("Controller", StringComparison.Ordinal)
            ? name[..^"Controller".Length]
            : name;
    }

    private IEnumerable<Endpoint> AnalyzeController(ClassDeclarationSyntax cls)
    {
        var controllerName = ControllerName(cls);
        var classRoute = ClassRoute(cls, controllerName);
        var classAuthorize = HasAttr(cls.AttributeLists, "Authorize");

        foreach (var method in cls.Members.OfType<MethodDeclarationSyntax>())
        {
            if (!IsPublic(method))
            {
                continue;
            }

            foreach (var attr in Attributes(method.AttributeLists))
            {
                if (!HttpAttrToVerb.TryGetValue(AttrName(attr), out var verb))
                {
                    continue;
                }

                var methodRoute = StringArg(attr)
                    ?? (FindAttr(method.AttributeLists, "Route") is { } r ? StringArg(r) : null);
                var route = RouteUtil.Normalize(Combine(classRoute, methodRoute, method.Identifier.Text));
                yield return BuildEndpoint(cls, method, controllerName, verb, route, classAuthorize);
            }
        }
    }

    private Endpoint BuildEndpoint(
        ClassDeclarationSyntax cls,
        MethodDeclarationSyntax method,
        string controllerName,
        string verb,
        string route,
        bool classAuthorize)
    {
        var id = $"{controllerName}.{method.Identifier.Text}";
        var tokens = RouteUtil.Tokens(route);

        var parameters = new List<Param>();
        RequestBody? body = null;

        foreach (var p in method.ParameterList.Parameters)
        {
            if (p.Type is null || HasAttr(p.AttributeLists, "FromServices"))
            {
                continue;
            }

            var typeName = LastTypeName(p.Type);
            if (SkipParamTypes.Contains(typeName))
            {
                continue;
            }

            var paramName = p.Identifier.Text;
            var schema = _mapper.Map(p.Type);
            var binding = Binding(p, verb, tokens, paramName, schema);
            var nullable = p.Type is NullableTypeSyntax || schema["nullable"]?.GetValue<bool>() == true;

            if (binding == "body")
            {
                body = new RequestBody(Required: !nullable && p.Default is null, "application/json", schema);
                continue;
            }

            var required = binding == "route" || (!nullable && p.Default is null);
            parameters.Add(new Param(paramName, binding, required, schema));
        }

        var responses = Responses(method);
        var auth = AuthFor(method, classAuthorize, id);
        var summary = TryGetSummary(method);

        return new Endpoint(
            Id: id,
            Method: verb,
            RouteTemplate: route,
            Params: parameters,
            Responses: responses,
            Auth: auth,
            OperationId: method.Identifier.Text,
            Summary: summary,
            RequestBody: body);
    }

    private string Binding(ParameterSyntax p, string verb, HashSet<string> tokens, string name, JsonObject schema)
    {
        if (HasAttr(p.AttributeLists, "FromRoute"))
        {
            return "route";
        }

        if (HasAttr(p.AttributeLists, "FromQuery"))
        {
            return "query";
        }

        if (HasAttr(p.AttributeLists, "FromHeader"))
        {
            return "header";
        }

        if (HasAttr(p.AttributeLists, "FromBody") || HasAttr(p.AttributeLists, "FromForm"))
        {
            return "body";
        }

        if (tokens.Contains(name))
        {
            return "route";
        }

        var isObject = schema["type"]?.GetValue<string>() == "object";
        if (isObject && BodyVerbs.Contains(verb))
        {
            return "body";
        }

        return "query";
    }

    private IReadOnlyList<ApiResponse> Responses(MethodDeclarationSyntax method)
    {
        var responses = new List<ApiResponse>();
        var seen = new HashSet<int>();

        foreach (var attr in Attributes(method.AttributeLists))
        {
            if (AttrName(attr) is not ("ProducesResponseType" or "ProducesResponseTypeAttribute"))
            {
                continue;
            }

            int? status = null;
            TypeSyntax? typeArg = null;

            foreach (var arg in attr.ArgumentList?.Arguments ?? default)
            {
                switch (arg.Expression)
                {
                    case TypeOfExpressionSyntax t:
                        typeArg = t.Type;
                        break;
                    case LiteralExpressionSyntax lit when lit.Token.Value is int code:
                        status = code;
                        break;
                    case MemberAccessExpressionSyntax m when StatusMember.Match(m.Name.Identifier.Text) is { Success: true } sm:
                        status = int.Parse(sm.Groups[1].Value);
                        break;
                }
            }

            var s = status ?? 200;
            if (seen.Add(s))
            {
                responses.Add(new ApiResponse(s, Schema: typeArg is null ? null : _mapper.Map(typeArg)));
            }
        }

        // Fall back to the return type for a 200 if nothing else covers it.
        if (!seen.Contains(200))
        {
            var returnSchema = ReturnSchema(method.ReturnType);
            if (returnSchema is not null)
            {
                responses.Add(new ApiResponse(200, Schema: returnSchema));
                seen.Add(200);
            }
        }

        if (responses.Count == 0)
        {
            responses.Add(new ApiResponse(200));
        }

        responses.Sort((a, b) => a.Status.CompareTo(b.Status));
        return responses;
    }

    private JsonObject? ReturnSchema(TypeSyntax returnType)
    {
        var unwrapped = returnType;

        // Unwrap Task<...> / ValueTask<...> / ActionResult<...>.
        while (unwrapped is GenericNameSyntax g
            && g.Identifier.Text is "Task" or "ValueTask" or "ActionResult" or "Results"
            && g.TypeArgumentList.Arguments.Count == 1)
        {
            unwrapped = g.TypeArgumentList.Arguments[0];
        }

        if (ActionResultNames.Contains(LastTypeName(unwrapped)))
        {
            return null; // no payload schema for bare IActionResult/void/etc.
        }

        return _mapper.Map(unwrapped);
    }

    private Auth AuthFor(MethodDeclarationSyntax method, bool classAuthorize, string endpointId)
    {
        var methodAuthorize = HasAttr(method.AttributeLists, "Authorize");
        var allowAnonymous = HasAttr(method.AttributeLists, "AllowAnonymous");
        var required = (classAuthorize || methodAuthorize) && !allowAnonymous;

        if (!required)
        {
            return new Auth(false, new[] { new AuthScheme("none") });
        }

        _diagnostics.Add(new Diagnostic(
            "assumedConvention",
            "Assumed Bearer auth for an [Authorize] endpoint; confirm the actual scheme.",
            "info",
            endpointId));

        return new Auth(true, new[] { new AuthScheme("bearer", "header", "Authorization") });
    }

    private static string ClassRoute(ClassDeclarationSyntax cls, string controllerName)
    {
        var routeAttr = FindAttr(cls.AttributeLists, "Route");
        var template = routeAttr is null ? string.Empty : StringArg(routeAttr) ?? string.Empty;
        return template
            .Replace("[controller]", controllerName, StringComparison.Ordinal)
            .Replace("[action]", string.Empty, StringComparison.Ordinal);
    }

    private static string Combine(string classRoute, string? methodRoute, string actionName)
    {
        methodRoute = (methodRoute ?? string.Empty)
            .Replace("[action]", actionName, StringComparison.Ordinal)
            .TrimStart('~');

        if (methodRoute.StartsWith("/", StringComparison.Ordinal))
        {
            return methodRoute;
        }

        var parts = new[] { classRoute, methodRoute }
            .Select(p => p.Trim('/'))
            .Where(p => p.Length > 0);
        return "/" + string.Join("/", parts);
    }

    private static string LastTypeName(TypeSyntax type) => type switch
    {
        NullableTypeSyntax nt => LastTypeName(nt.ElementType),
        GenericNameSyntax g => g.Identifier.Text,
        IdentifierNameSyntax id => id.Identifier.Text,
        QualifiedNameSyntax q => q.Right.Identifier.Text,
        PredefinedTypeSyntax p => p.Keyword.Text,
        ArrayTypeSyntax => "Array",
        _ => type.ToString(),
    };

    private static string? TryGetSummary(MethodDeclarationSyntax method)
    {
        foreach (var trivia in method.GetLeadingTrivia())
        {
            if (trivia.GetStructure() is not DocumentationCommentTriviaSyntax doc)
            {
                continue;
            }

            foreach (var element in doc.Content.OfType<XmlElementSyntax>())
            {
                if (element.StartTag.Name.LocalName.Text != "summary")
                {
                    continue;
                }

                var text = string.Concat(element.Content.ToFullString()
                    .Replace("///", " ", StringComparison.Ordinal)
                    .Split('\n')
                    .Select(l => l.Trim()))
                    .Trim();
                return string.IsNullOrWhiteSpace(text) ? null : text;
            }
        }

        return null;
    }
}
