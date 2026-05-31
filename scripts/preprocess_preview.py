"""
One-time script: try multiple enhancement approaches on frames and save a
4-panel comparison so you can see which works best before wiring into analyze.py.

Output per frame: original | saturation | sharpen | sat+sharpen
Does NOT touch the originals.

Run:
    pip install opencv-python-headless numpy
    python scripts/preprocess_preview.py
"""

import json
from pathlib import Path

import cv2
import numpy as np

SCRIPT_DIR = Path(__file__).parent
FRAMES_DIR = SCRIPT_DIR / "frames"
OUT_DIR = SCRIPT_DIR / "frames_processed"
OUT_DIR.mkdir(exist_ok=True)

# --- Tunable knobs ---
SAT_SCALE = 1.8         # saturation multiplier in HSV (1.0 = no change, 2.0 = double)
CLAHE_CLIP = 3.0        # local contrast boost aggressiveness
CLAHE_TILE = (6, 6)
SHARPEN_AMOUNT = 1.5    # unsharp mask strength
SHARPEN_SIGMA = 1.5     # unsharp mask blur radius


def saturate(img: np.ndarray) -> np.ndarray:
    """Boost colour saturation without touching hue or brightness."""
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[:, :, 1] = np.clip(hsv[:, :, 1] * SAT_SCALE, 0, 255)
    return cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)


def sharpen(img: np.ndarray) -> np.ndarray:
    """CLAHE local contrast + unsharp mask to fight gaussian splat softness."""
    # CLAHE on L channel
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=CLAHE_CLIP, tileGridSize=CLAHE_TILE)
    l = clahe.apply(l)
    contrasted = cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)
    # Unsharp mask
    blur = cv2.GaussianBlur(contrasted, (0, 0), SHARPEN_SIGMA)
    return cv2.addWeighted(contrasted, 1.0 + SHARPEN_AMOUNT, blur, -SHARPEN_AMOUNT, 0)


def label(img: np.ndarray, text: str) -> np.ndarray:
    out = img.copy()
    cv2.putText(out, text, (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 3, cv2.LINE_AA)
    cv2.putText(out, text, (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 1, cv2.LINE_AA)
    return out


def process_frame(frame_path: Path) -> None:
    img = cv2.imread(str(frame_path))
    if img is None:
        print(f"  SKIP (unreadable): {frame_path.name}")
        return

    h, w = img.shape[:2]
    sat   = saturate(img)
    sharp = sharpen(img)
    both  = sharpen(saturate(img))

    stem = frame_path.stem
    cv2.imwrite(str(OUT_DIR / f"{stem}_1_original.png"),    img)
    cv2.imwrite(str(OUT_DIR / f"{stem}_2_saturation.png"),  sat)
    cv2.imwrite(str(OUT_DIR / f"{stem}_3_sharpen.png"),     sharp)
    cv2.imwrite(str(OUT_DIR / f"{stem}_4_sat_sharpen.png"), both)
    print(f"  {frame_path.name} -> 4 variants")


def main():
    manifest_path = FRAMES_DIR / "manifest.json"
    if not manifest_path.exists():
        frame_files = sorted(FRAMES_DIR.glob("*.png"))
    else:
        manifest = json.loads(manifest_path.read_text())
        frame_files = [FRAMES_DIR / e["frame"] for e in manifest["frames"]]

    print(f"Processing {len(frame_files)} frame(s) -> {OUT_DIR}/\n")
    for fp in frame_files:
        if not fp.exists():
            print(f"  SKIP (missing): {fp.name}")
            continue
        process_frame(fp)

    print(f"\nDone. 4-panel comparison images in {OUT_DIR}/")
    print("Knobs: SAT_SCALE, CLAHE_CLIP, SHARPEN_AMOUNT, SHARPEN_SIGMA")


if __name__ == "__main__":
    main()
