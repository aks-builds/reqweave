// Fixture: a Spring Boot controller + DTOs. Read syntactically by reqweave;
// never compiled or run. (Imports are illustrative.)
package com.example.petstore;

import org.springframework.web.bind.annotation.*;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import jakarta.validation.constraints.NotNull;
import java.util.List;

enum PetStatus {
    AVAILABLE,
    PENDING,
    SOLD
}

record Pet(Long id, String name, PetStatus status, List<String> tags) {}

class CreatePet {
    @NotNull
    private String name;
    private PetStatus status;
    private Double weightKg;
}

@RestController
@RequestMapping("/pets")
class PetController {

    @GetMapping("/{id}")
    public Pet getById(@PathVariable Long id, @RequestParam(required = false) String expand) {
        return null;
    }

    @GetMapping
    public List<Pet> list(@RequestParam(required = false) String status, @RequestParam int limit) {
        return List.of();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasRole('ADMIN')")
    public Pet create(@RequestBody CreatePet body) {
        return null;
    }
}
