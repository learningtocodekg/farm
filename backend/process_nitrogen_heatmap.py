"""
Nitrogen heatmap → black-and-white crop row mask.

Pipeline:
  1. HSV saturation threshold  → binary mask (heatmap pixels vs. soil)
  2. Morphological close + open → fill gaps, remove noise
  3. Connected components       → isolate the 5 main crop-row blobs
  4. Scanline edge extraction   → organic left/right contour per row
  5. White fill + black outline → final BW image
  6. Labels                     → "Crop Row N" centred at each blob
  7. Save full image + rows-2-and-3 crop
"""

import pathlib
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw

# ── paths ─────────────────────────────────────────────────────────────────────
HERE        = pathlib.Path(__file__).parent
ASSETS      = HERE.parent / "frontend" / "src" / "assets" / "images"
INPUT_PATH  = ASSETS / "nitrogen-heatmapp.jpeg"
OUT_FULL    = ASSETS / "nitrogen-heatmap-clean.png"
OUT_CROP    = ASSETS / "nitrogen-heatmap-clean copy.png"

# ── 1. Load and convert to HSV ─────────────────────────────────────────────
bgr = cv2.imread(str(INPUT_PATH))
if bgr is None:
    sys.exit(f"Could not load {INPUT_PATH}")

hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
S   = hsv[:, :, 1]

# Saturation > 130 → heatmap pixel (vivid colour), else soil (dull)
_, mask = cv2.threshold(S, 130, 255, cv2.THRESH_BINARY)

# ── 2. Morphological cleanup ───────────────────────────────────────────────
close_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
open_k  = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, close_k)
mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN,  open_k)

# ── 3. Connected components — keep blobs ≥ 0.8% of image area ────────────
H, W    = mask.shape
min_area = int(0.008 * H * W)

num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)

valid = []
for lbl in range(1, num_labels):           # skip background (0)
    area = stats[lbl, cv2.CC_STAT_AREA]
    if area >= min_area:
        valid.append(lbl)

# Sort left-to-right by centroid x
valid.sort(key=lambda lbl: centroids[lbl][0])
print(f"Found {len(valid)} crop rows after filtering")

# ── 4 + 5. Build output image: white fill, black scanline outlines ─────────
out_pil  = Image.new("RGB", (W, H), color=(255, 255, 255))
draw     = ImageDraw.Draw(out_pil)

row_data = []   # (centroid_xy, rank) for labels

for rank, lbl in enumerate(valid, start=1):
    row_mask = (labels == lbl).astype(np.uint8)

    # Scanline min/max x per y
    left_pts  = []
    right_pts = []
    for y in range(H):
        xs = np.where(row_mask[y])[0]
        if len(xs) == 0:
            continue
        left_pts.append( (int(xs.min()), y) )
        right_pts.append((int(xs.max()), y) )

    if not left_pts:
        continue

    # Fill interior white (already white bg, but draw filled polygon to be safe)
    fill_pts = left_pts + list(reversed(right_pts))
    if len(fill_pts) >= 3:
        draw.polygon(fill_pts, fill=(255, 255, 255))

    # Black outline — left edge top→bottom, right edge bottom→top
    if len(left_pts) >= 2:
        draw.line(left_pts,  fill=(0, 0, 0), width=4)
    if len(right_pts) >= 2:
        draw.line(right_pts, fill=(0, 0, 0), width=4)

    cx, cy = centroids[lbl]
    row_data.append((int(cx), int(cy), rank))

# ── 6. Save full + rows-2-and-3 crop ─────────────────────────────────────
out_pil.save(str(OUT_FULL))
print(f"Saved full image: {OUT_FULL}")

if len(row_data) >= 3:
    # Rows are 1-indexed; grab rows 2 and 3 (index 1 and 2 in row_data)
    r2_cx, r2_cy, _ = row_data[1]
    r3_cx, r3_cy, _ = row_data[2]
    pad = H // 8
    y_top    = max(0, min(r2_cy, r3_cy) - pad)
    y_bottom = min(H, max(r2_cy, r3_cy) + pad)
    x_left   = max(0, min(r2_cx, r3_cx) - pad * 2)
    x_right  = min(W, max(r2_cx, r3_cx) + pad * 2)
    cropped  = out_pil.crop((x_left, y_top, x_right, y_bottom))
    cropped.save(str(OUT_CROP))
    print(f"Saved rows-2-and-3 crop: {OUT_CROP}")
else:
    # Fewer than 3 rows detected — save full image as the crop too
    out_pil.save(str(OUT_CROP))
    print(f"Fewer than 3 rows found; saved full image as crop: {OUT_CROP}")

print("Done.")
