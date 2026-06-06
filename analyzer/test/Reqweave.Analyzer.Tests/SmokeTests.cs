using System.Text.RegularExpressions;
using Reqweave.Analyzer;
using Xunit;

namespace Reqweave.Analyzer.Tests;

public class SmokeTests
{
    [Fact]
    public void IrVersion_IsSemver()
    {
        Assert.Matches(@"^\d+\.\d+\.\d+$", AnalyzerInfo.IrVersion);
    }

    [Fact]
    public void Describe_MentionsTheAnalyzer()
    {
        Assert.Contains("reqweave-analyzer", AnalyzerInfo.Describe());
    }
}
