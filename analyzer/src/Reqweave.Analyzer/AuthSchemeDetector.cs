using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using static Reqweave.Analyzer.SyntaxHelpers;

namespace Reqweave.Analyzer;

/// <summary>
/// Detects the API's authentication scheme(s) from how auth is wired
/// (AddJwtBearer / AddOAuth / AddOpenIdConnect / Add*ApiKey* / AddBasic* /
/// AddAuthentication("scheme")) and from explicit
/// [Authorize(AuthenticationSchemes="...")]. Falls back to bearer only when
/// nothing is detected.
/// </summary>
public sealed class AuthSchemeDetector
{
    private readonly IReadOnlyList<AuthScheme> _appSchemes;

    public AuthSchemeDetector(SourceIndex index)
    {
        _appSchemes = DetectAppSchemes(index);
    }

    /// <summary>Schemes for an authorized endpoint. Confident=false only when we
    /// fell back to a bearer assumption (no config and no explicit scheme).</summary>
    public (IReadOnlyList<AuthScheme> Schemes, bool Confident) Resolve(AttributeSyntax? authorizeAttr)
    {
        var named = authorizeAttr is null ? null : NamedStringArg(authorizeAttr, "AuthenticationSchemes");
        if (named is not null)
        {
            var explicitSchemes = named
                .Split(',')
                .Select((s) => s.Trim())
                .Where((s) => s.Length > 0)
                .Select(SchemeFromName)
                .OfType<AuthScheme>()
                .ToList();
            if (explicitSchemes.Count > 0)
            {
                return (Dedupe(explicitSchemes), true);
            }
        }

        return _appSchemes.Count > 0 ? (_appSchemes, true) : (new[] { Bearer() }, false);
    }

    private static IReadOnlyList<AuthScheme> DetectAppSchemes(SourceIndex index)
    {
        var found = new List<AuthScheme>();
        foreach (var tree in index.Trees)
        {
            foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
            {
                var name = MemberName(inv);
                if (name is null)
                {
                    continue;
                }

                var scheme = SchemeFromAddCall(name, inv);
                if (scheme is not null)
                {
                    found.Add(scheme);
                }
            }
        }

        return Dedupe(found);
    }

    private static AuthScheme? SchemeFromAddCall(string method, InvocationExpressionSyntax inv)
    {
        if (method.StartsWith("AddJwtBearer", StringComparison.Ordinal))
        {
            return Bearer();
        }

        if (method is "AddOAuth" or "AddOpenIdConnect")
        {
            return new AuthScheme("oauth2");
        }

        if (method.Contains("ApiKey", StringComparison.Ordinal))
        {
            return new AuthScheme("apiKey", "header", "X-API-Key");
        }

        if (method.StartsWith("AddBasic", StringComparison.Ordinal))
        {
            return new AuthScheme("basic");
        }

        if (method == "AddAuthentication")
        {
            var arg = inv.ArgumentList?.Arguments.Count > 0 ? inv.ArgumentList.Arguments[0].Expression.ToString() : "";
            return SchemeFromName(arg ?? "");
        }

        return null;
    }

    private static AuthScheme? SchemeFromName(string name)
    {
        if (name.Contains("Bearer", StringComparison.OrdinalIgnoreCase) || name.Contains("Jwt", StringComparison.OrdinalIgnoreCase))
        {
            return Bearer();
        }

        if (name.Contains("ApiKey", StringComparison.OrdinalIgnoreCase))
        {
            return new AuthScheme("apiKey", "header", "X-API-Key");
        }

        if (name.Contains("Basic", StringComparison.OrdinalIgnoreCase))
        {
            return new AuthScheme("basic");
        }

        if (name.Contains("OAuth", StringComparison.OrdinalIgnoreCase)
            || name.Contains("OpenIdConnect", StringComparison.OrdinalIgnoreCase)
            || name.Contains("oidc", StringComparison.OrdinalIgnoreCase))
        {
            return new AuthScheme("oauth2");
        }

        return null;
    }

    private static AuthScheme Bearer() => new("bearer", "header", "Authorization");

    private static IReadOnlyList<AuthScheme> Dedupe(IEnumerable<AuthScheme> schemes)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var result = new List<AuthScheme>();
        foreach (var s in schemes)
        {
            if (seen.Add(s.Type))
            {
                result.Add(s);
            }
        }

        return result;
    }

    private static string? MemberName(InvocationExpressionSyntax inv) => inv.Expression switch
    {
        MemberAccessExpressionSyntax ma => ma.Name.Identifier.Text,
        IdentifierNameSyntax id => id.Identifier.Text,
        _ => null,
    };
}
