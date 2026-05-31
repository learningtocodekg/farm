import base64
import json
from pathlib import Path
from typing import Any, Optional

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv

from agents.farm_agent import router as agent_router
from agents.farm_ops_agent import router as ops_router
from agents.farm_robot_agent import router as robot_router
from gemini_logic import router as gemini_router
from heatmap_pipeline import process_topdown

load_dotenv()

app = FastAPI(title="Farm Analysis API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_methods=["*"],
    allow_headers=["*"],
)

FLIGHT_PATH_FILE  = Path(__file__).parent.parent / "frontend" / "public" / "flight-path.json"
FRONTEND_PUBLIC   = Path(__file__).parent.parent / "frontend" / "public"
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


def _prune_ply(src: Path, dst: Path, min_opacity: float = 0.05, max_scale: float = 2.0) -> dict:
    from plyfile import PlyData, PlyElement
    ply   = PlyData.read(str(src))
    verts = ply["vertex"].data
    total = len(verts)

    opacity = 1.0 / (1.0 + np.exp(-np.clip(verts["opacity"].astype(np.float32), -20, 20)))
    mask = opacity >= min_opacity

    s = np.maximum(np.maximum(
        np.exp(verts["scale_0"].astype(np.float32)),
        np.exp(verts["scale_1"].astype(np.float32))),
        np.exp(verts["scale_2"].astype(np.float32)))
    mask &= s <= max_scale

    filtered = verts[mask]
    PlyData([PlyElement.describe(filtered, "vertex")], text=False).write(str(dst))
    return {"kept": int(mask.sum()), "total": total}


class TopDownPayload(BaseModel):
    image: str  # base64 data URL from canvas.toDataURL()


@app.post("/api/cleanup-splat")
def cleanup_splat_endpoint(
    min_opacity: float = 0.05,
    max_scale: float   = 2.0,
):
    scene_src = FRONTEND_PUBLIC / "scene.ply"
    scene_dst = FRONTEND_PUBLIC / "scene_clean.ply"
    if not scene_src.exists():
        raise HTTPException(status_code=404, detail="scene.ply not found in public folder")
    try:
        stats = _prune_ply(scene_src, scene_dst, min_opacity, max_scale)
        return {**stats, "scene": "/scene_clean.ply"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/process-topdown")
def process_topdown_view(payload: TopDownPayload):
    try:
        raw = payload.image
        if "," in raw:
            raw = raw.split(",", 1)[1]
        arr = np.frombuffer(base64.b64decode(raw), np.uint8)
        bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if bgr is None:
            raise HTTPException(status_code=400, detail="Could not decode image")

        result_bgr, meta = process_topdown(bgr)

        out_path = FRONTEND_PUBLIC / "nitrogen-focal.png"
        FRONTEND_PUBLIC.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(out_path), result_bgr)

        return {"url": "/nitrogen-focal.png", "meta": meta}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# StaticFiles must come after all route definitions
app.mount("/frames", StaticFiles(directory=FRAMES_DIR), name="frames")
