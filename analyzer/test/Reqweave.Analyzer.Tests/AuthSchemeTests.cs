using System.Linq;
using Reqweave.Analyzer;
using Xunit;

namespace Reqweave.Analyzer.Tests;

public class AuthSchemeTests
{
    private static Ir Analyze(string source)
    {
        var dir = System.IO.Directory.CreateTempSubdirectory("reqweave-auth");
        try
        {
            System.IO.File.WriteAllText(System.IO.Path.Combine(dir.FullName, "Api.cs"), source);
            return Program.Analyze(dir.FullName, "Svc", "2026-06-06T00:00:00Z");
        }
        finally
        {
            dir.Delete(recursive: true);
        }
    }

    private const string Controller = """
        [Microsoft.AspNetCore.Mvc.ApiController]
        [Microsoft.AspNetCore.Mvc.Route("api/[controller]")]
        [Microsoft.AspNetCore.Authorization.Authorize{AUTHORIZE_ARGS}]
        public class SecureController : Microsoft.AspNetCore.Mvc.ControllerBase
        {
            [Microsoft.AspNetCore.Mvc.HttpGet]
            public Microsoft.AspNetCore.Mvc.IActionResult Get() => Ok();
        }
        """;

    private static string WithConfig(string addCall, string authorizeArgs = "") =>
        $$"""
        public static class Setup
        {
            public static void Configure(object services)
            {
                services.AddAuthentication(){{addCall}};
            }
        }
        {{Controller.Replace("{AUTHORIZE_ARGS}", authorizeArgs)}}
        """;

    private static bool HasAssumed(Ir ir) => ir.Diagnostics.Any(d => d.Code == "assumedConvention");

    private static AuthScheme Scheme(Ir ir) => ir.Endpoints.Single().Auth.Schemes.Single();

    [Fact]
    public void Detects_jwt_bearer_from_config_without_assumption()
    {
        var ir = Analyze(WithConfig(".AddJwtBearer()"));
        Assert.True(ir.Endpoints.Single().Auth.Required);
        Assert.Equal("bearer", Scheme(ir).Type);
        Assert.False(HasAssumed(ir));
    }

    [Fact]
    public void Detects_api_key_from_config()
    {
        var ir = Analyze(WithConfig(".AddApiKeyInHeader()"));
        Assert.Equal("apiKey", Scheme(ir).Type);
        Assert.False(HasAssumed(ir));
    }

    [Fact]
    public void Detects_oauth_from_config()
    {
        var ir = Analyze(WithConfig(".AddOpenIdConnect()"));
        Assert.Equal("oauth2", Scheme(ir).Type);
    }

    [Fact]
    public void Explicit_authentication_scheme_wins()
    {
        // No config; explicit [Authorize(AuthenticationSchemes="BasicAuthentication")].
        var ir = Analyze(Controller.Replace("{AUTHORIZE_ARGS}", "(AuthenticationSchemes = \"BasicAuthentication\")"));
        Assert.Equal("basic", Scheme(ir).Type);
        Assert.False(HasAssumed(ir));
    }

    [Fact]
    public void Falls_back_to_bearer_with_diagnostic_when_nothing_detected()
    {
        var ir = Analyze(Controller.Replace("{AUTHORIZE_ARGS}", ""));
        Assert.Equal("bearer", Scheme(ir).Type);
        Assert.True(HasAssumed(ir)); // fallback assumption preserved
    }
}
