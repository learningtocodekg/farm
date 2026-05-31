"""
Weed detection pipeline.
Reads scripts/frames/manifest.json, sends each frame to Gemini Flash,
converts bounding boxes to 3D world positions, writes frontend/public/weeds.json.

Run: python scripts/analyze.py
Requires: GEMINI_API_KEY environment variable
          pip install google-generativeai Pillow
"""

import json
import os
import sys
from pathlib import Path

import google.generativeai as genai
from PIL import Image

SCRIPT_DIR = Path(__file__).parent
MANIFEST_PATH = SCRIPT_DIR / "frames" / "manifest.json"
WEEDS_OUT = SCRIPT_DIR.parent / "frontend" / "public" / "weeds.json"

PROMPT = (
    "You are a precision agriculture AI analyzing a farm image for weed detection. "
    "Identify any weeds visible between or alongside the crop rows. "
    "Return ONLY a JSON array of bounding boxes for weeds you detect. "
    "Each box must use this schema: {\"x1\": float, \"y1\": float, \"x2\": float, \"y2\": float} "
    "where values are fractions of image width/height in range 0.0 to 1.0. "
    "x1,y1 is the top-left corner, x2,y2 is the bottom-right corner. "
    "If no weeds are detected return an empty array []. "
    "Return only the raw JSON array, no markdown, no explanation."
)


def boxes_to_world(boxes, frame_pos, frame_width, aspect_ratio, crop_offset, flight_line_dir):
    """
    Convert normalised bbox centres to 3D world positions.

    frame_pos       : [x, y, z] camera position for this frame
    frame_width     : world-space width of the captured frame
    aspect_ratio    : viewport height / width
    crop_offset     : perpendicular distance from flight line to this crop row
    flight_line_dir : unit vector [dx, dz] along the flight line (for along-row Z mapping)
    """
    frame_depth = frame_width * aspect_ratio  # world height of the frame along the row
    # Perpendicular direction to the flight line (pointing toward the crop)
    perp = [-flight_line_dir[1], flight_line_dir[0]]  # 90° rotation in XZ

    results = []
    for box in boxes:
        cx = (box["x1"] + box["x2"]) / 2
        cy = (box["y1"] + box["y2"]) / 2

        # Along-row offset (Z direction of the frame)
        along = (cy - 0.5) * frame_depth
        # Lateral offset within the visible swath
        lateral = (cx - 0.5) * frame_width

        wx = frame_pos[0] + along * flight_line_dir[0] + lateral * perp[0]
        wy = frame_pos[1]
        wz = frame_pos[2] + along * flight_line_dir[1] + lateral * perp[1]
        results.append([wx, wy, wz])
    return results


def main():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("ERROR: GEMINI_API_KEY environment variable not set.", file=sys.stderr)
        sys.exit(1)

    if not MANIFEST_PATH.exists():
        print(f"ERROR: manifest not found at {MANIFEST_PATH}. Run capture.js first.", file=sys.stderr)
        sys.exit(1)

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-2.0-flash")

    manifest = json.loads(MANIFEST_PATH.read_text())
    frame_width = manifest["frameWidth"]
    viewport = manifest.get("viewport", {"width": 1280, "height": 720})
    aspect_ratio = viewport["height"] / viewport["width"]
    frames = manifest["frames"]

    # Flight line direction unit vector [dx, dz]
    fl = manifest.get("flightLine", {})
    start, end = fl.get("start", [0, 0, 0]), fl.get("end", [0, 0, 0])
    dx, dz = end[0] - start[0], end[2] - start[2]
    length = (dx**2 + dz**2) ** 0.5 or 1.0
    flight_line_dir = [dx / length, dz / length]

    crops = manifest.get("crops", {"leftOffset": 0, "rightOffset": 0})

    all_weeds = []
    weed_id = 0

    print(f"Analyzing {len(frames)} frames with Gemini Flash…")

    for i, entry in enumerate(frames):
        frame_path = MANIFEST_PATH.parent / entry["frame"]
        frame_pos = entry["position"]  # [x, y, z]

        if not frame_path.exists():
            print(f"  [{i+1}/{len(frames)}] SKIP (file missing): {entry['frame']}")
            continue

        print(f"  [{i+1}/{len(frames)}] {entry['frame']} (pass={entry.get('pass','?')}) … ", end="", flush=True)

        img = Image.open(frame_path)

        try:
            response = model.generate_content([PROMPT, img])
            raw = response.text.strip()

            # Strip markdown code fences if present
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]

            boxes = json.loads(raw)
            if not isinstance(boxes, list):
                boxes = []

            crop_offset = crops["leftOffset"] if entry.get("pass") == "left" else crops["rightOffset"]
            world_positions = boxes_to_world(boxes, frame_pos, frame_width, aspect_ratio, crop_offset, flight_line_dir)
            print(f"{len(world_positions)} weed(s)")

            for pos in world_positions:
                all_weeds.append({"id": f"w{weed_id}", "position": pos})
                weed_id += 1

        except Exception as e:
            print(f"ERROR: {e}")

    WEEDS_OUT.parent.mkdir(parents=True, exist_ok=True)
    WEEDS_OUT.write_text(json.dumps(all_weeds, indent=2))

    print(f"\nDone. {len(all_weeds)} total weed markers.")
    print(f"Written to: {WEEDS_OUT}")
    print("Refresh the browser to see markers.")


if __name__ == "__main__":
    main()
