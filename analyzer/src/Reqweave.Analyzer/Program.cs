namespace Reqweave.Analyzer;

/// <summary>
/// Metadata for the analyzer. The analyzer's only job (from Phase 2) is to read
/// a .NET service codebase and emit the reqweave Universal IR as JSON. Phase 0
/// ships this stub so the build, tests, and CLI surface exist.
/// </summary>
public static class AnalyzerInfo
{
    /// <summary>The reqweave IR schema version this analyzer emits.</summary>
    public const string IrVersion = "0.1.0";

    /// <summary>A one-line description of the analyzer build.</summary>
    public static string Describe() => $"reqweave-analyzer (IR v{IrVersion})";
}

/// <summary>Entry point. Real static/build analysis lands in Phase 2/3.</summary>
public static class Program
{
    public static int Main(string[] args)
    {
        if (args.Length > 0 && args[0] is "--version" or "-v")
        {
            Console.WriteLine(AnalyzerInfo.IrVersion);
            return 0;
        }

        Console.WriteLine(AnalyzerInfo.Describe());
        Console.WriteLine("Phase 0 stub — static .NET REST analysis lands in Phase 2.");
        return 0;
    }
}
