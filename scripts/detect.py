"""
Two-step weed detection pipeline.

  Step 1: Full image -> Gemini -> bounding boxes of brown soil regions
  Step 2: Each soil crop -> Gemini -> bounding boxes of weeds within that crop
  Step 3: Map weed pixel coords back to full image -> 3D world positions

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
# Saturation boost
# ---------------------------------------------------------------------------
SAT_SCALE = 1.8

def saturate(img_bgr: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[:, :, 1] = np.clip(hsv[:, :, 1] * SAT_SCALE, 0, 255)
    return cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)


# ---------------------------------------------------------------------------
# Step 1 prompt — find brown soil regions
# ---------------------------------------------------------------------------
SOIL_PROMPT = """\
You are analysing a drone image of a vineyard.
Identify every distinct region of bare brown soil visible in the image.
These are the tilled strips directly under the vine rows — brown/tan/earthy coloured,
NOT the green grass patches between rows and NOT the vine plants themselves.

Return ONLY a JSON object with one key "soil" mapping to an array of bounding boxes.
Bounding box schema: {{"x1": int, "y1": int, "x2": int, "y2": int}} (absolute pixels, top-left to bottom-right).
Image dimensions: {width}x{height} pixels.

Example:
{{
  "soil": [{{"x1": 10, "y1": 50, "x2": 300, "y2": 620}}]
}}

Return ONLY the raw JSON object, no markdown fences, no explanation.
"""

# ---------------------------------------------------------------------------
# Step 2 prompt — find weeds inside a soil crop
# ---------------------------------------------------------------------------
WEED_PROMPT = """\
You are analysing a cropped image showing mostly brown soil from a vineyard drone photo.
Look carefully for any weeds: plants growing in the brown soil that are NOT the vine plant and are not grass or surrounded by grass.
A weed will appear as green/leafy growth sitting on the brown soil. It should be surrounded by brown, not yellow or green.

Rules:
- Only mark clearly visible, sizeable plant structures (leaves, stems, rosettes).
- Do NOT mark bare soil, soil texture variations, or tiny specks.
- Do NOT mark vine trunks or vine leaves that enter the frame from the top.

Return ONLY a JSON object with one key "weed" mapping to an array of bounding boxes (may be empty []).
Bounding box schema: {{"x1": int, "y1": int, "x2": int, "y2": int}} (absolute pixels within this crop).
Crop dimensions: {width}x{height} pixels.

Example:
{{
  "weed": [{{"x1": 40, "y1": 80, "x2": 120, "y2": 160}}]
}}

Return ONLY the raw JSON object, no markdown fences, no explanation.
"""

# ---------------------------------------------------------------------------
# Gemini helper
# ---------------------------------------------------------------------------
def call_gemini(client, pil_img: Image.Image, prompt: str) -> dict:
    response = client.models.generate_content(
        model="gemini-3-flash-preview",
        contents=[
            types.Part.from_text(text=prompt),
            pil_img,
        ],
    )
    raw = response.text.strip()
    raw = re.sub(r"^```[a-z]*\n?", "", raw)
    raw = re.sub(r"\n?```$", "", raw)
    return json.loads(raw)


def bgr_to_pil(img_bgr: np.ndarray) -> Image.Image:
    return Image.fromarray(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))


# ---------------------------------------------------------------------------
# 3-D unprojection
# ---------------------------------------------------------------------------
def unproject_pixel(px: float, py: float, img_w: int, img_h: int, entry: dict) -> list[float]:
    cam_pos = entry["position"]
    quat    = entry["quaternion"]
    fov_deg = entry["fov"]
    aspect  = entry["aspect"]

    qx, qy, qz, qw = quat
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

    forward = rot([0, 0, -1])
    right   = rot([1, 0,  0])
    up      = rot([0, 1,  0])

    ndc_x = (px / img_w) * 2 - 1
    ndc_y = 1 - (py / img_h) * 2

    half_h = math.tan(math.radians(fov_deg / 2))
    half_w = half_h * aspect

    ray_dir = [
        forward[0] + ndc_x * half_w * right[0] + ndc_y * half_h * up[0],
        forward[1] + ndc_x * half_w * right[1] + ndc_y * half_h * up[1],
        forward[2] + ndc_x * half_w * right[2] + ndc_y * half_h * up[2],
    ]

    mag = math.sqrt(sum(v**2 for v in ray_dir)) or 1.0
    ray_dir = [v / mag for v in ray_dir]

    # Intersect with the horizontal ground plane at Y = cam_pos.Y.
    # The camera looks nearly horizontally at the soil, so the vertical crop-row
    # plane intersection gives bad Y values. The soil surface is at the same Y
    # as the camera position for each pass (left Y ≈ -1.618, right Y ≈ -1.084).
    ground_y = cam_pos[1]
    # Plane: Y = ground_y  ->  normal = (0,1,0), d = ground_y
    # t = (ground_y - cam_y) / ray_dir_y
    if abs(ray_dir[1]) < 1e-9:
        # Ray is nearly horizontal — fall back to cropPlane intersection
        plane = entry["cropPlane"]
        n = plane["normal"]
        d = plane["d"]
        denom = sum(n[i] * ray_dir[i] for i in range(3))
        if abs(denom) < 1e-9:
            return cam_pos
        t = (d - sum(n[i] * cam_pos[i] for i in range(3))) / denom
    else:
        t = (ground_y - cam_pos[1]) / ray_dir[1]

    if t < 0:
        # Ray goes away from ground — flip to the cropPlane fallback
        plane = entry["cropPlane"]
        n = plane["normal"]
        d = plane["d"]
        denom = sum(n[i] * ray_dir[i] for i in range(3))
        if abs(denom) < 1e-9:
            return cam_pos
        t = (d - sum(n[i] * cam_pos[i] for i in range(3))) / denom

    return [cam_pos[i] + t * ray_dir[i] for i in range(3)]


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


def normalize_box(box: dict) -> dict:
    """Accept x1/y1/x2/y2 or xmin/ymin/xmax/ymax or left/top/right/bottom."""
    def pick(*keys):
        for k in keys:
            if k in box:
                return int(box[k])
        raise KeyError(f"No matching key in {list(box.keys())} for {keys}")
    return {
        "x1": pick("x1", "xmin", "left"),
        "y1": pick("y1", "ymin", "top"),
        "x2": pick("x2", "xmax", "right"),
        "y2": pick("y2", "ymax", "bottom"),
    }


def clamp_box(box: dict, img_w: int, img_h: int) -> dict:
    box = normalize_box(box)
    return {
        "x1": max(0, min(box["x1"], img_w - 1)),
        "y1": max(0, min(box["y1"], img_h - 1)),
        "x2": max(0, min(box["x2"], img_w)),
        "y2": max(0, min(box["y2"], img_h)),
    }


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

    print(f"Two-step weed detection on {len(frames)} frame(s)...\n")

    for i, entry in enumerate(frames):
        frame_path = MANIFEST_PATH.parent / entry["frame"]
        if not frame_path.exists():
            print(f"  [{i+1}/{len(frames)}] SKIP (missing): {entry['frame']}")
            continue

        print(f"  [{i+1}/{len(frames)}] {entry['frame']}")

        img_bgr = cv2.imread(str(frame_path))
        if img_bgr is None:
            print("    SKIP (unreadable)")
            continue

        enhanced_bgr = saturate(img_bgr)
        img_h, img_w = enhanced_bgr.shape[:2]

        cv2.imwrite(str(PROCESSED_DIR / frame_path.name), enhanced_bgr)

        # ------------------------------------------------------------------
        # Step 1: Find soil regions
        # ------------------------------------------------------------------
        print(f"    Step 1: finding soil regions ...", end="", flush=True)
        try:
            soil_parsed = call_gemini(
                client,
                bgr_to_pil(enhanced_bgr),
                SOIL_PROMPT.format(width=img_w, height=img_h),
            )
            soil_boxes = soil_parsed.get("soil", [])
            if not isinstance(soil_boxes, list):
                soil_boxes = []
        except Exception as e:
            print(f" ERROR: {e}")
            continue

        print(f" found {len(soil_boxes)} soil region(s)")

        if not soil_boxes:
            print("    No soil detected, skipping frame.")
            continue

        # ------------------------------------------------------------------
        # Step 2: Find weeds inside each soil crop
        # ------------------------------------------------------------------
        frame_weeds = 0
        for si, sbox in enumerate(soil_boxes):
            sbox = clamp_box(sbox, img_w, img_h)
            crop_w = sbox["x2"] - sbox["x1"]
            crop_h = sbox["y2"] - sbox["y1"]

            if crop_w < 10 or crop_h < 10:
                continue

            crop_bgr = enhanced_bgr[sbox["y1"]:sbox["y2"], sbox["x1"]:sbox["x2"]]

            print(f"    Step 2 soil[{si}] ({crop_w}x{crop_h}px) ... ", end="", flush=True)
            try:
                weed_parsed = call_gemini(
                    client,
                    bgr_to_pil(crop_bgr),
                    WEED_PROMPT.format(width=crop_w, height=crop_h),
                )
                weed_boxes = weed_parsed.get("weed", [])
                if not isinstance(weed_boxes, list):
                    weed_boxes = []
            except Exception as e:
                print(f" ERROR: {e}")
                continue

            print(f"{len(weed_boxes)} weed(s)")

            for wbox in weed_boxes:
                wbox = normalize_box(wbox)
                # Translate crop-local coords back to full-image coords
                full_x1 = sbox["x1"] + wbox["x1"]
                full_y1 = sbox["y1"] + wbox["y1"]
                full_x2 = sbox["x1"] + wbox["x2"]
                full_y2 = sbox["y1"] + wbox["y2"]

                cx = (full_x1 + full_x2) / 2
                cy = (full_y1 + full_y2) / 2
                world_pos = unproject_pixel(cx, cy, img_w, img_h, entry)

                full_box = {"x1": full_x1, "y1": full_y1, "x2": full_x2, "y2": full_y2}
                all_anomalies.append({
                    "id":        f"a{anomaly_id}",
                    "type":      "weed",
                    "position":  world_pos,
                    "frame":     entry["frame"],
                    "bbox_px":   full_box,
                    "bbox_norm": {
                        "x1": full_x1 / img_w,
                        "y1": full_y1 / img_h,
                        "x2": full_x2 / img_w,
                        "y2": full_y2 / img_h,
                    },
                    "soil_bbox_px": sbox,
                })
                anomaly_id += 1
                frame_weeds += 1

        print(f"    => {frame_weeds} weed(s) detected in frame\n")

    ANOMALIES_OUT.parent.mkdir(parents=True, exist_ok=True)
    ANOMALIES_OUT.write_text(json.dumps(all_anomalies, indent=2))

    print(f"Done. {len(all_anomalies)} total weeds found.")
    print(f"Written to: {ANOMALIES_OUT}")
    print("Refresh the browser to see markers.")


if __name__ == "__main__":
    main()
