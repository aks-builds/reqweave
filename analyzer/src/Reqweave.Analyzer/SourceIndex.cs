using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace Reqweave.Analyzer;

/// <summary>
/// Parses every C# source file under a root and indexes type/enum declarations
/// by simple name, so DTO shapes can be resolved purely from syntax — no build,
/// no restore, no semantic Compilation.
/// </summary>
public sealed class SourceIndex
{
    private static readonly HashSet<string> SkipDirs = new(StringComparer.OrdinalIgnoreCase)
    {
        "bin",
        "obj",
        "node_modules",
        ".git",
        ".vs",
        "packages",
    };

    private readonly Dictionary<string, TypeDeclarationSyntax> _types;
    private readonly Dictionary<string, EnumDeclarationSyntax> _enums;

    public IReadOnlyList<SyntaxTree> Trees { get; }

    private SourceIndex(
        IReadOnlyList<SyntaxTree> trees,
        Dictionary<string, TypeDeclarationSyntax> types,
        Dictionary<string, EnumDeclarationSyntax> enums)
    {
        Trees = trees;
        _types = types;
        _enums = enums;
    }

    public static SourceIndex Load(string path)
    {
        var root = Directory.Exists(path)
            ? path
            : Path.GetDirectoryName(Path.GetFullPath(path)) ?? ".";

        var trees = new List<SyntaxTree>();
        foreach (var file in EnumerateCsFiles(root))
        {
            string text;
            try
            {
                text = File.ReadAllText(file);
            }
            catch (IOException)
            {
                continue; // unreadable file: skip rather than fail the whole run
            }

            trees.Add(CSharpSyntaxTree.ParseText(text, path: file));
        }

        var types = new Dictionary<string, TypeDeclarationSyntax>(StringComparer.Ordinal);
        var enums = new Dictionary<string, EnumDeclarationSyntax>(StringComparer.Ordinal);

        foreach (var tree in trees)
        {
            var rootNode = tree.GetRoot();
            foreach (var type in rootNode.DescendantNodes().OfType<TypeDeclarationSyntax>())
            {
                // First declaration wins (deterministic: trees are sorted by path).
                types.TryAdd(type.Identifier.Text, type);
            }

            foreach (var en in rootNode.DescendantNodes().OfType<EnumDeclarationSyntax>())
            {
                enums.TryAdd(en.Identifier.Text, en);
            }
        }

        return new SourceIndex(trees, types, enums);
    }

    public TypeDeclarationSyntax? FindType(string simpleName) =>
        _types.TryGetValue(simpleName, out var t) ? t : null;

    public EnumDeclarationSyntax? FindEnum(string simpleName) =>
        _enums.TryGetValue(simpleName, out var e) ? e : null;

    /// <summary>All class/record declarations, in a deterministic order.</summary>
    public IEnumerable<TypeDeclarationSyntax> Types => _types.Values;

    private static IEnumerable<string> EnumerateCsFiles(string root)
    {
        // Deterministic, hang-safe manual walk that prunes build/output dirs.
        var files = new List<string>();
        var stack = new Stack<string>();
        stack.Push(root);

        while (stack.Count > 0)
        {
            var dir = stack.Pop();
            string[] subDirs;
            string[] csFiles;
            try
            {
                subDirs = Directory.GetDirectories(dir);
                csFiles = Directory.GetFiles(dir, "*.cs");
            }
            catch (UnauthorizedAccessException)
            {
                continue;
            }
            catch (DirectoryNotFoundException)
            {
                continue;
            }

            files.AddRange(csFiles);

            foreach (var sub in subDirs)
            {
                var name = Path.GetFileName(sub);
                if (!SkipDirs.Contains(name))
                {
                    stack.Push(sub);
                }
            }
        }

        files.Sort(StringComparer.Ordinal); // deterministic order
        return files;
    }
}
