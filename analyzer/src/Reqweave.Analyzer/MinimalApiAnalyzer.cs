using System.Text.Json.Nodes;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using static Reqweave.Analyzer.SyntaxHelpers;

namespace Reqweave.Analyzer;

/// <summary>
/// Discovers ASP.NET Core minimal-API endpoints (`app.MapGet("/x", handler)`)
/// from syntax and turns them into IR endpoints. Tolerant: non-lambda handlers
/// and untyped params degrade to diagnostics, never a crash.
/// </summary>
public sealed class MinimalApiAnalyzer
{
    private static readonly Dictionary<string, string> MapToVerb = new(StringComparer.Ordinal)
    {
        ["MapGet"] = "GET",
        ["MapPost"] = "POST",
        ["MapPut"] = "PUT",
        ["MapDelete"] = "DELETE",
        ["MapPatch"] = "PATCH",
    };

    private static readonly HashSet<string> BodyVerbs = new(StringComparer.Ordinal) { "POST", "PUT", "PATCH" };

    private static readonly HashSet<string> SkipParamTypes = new(StringComparer.Ordinal)
    {
        "CancellationToken", "HttpContext", "HttpRequest", "HttpResponse", "ClaimsPrincipal",
    };

    private readonly SourceIndex _index;
    private readonly SchemaMapper _mapper;
    private readonly AuthSchemeDetector _auth;
    private readonly List<Diagnostic> _diagnostics = new();

    public MinimalApiAnalyzer(SourceIndex index)
    {
        _index = index;
        _mapper = new SchemaMapper(index, _diagnostics);
        _auth = new AuthSchemeDetector(index);
    }

    public (IReadOnlyList<Endpoint> Endpoints, IReadOnlyList<Diagnostic> Diagnostics) Analyze()
    {
        var endpoints = new List<Endpoint>();

        foreach (var tree in _index.Trees)
        {
            foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
            {
                var name = MemberName(inv);
                if (name is null || !MapToVerb.TryGetValue(name, out var verb))
                {
                    continue;
                }

                var args = inv.ArgumentList.Arguments;
                if (args.Count < 1 || args[0].Expression is not LiteralExpressionSyntax lit || lit.Token.Value is not string route)
                {
                    continue;
                }

                endpoints.Add(Build(inv, verb, RouteUtil.Normalize(route), args));
            }
        }

        endpoints.Sort((a, b) =>
        {
            var r = string.CompareOrdinal(a.RouteTemplate, b.RouteTemplate);
            return r != 0 ? r : string.CompareOrdinal(a.Method, b.Method);
        });

        return (endpoints, _diagnostics);
    }

    private Endpoint Build(InvocationExpressionSyntax inv, string verb, string route, SeparatedSyntaxList<ArgumentSyntax> args)
    {
        var tokens = RouteUtil.Tokens(route);
        var parameters = new List<Param>();
        RequestBody? body = null;

        var handler = args.Count >= 2 ? args[1].Expression : null;
        var handlerParams = HandlerParams(handler);
        if (handler is not null && handlerParams is null)
        {
            _diagnostics.Add(new Diagnostic(
                "unsupportedFeature",
                $"Minimal API '{verb} {route}' handler is not a lambda; parameters not analyzed.",
                "info"));
        }

        foreach (var p in handlerParams ?? Enumerable.Empty<ParameterSyntax>())
        {
            if (p.Type is null || HasAttr(p.AttributeLists, "FromServices"))
            {
                continue;
            }

            if (SkipParamTypes.Contains(LastTypeName(p.Type)))
            {
                continue;
            }

            var paramName = p.Identifier.Text;
            var schema = _mapper.Map(p.Type);
            var binding = Binding(p, verb, tokens, paramName, schema);
            var nullable = p.Type is NullableTypeSyntax || schema["nullable"]?.GetValue<bool>() == true;

            if (binding == "body")
            {
                body = new RequestBody(!nullable && p.Default is null, "application/json", schema);
                continue;
            }

            parameters.Add(new Param(paramName, binding, binding == "route" || (!nullable && p.Default is null), schema));
        }

        Auth auth;
        if (RequiresAuthorization(inv))
        {
            var (schemes, confident) = _auth.Resolve(null);
            if (!confident)
            {
                _diagnostics.Add(new Diagnostic(
                    "assumedConvention",
                    $"Assumed Bearer auth for minimal API '{verb} {route}' (RequireAuthorization); no auth scheme configuration detected.",
                    "info"));
            }

            auth = new Auth(true, schemes);
        }
        else
        {
            auth = new Auth(false, new[] { new AuthScheme("none") });
        }

        var status = verb switch
        {
            "POST" => 201,
            "DELETE" => 204,
            "PUT" or "PATCH" => body is null ? 204 : 200,
            _ => 200,
        };
        var id = $"{verb.ToLowerInvariant()}_{RouteUtil.Slug(route)}";
        return new Endpoint(id, verb, route, parameters, new[] { new ApiResponse(status) }, auth, OperationId: id, RequestBody: body);
    }

    private static string? MemberName(InvocationExpressionSyntax inv) => inv.Expression switch
    {
        MemberAccessExpressionSyntax ma => ma.Name.Identifier.Text,
        IdentifierNameSyntax id => id.Identifier.Text,
        _ => null,
    };

    private static IEnumerable<ParameterSyntax>? HandlerParams(ExpressionSyntax? handler) => handler switch
    {
        ParenthesizedLambdaExpressionSyntax pl => pl.ParameterList.Parameters,
        SimpleLambdaExpressionSyntax sl => new[] { sl.Parameter },
        _ => null,
    };

    private static bool RequiresAuthorization(InvocationExpressionSyntax inv)
    {
        var stmt = inv.FirstAncestorOrSelf<StatementSyntax>();
        return stmt is not null
            && stmt.DescendantNodes().OfType<InvocationExpressionSyntax>().Any((i) => MemberName(i) == "RequireAuthorization");
    }

    // Same binding inference as ControllerAnalyzer (kept local to avoid coupling).
    private static string Binding(ParameterSyntax p, string verb, HashSet<string> tokens, string name, JsonObject schema)
    {
        if (HasAttr(p.AttributeLists, "FromRoute")) return "route";
        if (HasAttr(p.AttributeLists, "FromQuery")) return "query";
        if (HasAttr(p.AttributeLists, "FromHeader")) return "header";
        if (HasAttr(p.AttributeLists, "FromBody") || HasAttr(p.AttributeLists, "FromForm")) return "body";
        if (tokens.Contains(name)) return "route";
        if (schema["type"]?.GetValue<string>() == "object" && BodyVerbs.Contains(verb)) return "body";
        return "query";
    }

    private static string LastTypeName(TypeSyntax type) => type switch
    {
        NullableTypeSyntax nt => LastTypeName(nt.ElementType),
        GenericNameSyntax g => g.Identifier.Text,
        IdentifierNameSyntax id => id.Identifier.Text,
        QualifiedNameSyntax q => q.Right.Identifier.Text,
        PredefinedTypeSyntax pre => pre.Keyword.Text,
        ArrayTypeSyntax => "Array",
        _ => type.ToString(),
    };
}
