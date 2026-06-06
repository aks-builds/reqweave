using System.Linq;
using Reqweave.Analyzer;
using Xunit;

namespace Reqweave.Analyzer.Tests;

public class MinimalApiAnalyzerTests
{
    private const string Source = """
        using Microsoft.AspNetCore.Builder;
        using Microsoft.AspNetCore.Http;
        using Microsoft.AspNetCore.Mvc;

        var app = WebApplication.Create();

        app.MapGet("/todos", () => Results.Ok());
        app.MapGet("/todos/{id}", (int id) => Results.Ok()).RequireAuthorization();
        app.MapPost("/todos", (TodoDto todo) => Results.Created("/todos/1", todo));

        app.Run();

        public class TodoDto
        {
            public string Title { get; set; } = "";
            public bool Done { get; set; }
        }
        """;

    private static Ir Analyze()
    {
        var dir = System.IO.Directory.CreateTempSubdirectory("reqweave-min");
        try
        {
            System.IO.File.WriteAllText(System.IO.Path.Combine(dir.FullName, "Program.cs"), Source);
            return Program.Analyze(dir.FullName, "TodoApi", "2026-06-06T00:00:00Z");
        }
        finally
        {
            dir.Delete(recursive: true);
        }
    }

    private static Endpoint Get(Ir ir, string method, string route) =>
        ir.Endpoints.Single(e => e.Method == method && e.RouteTemplate == route);

    [Fact]
    public void Discovers_minimal_api_endpoints()
    {
        var ir = Analyze();
        Assert.Equal(3, ir.Endpoints.Count);
        Assert.Contains(ir.Endpoints, e => e is { Method: "GET", RouteTemplate: "/todos" });
        Assert.Contains(ir.Endpoints, e => e is { Method: "GET", RouteTemplate: "/todos/{id}" });
        Assert.Contains(ir.Endpoints, e => e is { Method: "POST", RouteTemplate: "/todos" });
    }

    [Fact]
    public void Route_param_is_bound_and_required()
    {
        var ep = Get(Analyze(), "GET", "/todos/{id}");
        var id = ep.Params.Single(p => p.Name == "id");
        Assert.Equal("route", id.In);
        Assert.True(id.Required);
        Assert.Equal("integer", id.Schema["type"]!.GetValue<string>());
    }

    [Fact]
    public void RequireAuthorization_marks_endpoint_authorized()
    {
        Assert.True(Get(Analyze(), "GET", "/todos/{id}").Auth.Required);
        Assert.False(Get(Analyze(), "GET", "/todos").Auth.Required);
    }

    [Fact]
    public void Complex_param_on_post_becomes_request_body()
    {
        var ep = Get(Analyze(), "POST", "/todos");
        Assert.NotNull(ep.RequestBody);
        Assert.Equal("object", ep.RequestBody!.Schema["type"]!.GetValue<string>());
        var props = ep.RequestBody.Schema["properties"]!.AsObject();
        Assert.True(props.ContainsKey("title"));
        Assert.True(props.ContainsKey("done"));
    }
}
