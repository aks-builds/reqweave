using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace PetApi;

public enum PetKind
{
    Dog,
    Cat,
    Bird,
}

public class PetDto
{
    [Required]
    [StringLength(50, MinimumLength = 1)]
    public string Name { get; set; } = string.Empty;

    [Range(0, 30)]
    public int Age { get; set; }

    public PetKind Kind { get; set; }

    public string? Nickname { get; set; }
}

/// <summary>CRUD for pets — used as the reqweave integration fixture.</summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class PetsController : ControllerBase
{
    /// <summary>List pets, optionally filtered by kind.</summary>
    [HttpGet]
    [AllowAnonymous]
    [ProducesResponseType(typeof(List<PetDto>), 200)]
    public ActionResult<List<PetDto>> List([FromQuery] PetKind? kind, [FromQuery] int? limit)
        => Ok(new List<PetDto>());

    /// <summary>Get a pet by id.</summary>
    [HttpGet("{id}")]
    [ProducesResponseType(typeof(PetDto), 200)]
    [ProducesResponseType(404)]
    public ActionResult<PetDto> GetById([Range(1, int.MaxValue)] int id)
        => Ok(new PetDto());

    /// <summary>Create a pet.</summary>
    [HttpPost]
    [ProducesResponseType(typeof(PetDto), 201)]
    [ProducesResponseType(400)]
    public ActionResult<PetDto> Create([FromBody] PetDto pet)
        => Created($"/api/pets/1", pet);

    /// <summary>Replace a pet.</summary>
    [HttpPut("{id}")]
    [ProducesResponseType(204)]
    [ProducesResponseType(400)]
    [ProducesResponseType(404)]
    public IActionResult Update(int id, [FromBody] PetDto pet)
        => NoContent();

    /// <summary>Delete a pet.</summary>
    [HttpDelete("{id}")]
    [ProducesResponseType(204)]
    [ProducesResponseType(404)]
    public IActionResult Delete(int id)
        => NoContent();
}
