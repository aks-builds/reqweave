# Fixture: a FastAPI app. Read syntactically by reqweave; never imported or run.
from fastapi import FastAPI, APIRouter, Query, Body, Depends, Security
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from enum import Enum
from typing import Optional, List

app = FastAPI()
router = APIRouter()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


class PetStatus(str, Enum):
    available = "available"
    pending = "pending"
    sold = "sold"


class Pet(BaseModel):
    id: int
    name: str
    status: PetStatus
    tags: Optional[List[str]] = None


class CreatePet(BaseModel):
    name: str
    status: PetStatus
    weight_kg: Optional[float] = None


@app.get("/pets/{pet_id}", response_model=Pet)
def get_pet(pet_id: int, expand: Optional[str] = Query(None)):
    return None


@router.get("/pets", response_model=List[Pet])
def list_pets(status: Optional[str] = None, limit: int = 20):
    return []


@app.post("/pets", status_code=201, response_model=Pet, tags=["pets"])
def create_pet(body: CreatePet, user=Depends(oauth2_scheme)):
    return None
