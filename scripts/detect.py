"""
Weed / dry-spot / pest detection pipeline.

  image -> saturation boost -> Gemini 2.5 Flash -> pixel bboxes -> 3D world positions
  -> frontend/public/anomalies.json

Run:
    backend\\venv\\Scripts\\python.exe scripts/detect.py
Requires GEMINI_API_KEY in backend/.env or as an env var.
"""

import json
import math
import os
import re
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from google import genai
from google.genai import types

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR    = Path(__file__).parent
MANIFEST_PATH = SCRIPT_DIR / "frames" / "manifest.json"
ANOMALIES_OUT = SCRIPT_DIR.parent / "frontend" / "public" / "anomalies.json"
PROCESSED_DIR = SCRIPT_DIR / "frames_processed"
PROCESSED_DIR.mkdir(exist_ok=True)

# ---------------------------------------------------------------------------
# Saturation boost (same as preprocess_preview.py)
# ---------------------------------------------------------------------------
SAT_SCALE = 1.8

def saturate(img_bgr: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[:, :, 1] = np.clip(hsv[:, :, 1] * SAT_SCALE, 0, 255)
    return cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)


GRID_STEP = 100  # pixel grid spacing

def draw_grid(img_bgr: np.ndarray) -> np.ndarray:
    """Overlay a semi-transparent pixel grid and axis labels so Gemini can read coordinates accurately."""
    out = img_bgr.copy()
    h, w = out.shape[:2]
    overlay = out.copy()

    # Grid lines every GRID_STEP pixels
    for x in range(0, w, GRID_STEP):
        cv2.line(overlay, (x, 0), (x, h), (255, 255, 255), 1)
    for y in range(0, h, GRID_STEP):
        cv2.line(overlay, (0, y), (w, y), (255, 255, 255), 1)

    # Blend grid at low opacity
    cv2.addWeighted(overlay, 0.18, out, 0.82, 0, out)

    # Axis tick labels
    font = cv2.FONT_HERSHEY_SIMPLEX
    for x in range(0, w, GRID_STEP):
        label = str(x)
        # shadow then white
        cv2.putText(out, label, (x + 2, 14), font, 0.35, (0, 0, 0), 2, cv2.LINE_AA)
        cv2.putText(out, label, (x + 2, 14), font, 0.35, (255, 255, 255), 1, cv2.LINE_AA)
    for y in range(GRID_STEP, h, GRID_STEP):
        label = str(y)
        cv2.putText(out, label, (2, y - 3), font, 0.35, (0, 0, 0), 2, cv2.LINE_AA)
        cv2.putText(out, label, (2, y - 3), font, 0.35, (255, 255, 255), 1, cv2.LINE_AA)

    return out

# ---------------------------------------------------------------------------
# Gemini prompt
# ---------------------------------------------------------------------------
PROMPT = """\
You are a precision agriculture AI analysing a vineyard image captured by a drone.
The scene contains: vine plants in rows, bare tilled soil between the rows, and grass/groundcover at the edges.

Identify anomalies in THREE categories. Be conservative — only mark something if you are highly confident.

  - weed     : unwanted plant growth AT GROUND LEVEL, in the brown soil.
               Weeds must be a VISIBLE PATCH of growth.
               Do NOT mark grass, individual tiny green specks or small blades — only mark clearly visible structures resembling a flowering plant.
               Do NOT mark bare tilled soil.

  - dry_spot : a large patch of YELLOWED, STRAW-COLOURED, or BROWN DYING grass/groundcover that is clearly
               different and surrounded by healthy green grass. This is NOT bare tilled soil —
               bare brown/grey soil is normal and should NOT be marked. Only mark patches where grass
               that should be green is clearly dying or dead.

  - pest     : highly confident evidence of pest or disease damage on vine leaves or stems ONLY.
               Look for: irregular holes chewed in leaves, dark fungal spots or mildew patches,
               unusual discolouration patterns, insect frass/droppings, or webbing.
               Do NOT mark blurry edges, shadows, or normal leaf variation.
               Only mark if damage is clearly visible and unambiguous. When in doubt, leave empty.

Return ONLY a JSON object with three keys. Each key maps to an array of bounding boxes (may be empty []).
Bounding box schema: {"x1": int, "y1": int, "x2": int, "y2": int}  (absolute pixels, top-left to bottom-right).
Image dimensions will be provided in the prompt.

Example:
{
  "weed":      [{"x1": 120, "y1": 340, "x2": 210, "y2": 410}],
  "dry_spot":  [],
  "pest":      []
}

Return ONLY the raw JSON object, no markdown fences, no explanation.
"""

# ---------------------------------------------------------------------------
# 3-D unprojection  (same geometry as analyze.py but per-frame crop plane)
# ---------------------------------------------------------------------------
def unproject_pixel(px: float, py: float, img_w: int, img_h: int, entry: dict) -> list[float]:
    """
    Cast a ray from the camera through pixel (px,py) and intersect with
    the frame's crop plane to get a world-space 3D position.
    """
    cam_pos = entry["position"]          # [x, y, z]
    quat    = entry["quaternion"]        # [x, y, z, w]
    fov_deg = entry["fov"]
    aspect  = entry["aspect"]
    plane   = entry["cropPlane"]         # {normal:[x,y,z], d:float}

    # Reconstruct camera forward/right/up from quaternion
    qx, qy, qz, qw = quat
    # Rotation matrix from quaternion
    def rot(v):
        x, y, z = v
        tx = 2*(qy*z - qz*y)
        ty = 2*(qz*x - qx*z)
        tz = 2*(qx*y - qy*x)
        return [
            x + qw*tx + qy*tz - qz*ty,
            y + qw*ty + qz*tx - qx*tz,
            z + qw*tz + qx*ty - qy*tx,
        ]

    # Camera looks down -Z in local space
    forward = rot([0, 0, -1])
    right   = rot([1, 0,  0])
    up      = rot([0, 1,  0])

    # NDC coords (-1..1)
    ndc_x = (px / img_w) * 2 - 1
    ndc_y = 1 - (py / img_h) * 2

    # Half-extents in view space
    half_h = math.tan(math.radians(fov_deg / 2))
    half_w = half_h * aspect

    # Ray direction in world space
    ray_dir = [
        forward[0] + ndc_x * half_w * right[0] + ndc_y * half_h * up[0],
        forward[1] + ndc_x * half_w * right[1] + ndc_y * half_h * up[1],
        forward[2] + ndc_x * half_w * right[2] + ndc_y * half_h * up[2],
    ]

    # Normalise
    mag = math.sqrt(sum(v**2 for v in ray_dir)) or 1.0
    ray_dir = [v / mag for v in ray_dir]

    # Intersect with crop plane: dot(normal, point) = d
    n = plane["normal"]
    d = plane["d"]
    denom = sum(n[i] * ray_dir[i] for i in range(3))
    if abs(denom) < 1e-9:
        # Ray parallel to plane — fall back to camera position
        return cam_pos

    t = (d - sum(n[i] * cam_pos[i] for i in range(3))) / denom
    world = [cam_pos[i] + t * ray_dir[i] for i in range(3)]
    return world


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def load_api_key() -> str:
    key = os.environ.get("GEMINI_API_KEY", "")
    if not key:
        env_file = SCRIPT_DIR.parent / "backend" / ".env"
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                line = line.strip().lstrip("export ")
                if line.startswith("GEMINI_API_KEY="):
                    key = line.split("=", 1)[1].strip()
    if not key:
        print("ERROR: GEMINI_API_KEY not set.", file=sys.stderr)
        sys.exit(1)
    return key


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--frame", help="Only process this frame filename, e.g. frame_left_0001.png")
    args = parser.parse_args()

    client = genai.Client(api_key=load_api_key())

    if not MANIFEST_PATH.exists():
        print(f"ERROR: manifest not found at {MANIFEST_PATH}", file=sys.stderr)
        sys.exit(1)

    manifest = json.loads(MANIFEST_PATH.read_text())
    frames   = manifest["frames"]
    if args.frame:
        frames = [e for e in frames if e["frame"] == args.frame]
        if not frames:
            print(f"ERROR: frame '{args.frame}' not found in manifest.", file=sys.stderr)
            sys.exit(1)

    all_anomalies = []
    anomaly_id = 0

    print(f"Detecting anomalies in {len(frames)} frame(s) with gemini-3-flash...\n")

    for i, entry in enumerate(frames):
        frame_path = MANIFEST_PATH.parent / entry["frame"]
        if not frame_path.exists():
            print(f"  [{i+1}/{len(frames)}] SKIP (missing): {entry['frame']}")
            continue

        print(f"  [{i+1}/{len(frames)}] {entry['frame']} ... ", end="", flush=True)

        # Load + saturate
        img_bgr = cv2.imread(str(frame_path))
        if img_bgr is None:
            print("SKIP (unreadable)")
            continue
        enhanced_bgr = saturate(img_bgr)
        gridded_bgr  = draw_grid(enhanced_bgr)
        img_h, img_w = gridded_bgr.shape[:2]

        # Save the processed image so review.html can show it
        cv2.imwrite(str(PROCESSED_DIR / frame_path.name), gridded_bgr)

        # Convert to PIL for Gemini
        gridded_rgb = cv2.cvtColor(gridded_bgr, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(gridded_rgb)

        prompt_with_dims = (
            f"Image size: {img_w}x{img_h} pixels (width x height).\n\n" + PROMPT
        )

        try:
            response = client.models.generate_content(
                model="gemini-3-flash-preview",
                contents=[
                    types.Part.from_text(text=prompt_with_dims),
                    pil_img,
                ],
            )
            raw = response.text.strip()

            # Strip markdown fences if Gemini adds them
            raw = re.sub(r"^```[a-z]*\n?", "", raw)
            raw = re.sub(r"\n?```$", "", raw)

            parsed = json.loads(raw)

            found = 0
            for anomaly_type in ("weed", "dry_spot", "pest"):
                boxes = parsed.get(anomaly_type, [])
                if not isinstance(boxes, list):
                    continue
                for box in boxes:
                    cx = (box["x1"] + box["x2"]) / 2
                    cy = (box["y1"] + box["y2"]) / 2
                    world_pos = unproject_pixel(cx, cy, img_w, img_h, entry)
                    all_anomalies.append({
                        "id":       f"a{anomaly_id}",
                        "type":     anomaly_type,
                        "position": world_pos,
                        "frame":    entry["frame"],
                        "bbox_px":  box,
                        "bbox_norm": {
                            "x1": box["x1"] / img_w,
                            "y1": box["y1"] / img_h,
                            "x2": box["x2"] / img_w,
                            "y2": box["y2"] / img_h,
                        },
                    })
                    anomaly_id += 1
                    found += 1

            print(f"{found} anomaly/anomalies")

        except Exception as e:
            print(f"ERROR: {e}")

    ANOMALIES_OUT.parent.mkdir(parents=True, exist_ok=True)
    ANOMALIES_OUT.write_text(json.dumps(all_anomalies, indent=2))

    counts = {}
    for a in all_anomalies:
        counts[a["type"]] = counts.get(a["type"], 0) + 1

    print(f"\nDone. {len(all_anomalies)} total anomalies: {counts}")
    print(f"Written to: {ANOMALIES_OUT}")
    print("Refresh the browser to see markers.")


if __name__ == "__main__":
    main()
