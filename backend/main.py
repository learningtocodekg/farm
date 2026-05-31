import json
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

FLIGHT_PATH_FILE = Path(__file__).parent.parent / "frontend" / "public" / "flight-path.json"


class CameraConfig(BaseModel):
    position: list[float]
    quaternion: list[float]
    fov: float


class FlightLineConfig(BaseModel):
    start: list[float]
    end: list[float]
    y: float


class CropOffsets(BaseModel):
    leftOffset: float   # perpendicular distance from flight line to left crop row
    rightOffset: float  # perpendicular distance from flight line to right crop row

class FlightPathConfig(BaseModel):
    leftCamera: CameraConfig
    rightCamera: CameraConfig
    flightLine: FlightLineConfig
    crops: CropOffsets
    frameWidth: float


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/save-flight-path")
def save_flight_path(config: FlightPathConfig):
    try:
        FLIGHT_PATH_FILE.parent.mkdir(parents=True, exist_ok=True)
        FLIGHT_PATH_FILE.write_text(json.dumps(config.model_dump(), indent=2))
        return {"status": "saved", "path": str(FLIGHT_PATH_FILE)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
