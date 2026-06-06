using System.Text.RegularExpressions;

namespace Reqweave.Analyzer;

/// <summary>Shared route-template helpers used by both endpoint analyzers.</summary>
public static class RouteUtil
{
    private static readonly Regex TokenConstraint = new(
        @"\{\*?([A-Za-z_][A-Za-z0-9_]*)(?::[^}]+)?\??\}",
        RegexOptions.Compiled);

    private static readonly Regex Token = new(@"\{([A-Za-z_][A-Za-z0-9_]*)", RegexOptions.Compiled);

    /// <summary>Normalize "{id:int}" / "{id?}" / "{*rest}" to "{id}"; ensure a leading "/".</summary>
    public static string Normalize(string route)
    {
        var r = TokenConstraint.Replace(route, "{$1}");
        if (r.Length == 0)
        {
            return "/";
        }

        return r.StartsWith('/') ? r : "/" + r;
    }

    /// <summary>The route token names in a template.</summary>
    public static HashSet<string> Tokens(string route)
    {
        var set = new HashSet<string>(StringComparer.Ordinal);
        foreach (Match m in Token.Matches(route))
        {
            set.Add(m.Groups[1].Value);
        }

        return set;
    }

    /// <summary>A lowercase, alphanumeric-dash slug (for synthesizing ids).</summary>
    public static string Slug(string s)
    {
        var lowered = s.ToLowerInvariant();
        var dashed = Regex.Replace(lowered, "[^a-z0-9]+", "-");
        return dashed.Trim('-') is { Length: > 0 } t ? t : "root";
    }
}
