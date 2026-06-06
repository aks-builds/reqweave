using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace Reqweave.Analyzer;

/// <summary>Small helpers for reading attributes and names off raw syntax.</summary>
public static class SyntaxHelpers
{
    /// <summary>The attribute's simple name, minus namespace and "Attribute" suffix.</summary>
    public static string AttrName(AttributeSyntax attr)
    {
        var name = attr.Name.ToString();
        var lastDot = name.LastIndexOf('.');
        if (lastDot >= 0)
        {
            name = name[(lastDot + 1)..];
        }

        return name.EndsWith("Attribute", StringComparison.Ordinal) ? name[..^"Attribute".Length] : name;
    }

    public static IEnumerable<AttributeSyntax> Attributes(SyntaxList<AttributeListSyntax> lists) =>
        lists.SelectMany(l => l.Attributes);

    public static AttributeSyntax? FindAttr(SyntaxList<AttributeListSyntax> lists, params string[] names)
    {
        var set = new HashSet<string>(names, StringComparer.Ordinal);
        return Attributes(lists).FirstOrDefault(a => set.Contains(AttrName(a)));
    }

    public static bool HasAttr(SyntaxList<AttributeListSyntax> lists, params string[] names) =>
        FindAttr(lists, names) is not null;

    /// <summary>The string value of a positional literal argument, or null.</summary>
    public static string? StringArg(AttributeSyntax attr, int index = 0)
    {
        var args = attr.ArgumentList?.Arguments;
        if (args is null || args.Value.Count <= index)
        {
            return null;
        }

        return args.Value[index].Expression is LiteralExpressionSyntax lit && lit.Token.Value is string s
            ? s
            : null;
    }

    /// <summary>The numeric value of a positional literal argument, or null.</summary>
    public static double? NumberArg(AttributeSyntax attr, int index)
    {
        var args = attr.ArgumentList?.Arguments;
        if (args is null || args.Value.Count <= index)
        {
            return null;
        }

        return args.Value[index].Expression is LiteralExpressionSyntax lit
            && lit.Token.Value is { } v
            && double.TryParse(Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture), out var d)
            ? d
            : null;
    }

    /// <summary>The int value of a named argument (e.g. StringLength(MinimumLength = 3)).</summary>
    public static int? NamedIntArg(AttributeSyntax attr, string name)
    {
        var args = attr.ArgumentList?.Arguments;
        if (args is null)
        {
            return null;
        }

        foreach (var arg in args.Value)
        {
            if (arg.NameEquals?.Name.Identifier.Text == name
                && arg.Expression is LiteralExpressionSyntax lit
                && lit.Token.Value is int i)
            {
                return i;
            }
        }

        return null;
    }

    public static bool IsPublic(MemberDeclarationSyntax member) =>
        member.Modifiers.Any(m => m.Text == "public");

    public static string CamelCase(string s) =>
        string.IsNullOrEmpty(s) ? s : char.ToLowerInvariant(s[0]) + s[1..];
}
