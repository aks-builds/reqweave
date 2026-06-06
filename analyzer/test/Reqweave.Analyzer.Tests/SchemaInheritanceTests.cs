using System.Linq;
using Reqweave.Analyzer;
using Xunit;

namespace Reqweave.Analyzer.Tests;

public class SchemaInheritanceTests
{
    private const string Source = """
        using System.ComponentModel.DataAnnotations;
        using Microsoft.AspNetCore.Mvc;

        namespace Demo;

        public class BaseEntity
        {
            [Required]
            public int Id { get; set; }

            public string? Note { get; set; }
        }

        public class Animal : BaseEntity
        {
            [Required]
            public string Name { get; set; } = "";
        }

        public record Point(int X, int Y);

        [ApiController]
        [Route("api/[controller]")]
        public class ZooController : ControllerBase
        {
            [HttpPost]
            public ActionResult Create([FromBody] Animal a) => Ok();

            [HttpPut("loc")]
            public ActionResult SetLoc([FromBody] Point p) => Ok();
        }
        """;

    private static Ir Analyze()
    {
        var dir = System.IO.Directory.CreateTempSubdirectory("reqweave-inh");
        try
        {
            System.IO.File.WriteAllText(System.IO.Path.Combine(dir.FullName, "Zoo.cs"), Source);
            return Program.Analyze(dir.FullName, "Zoo", "2026-06-06T00:00:00Z");
        }
        finally
        {
            dir.Delete(recursive: true);
        }
    }

    private static Endpoint Get(Ir ir, string method, string route) =>
        ir.Endpoints.Single(e => e.Method == method && e.RouteTemplate == route);

    [Fact]
    public void Body_includes_inherited_base_properties_and_required()
    {
        var ep = Get(Analyze(), "POST", "/api/Zoo");
        var props = ep.RequestBody!.Schema["properties"]!.AsObject();
        Assert.True(props.ContainsKey("name")); // declared on Animal
        Assert.True(props.ContainsKey("id")); // inherited from BaseEntity
        Assert.True(props.ContainsKey("note")); // inherited optional

        var required = ep.RequestBody.Schema["required"]!.AsArray().Select(n => n!.GetValue<string>()).ToArray();
        Assert.Contains("name", required);
        Assert.Contains("id", required); // inherited [Required] merged
    }

    [Fact]
    public void Record_positional_parameters_become_properties()
    {
        var ep = Get(Analyze(), "PUT", "/api/Zoo/loc");
        var props = ep.RequestBody!.Schema["properties"]!.AsObject();
        Assert.True(props.ContainsKey("x"));
        Assert.True(props.ContainsKey("y"));
        Assert.Equal("integer", props["x"]!["type"]!.GetValue<string>());
    }
}
