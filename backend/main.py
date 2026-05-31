import json
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from agents.farm_agent import router as agent_router
from agents.farm_ops_agent import router as ops_router
from agents.farm_robot_agent import router as robot_router
from gemini_logic import router as gemini_router

app = FastAPI(title="Farm Analysis API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

FLIGHT_PATH_FILE = Path(__file__).parent.parent / "frontend" / "public" / "flight-path.json"
FRAMES_DIR = Path(__file__).parent.parent / "scripts" / "frames"
MANIFEST_FILE = FRAMES_DIR / "manifest.json"
REVIEW_LOG_FILE = FRAMES_DIR / "review-log.json"


class CameraSnapshot(BaseModel):
    position: list[float]
    quaternion: list[float]
    fov: float


class SideFlightLine(BaseModel):
    start: list[float]
    end: list[float]


class CropPlane(BaseModel):
    normal: list[float]
    d: float


class SideConfig(BaseModel):
    flightLine: SideFlightLine
    cropPt: list[float]
    cropPlane: CropPlane
    flightDir: list[float]
    frameWidth: float


class Viewport(BaseModel):
    width: float
    height: float
    aspect: float


class FlightPathConfig(BaseModel):
    leftWaypoints:  list[CameraSnapshot]
    rightWaypoints: list[CameraSnapshot]
    left:  Optional[SideConfig]
    right: Optional[SideConfig]
    viewport: Viewport


app.include_router(agent_router, prefix="/api/agent")
app.include_router(ops_router, prefix="/api/ops-agent")
app.include_router(robot_router, prefix="/api/robot")
app.include_router(gemini_router, prefix="/api")


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


@app.get("/api/manifest")
def get_manifest():
    if not MANIFEST_FILE.exists():
        raise HTTPException(status_code=404, detail="manifest.json not found — run capture.js first")
    return json.loads(MANIFEST_FILE.read_text())


class FrameAdjustment(BaseModel):
    frame: str
    pass_: str
    position: list[float]
    baseCamera: dict[str, Any]
    deltas: dict[str, float]
    effectiveCamera: dict[str, Any]


class ReviewLog(BaseModel):
    savedAt: str
    frameCount: int
    adjustments: list[FrameAdjustment]


@app.post("/api/save-review-log")
def save_review_log(log: ReviewLog):
    try:
        REVIEW_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        data = log.model_dump()
        # rename pass_ back to pass for the output file
        for adj in data["adjustments"]:
            adj["pass"] = adj.pop("pass_")
        REVIEW_LOG_FILE.write_text(json.dumps(data, indent=2))
        return {"status": "saved", "path": str(REVIEW_LOG_FILE)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# StaticFiles must come after all route definitions
app.mount("/frames", StaticFiles(directory=FRAMES_DIR), name="frames")
