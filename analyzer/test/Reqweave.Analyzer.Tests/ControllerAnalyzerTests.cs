using System.Linq;
using System.Text.Json.Nodes;
using Reqweave.Analyzer;
using Xunit;

namespace Reqweave.Analyzer.Tests;

public class ControllerAnalyzerTests
{
    private const string Source = """
        using System;
        using System.Collections.Generic;
        using System.ComponentModel.DataAnnotations;
        using Microsoft.AspNetCore.Authorization;
        using Microsoft.AspNetCore.Mvc;

        namespace Demo;

        public enum PetKind { Dog, Cat }

        public class PetDto
        {
            [Required]
            [StringLength(50, MinimumLength = 1)]
            public string Name { get; set; }

            [Range(0, 30)]
            public int Age { get; set; }

            public PetKind Kind { get; set; }
        }

        [ApiController]
        [Route("api/[controller]")]
        [Authorize]
        public class PetsController : ControllerBase
        {
            /// <summary>Get a pet by id.</summary>
            [HttpGet("{id}")]
            [ProducesResponseType(typeof(PetDto), 200)]
            [ProducesResponseType(404)]
            public ActionResult<PetDto> GetById(int id, [FromQuery] string? expand) => null;

            [HttpPost]
            [AllowAnonymous]
            public ActionResult<PetDto> Create([FromBody] PetDto pet) => null;
        }
        """;

    private static Ir Analyze()
    {
        var dir = System.IO.Directory.CreateTempSubdirectory("reqweave-test");
        try
        {
            System.IO.File.WriteAllText(System.IO.Path.Combine(dir.FullName, "Api.cs"), Source);
            return Program.Analyze(dir.FullName, "TestSvc", "2026-06-06T00:00:00Z");
        }
        finally
        {
            dir.Delete(recursive: true);
        }
    }

    private static Endpoint Get(Ir ir, string method, string route) =>
        ir.Endpoints.Single(e => e.Method == method && e.RouteTemplate == route);

    [Fact]
    public void Discovers_both_endpoints_with_routes()
    {
        var ir = Analyze();
        Assert.Equal("0.1.0", ir.IrVersion);
        Assert.Equal(2, ir.Endpoints.Count);
        Assert.Contains(ir.Endpoints, e => e is { Method: "GET", RouteTemplate: "/api/Pets/{id}" });
        Assert.Contains(ir.Endpoints, e => e is { Method: "POST", RouteTemplate: "/api/Pets" });
    }

    [Fact]
    public void Get_has_route_and_query_params_with_correct_binding()
    {
        var ep = Get(Analyze(), "GET", "/api/Pets/{id}");

        var id = ep.Params.Single(p => p.Name == "id");
        Assert.Equal("route", id.In);
        Assert.True(id.Required);
        Assert.Equal("integer", id.Schema["type"]!.GetValue<string>());

        var expand = ep.Params.Single(p => p.Name == "expand");
        Assert.Equal("query", expand.In);
        Assert.False(expand.Required); // string? + no [Required]
        Assert.Equal("string", expand.Schema["type"]!.GetValue<string>());
        Assert.True(expand.Schema["nullable"]!.GetValue<bool>());
    }

    [Fact]
    public void Get_has_declared_responses()
    {
        var ep = Get(Analyze(), "GET", "/api/Pets/{id}");
        Assert.Equal(new[] { 200, 404 }, ep.Responses.Select(r => r.Status).ToArray());
        Assert.NotNull(ep.Responses.Single(r => r.Status == 200).Schema);
    }

    [Fact]
    public void Get_is_authorized_with_bearer_summary_extracted()
    {
        var ep = Get(Analyze(), "GET", "/api/Pets/{id}");
        Assert.True(ep.Auth.Required);
        Assert.Equal("bearer", ep.Auth.Schemes.Single().Type);
        Assert.Equal("Get a pet by id.", ep.Summary);
    }

    [Fact]
    public void Post_has_request_body_and_allow_anonymous_overrides_auth()
    {
        var ep = Get(Analyze(), "POST", "/api/Pets");
        Assert.NotNull(ep.RequestBody);
        Assert.Equal("application/json", ep.RequestBody!.ContentType);
        Assert.True(ep.RequestBody.Required);
        Assert.Equal("object", ep.RequestBody.Schema["type"]!.GetValue<string>());
        Assert.False(ep.Auth.Required); // [AllowAnonymous] beats class [Authorize]
    }

    [Fact]
    public void Dto_schema_maps_validation_attributes_and_enum()
    {
        var ep = Get(Analyze(), "POST", "/api/Pets");
        var props = ep.RequestBody!.Schema["properties"]!.AsObject();

        Assert.Equal("string", props["name"]!["type"]!.GetValue<string>());
        Assert.Equal(50, props["name"]!["maxLength"]!.GetValue<int>());
        Assert.Equal(1, props["name"]!["minLength"]!.GetValue<int>());

        Assert.Equal("integer", props["age"]!["type"]!.GetValue<string>());
        Assert.Equal(0, props["age"]!["minimum"]!.GetValue<double>());
        Assert.Equal(30, props["age"]!["maximum"]!.GetValue<double>());

        var kindEnum = props["kind"]!["enum"]!.AsArray().Select(n => n!.GetValue<string>()).ToArray();
        Assert.Equal(new[] { "Dog", "Cat" }, kindEnum);

        var required = ep.RequestBody.Schema["required"]!.AsArray().Select(n => n!.GetValue<string>()).ToArray();
        Assert.Contains("name", required);
    }

    [Fact]
    public void Post_without_produces_infers_201()
    {
        // Create declares no [ProducesResponseType] -> POST convention is 201.
        var ep = Get(Analyze(), "POST", "/api/Pets");
        Assert.Contains(201, ep.Responses.Select(r => r.Status));
    }

    [Fact]
    public void Output_is_deterministic()
    {
        Assert.Equal(IrJson.Serialize(Analyze()), IrJson.Serialize(Analyze()));
    }
}
