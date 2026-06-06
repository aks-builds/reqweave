namespace Reqweave.Analyzer;

/// <summary>Analyzer metadata. IrVersion is kept in sync with the TS core
/// (freshness CI guards this).</summary>
public static class AnalyzerInfo
{
    public const string IrVersion = "0.1.0";

    public static string Describe() => $"reqweave-analyzer (IR v{IrVersion})";
}

/// <summary>
/// CLI entry point. Reads a .NET service codebase and emits the reqweave
/// Universal IR as JSON (static mode — no build, no run).
/// </summary>
public static class Program
{
    public static int Main(string[] args)
    {
        if (args.Length == 0 || args[0] is "-h" or "--help")
        {
            PrintUsage();
            return 0;
        }

        if (args[0] is "-v" or "--version")
        {
            Console.WriteLine(AnalyzerInfo.IrVersion);
            return 0;
        }

        string? path = null;
        string? outFile = null;
        string? generatedAt = null;
        string? service = null;
        var pretty = true;

        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--out":
                    outFile = NextArg(args, ref i);
                    break;
                case "--service":
                    service = NextArg(args, ref i);
                    break;
                case "--generated-at":
                    generatedAt = NextArg(args, ref i);
                    break;
                case "--compact":
                    pretty = false;
                    break;
                default:
                    if (!args[i].StartsWith('-'))
                    {
                        path ??= args[i];
                    }

                    break;
            }
        }

        if (path is null)
        {
            Console.Error.WriteLine("reqweave-analyzer: missing <path>. Run with --help.");
            return 2;
        }

        if (!Directory.Exists(path) && !File.Exists(path))
        {
            Console.Error.WriteLine($"reqweave-analyzer: path not found: {path}");
            return 2;
        }

        try
        {
            var ir = Analyze(path, service, generatedAt);
            var json = IrJson.Serialize(ir, pretty);
            if (outFile is null)
            {
                Console.WriteLine(json);
            }
            else
            {
                File.WriteAllText(outFile, json + "\n");
                Console.Error.WriteLine($"reqweave-analyzer: wrote {ir.Endpoints.Count} endpoint(s) to {outFile}");
            }

            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"reqweave-analyzer: {ex.Message}");
            return 1;
        }
    }

    /// <summary>Analyze a path and return the IR. Public so tests can drive it directly.</summary>
    public static Ir Analyze(string path, string? service, string? generatedAt)
    {
        var index = SourceIndex.Load(path);
        var (controllerEps, controllerDiag) = new ControllerAnalyzer(index).Analyze();
        var (minimalEps, minimalDiag) = new MinimalApiAnalyzer(index).Analyze();
        var endpoints = Merge(controllerEps, minimalEps);
        var diagnostics = controllerDiag.Concat(minimalDiag).ToList();
        var serviceName = service ?? DeriveServiceName(path);
        var meta = new Meta(
            AnalyzerInfo.IrVersion,
            "static",
            generatedAt ?? DateTimeOffset.UtcNow.ToString("o"));

        return new Ir(
            AnalyzerInfo.IrVersion,
            new ServiceInfo(serviceName, Array.Empty<string>()),
            endpoints,
            diagnostics,
            meta);
    }

    // Combine controller + minimal-API endpoints: stable ordering and unique ids.
    private static IReadOnlyList<Endpoint> Merge(IReadOnlyList<Endpoint> a, IReadOnlyList<Endpoint> b)
    {
        var all = a.Concat(b).ToList();
        all.Sort((x, y) =>
        {
            var r = string.CompareOrdinal(x.RouteTemplate, y.RouteTemplate);
            return r != 0 ? r : string.CompareOrdinal(x.Method, y.Method);
        });

        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i < all.Count; i++)
        {
            var id = all[i].Id;
            var unique = id;
            var n = 1;
            while (!seen.Add(unique))
            {
                unique = $"{id}-{++n}";
            }

            if (unique != id)
            {
                all[i] = all[i] with { Id = unique };
            }
        }

        return all;
    }

    private static string? NextArg(string[] args, ref int i) => i + 1 < args.Length ? args[++i] : null;

    private static string DeriveServiceName(string path)
    {
        var full = Path.GetFullPath(path);
        var name = Directory.Exists(full)
            ? new DirectoryInfo(full).Name
            : Path.GetFileNameWithoutExtension(full);
        return string.IsNullOrEmpty(name) ? "service" : name;
    }

    private static void PrintUsage()
    {
        Console.WriteLine(
            """
            reqweave-analyzer — read a .NET service codebase, emit the reqweave IR (JSON).

            Usage:
              reqweave-analyzer <path> [options]

            Options:
              --out <file>          Write IR JSON to a file (default: stdout).
              --service <name>      Service name (default: derived from the path).
              --generated-at <iso>  Timestamp to stamp into meta (default: now).
              --compact             Compact JSON instead of pretty.
              -h, --help            Show this help.
              -v, --version         Print the IR version.
            """);
    }
}
