using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Reqweave.Analyzer;

// C# mirror of the reqweave Universal IR (see src/ir/schema.ts). Serializes to
// the exact JSON shape the TS core validates. Optional fields are omitted when
// null. Schema nodes are JsonNode so they can carry any JSON-Schema-ish shape.

public sealed record ServiceInfo(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("basePaths")] IReadOnlyList<string> BasePaths,
    [property: JsonPropertyName("versions")] IReadOnlyList<string>? Versions = null,
    [property: JsonPropertyName("servers")] IReadOnlyList<string>? Servers = null);

public sealed record Param(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("in")] string In,
    [property: JsonPropertyName("required")] bool Required,
    [property: JsonPropertyName("schema")] JsonNode Schema,
    [property: JsonPropertyName("description")] string? Description = null);

public sealed record RequestBody(
    [property: JsonPropertyName("required")] bool Required,
    [property: JsonPropertyName("contentType")] string ContentType,
    [property: JsonPropertyName("schema")] JsonNode Schema);

public sealed record ApiResponse(
    [property: JsonPropertyName("status")] int Status,
    [property: JsonPropertyName("description")] string? Description = null,
    [property: JsonPropertyName("contentType")] string? ContentType = null,
    [property: JsonPropertyName("schema")] JsonNode? Schema = null);

public sealed record AuthScheme(
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("location")] string? Location = null,
    [property: JsonPropertyName("name")] string? Name = null,
    [property: JsonPropertyName("scopes")] IReadOnlyList<string>? Scopes = null);

public sealed record Auth(
    [property: JsonPropertyName("required")] bool Required,
    [property: JsonPropertyName("schemes")] IReadOnlyList<AuthScheme> Schemes);

public sealed record Endpoint(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("method")] string Method,
    [property: JsonPropertyName("routeTemplate")] string RouteTemplate,
    [property: JsonPropertyName("params")] IReadOnlyList<Param> Params,
    [property: JsonPropertyName("responses")] IReadOnlyList<ApiResponse> Responses,
    [property: JsonPropertyName("auth")] Auth Auth,
    [property: JsonPropertyName("operationId")] string? OperationId = null,
    [property: JsonPropertyName("summary")] string? Summary = null,
    [property: JsonPropertyName("tags")] IReadOnlyList<string>? Tags = null,
    [property: JsonPropertyName("deprecated")] bool? Deprecated = null,
    [property: JsonPropertyName("requestBody")] RequestBody? RequestBody = null);

public sealed record Diagnostic(
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("severity")] string Severity,
    [property: JsonPropertyName("endpointId")] string? EndpointId = null);

public sealed record Meta(
    [property: JsonPropertyName("analyzerVersion")] string AnalyzerVersion,
    [property: JsonPropertyName("mode")] string Mode,
    [property: JsonPropertyName("generatedAt")] string GeneratedAt,
    [property: JsonPropertyName("sourceCommit")] string? SourceCommit = null);

public sealed record Ir(
    [property: JsonPropertyName("irVersion")] string IrVersion,
    [property: JsonPropertyName("service")] ServiceInfo Service,
    [property: JsonPropertyName("endpoints")] IReadOnlyList<Endpoint> Endpoints,
    [property: JsonPropertyName("diagnostics")] IReadOnlyList<Diagnostic> Diagnostics,
    [property: JsonPropertyName("meta")] Meta Meta);

public static class IrJson
{
    private static readonly JsonSerializerOptions Pretty = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = true,
    };

    private static readonly JsonSerializerOptions Compact = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false,
    };

    public static string Serialize(Ir ir, bool pretty = true) =>
        JsonSerializer.Serialize(ir, pretty ? Pretty : Compact);
}
