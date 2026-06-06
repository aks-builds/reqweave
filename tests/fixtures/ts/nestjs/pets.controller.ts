// Fixture: a NestJS controller + DTOs. Parsed syntactically by the TS analyzer;
// never compiled or executed. (Imports/types are illustrative.)
import { Controller, Get, Post, Param, Query, Body, HttpCode } from "@nestjs/common";
import { ApiBearerAuth } from "@nestjs/swagger";

export enum PetStatus {
  Available = "available",
  Pending = "pending",
  Sold = "sold",
}

export interface Pet {
  id: number;
  name: string;
  status: PetStatus;
  tags?: string[];
}

export class CreatePetDto {
  name!: string;
  status!: PetStatus;
  weightKg?: number;
}

@Controller("pets")
@ApiBearerAuth()
export class PetsController {
  @Get(":id")
  getById(@Param("id") id: number): Promise<Pet> {
    return null as unknown as Promise<Pet>;
  }

  @Get()
  list(@Query("status") status: string, @Query("limit") limit: number): Pet[] {
    return [];
  }

  @Post()
  @HttpCode(201)
  create(@Body() dto: CreatePetDto): Pet {
    return null as unknown as Pet;
  }
}
