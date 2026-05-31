"""
Image Cleanup — keeps only sharp/dense regions from a rendered Gaussian splat PNG.

Uses Laplacian variance in a sliding window to score sharpness per pixel.
Blurry edges get masked out; output is a cropped transparent PNG.

Usage:
    python cleanup_image.py render.png render_clean.png
    python cleanup_image.py render.png render_clean.png --window 64 --percentile 25 --feather 30

Install deps:
    pip install opencv-python numpy
"""

import argparse
import cv2
import numpy as np
from pathlib import Path


def sharpness_map(bgr: np.ndarray, window: int = 64) -> np.ndarray:
    """
    Compute per-pixel local sharpness via Laplacian variance in a sliding window.
    Higher value = sharper = denser splat region.
    """
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)

    lap = cv2.Laplacian(gray, cv2.CV_32F)
    lap_sq = lap * lap

    # E[X^2] and E[X] via box filter -> Var = E[X^2] - E[X]^2
    ksize = (window | 1, window | 1)           # ensure odd
    mean    = cv2.boxFilter(lap,    cv2.CV_32F, ksize)
    mean_sq = cv2.boxFilter(lap_sq, cv2.CV_32F, ksize)
    variance = np.maximum(mean_sq - mean * mean, 0.0)

    return variance


def cleanup(
    input_path: str,
    output_path: str,
    window: int      = 64,
    percentile: float = 25.0,
    feather: int     = 30,
) -> None:
    print(f"Loading {input_path} ...")
    img = cv2.imread(str(input_path), cv2.IMREAD_UNCHANGED)
    if img is None:
        raise FileNotFoundError(f"Cannot read {input_path}")

    bgr = img[:, :, :3]
    h, w = bgr.shape[:2]
    print(f"  Size: {w}x{h}")

    # --- sharpness map ----------------------------------------------------
    sharp = sharpness_map(bgr, window)

    # threshold at given percentile — bottom X% of pixels are considered blurry
    thresh = float(np.percentile(sharp, percentile))
    print(f"  Sharpness threshold (p{percentile}): {thresh:.2f}  "
          f"(range {sharp.min():.1f} – {sharp.max():.1f})")

    binary = (sharp >= thresh).astype(np.uint8) * 255

    # --- morphological cleanup -------------------------------------------
    # close holes, remove tiny islands
    k_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (window, window))
    k_open  = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (window // 2, window // 2))
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, k_close)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN,  k_open)

    # --- soft alpha via Gaussian feather ---------------------------------
    if feather > 0:
        sigma = feather
        alpha = cv2.GaussianBlur(binary.astype(np.float32), (0, 0), sigma)
        alpha = np.clip(alpha, 0, 255).astype(np.uint8)
    else:
        alpha = binary

    # --- build RGBA -------------------------------------------------------
    rgba = cv2.cvtColor(bgr, cv2.COLOR_BGR2BGRA)
    rgba[:, :, 3] = alpha

    # --- crop to content bounding box ------------------------------------
    rows_with_content = np.any(alpha > 10, axis=1)
    cols_with_content = np.any(alpha > 10, axis=0)

    if rows_with_content.any() and cols_with_content.any():
        r0, r1 = np.where(rows_with_content)[0][[0, -1]]
        c0, c1 = np.where(cols_with_content)[0][[0, -1]]
        cropped = rgba[r0:r1 + 1, c0:c1 + 1]
        print(f"  Cropped to: {cropped.shape[1]}x{cropped.shape[0]}  "
              f"(removed {c0}px left, {w-c1-1}px right, {r0}px top, {h-r1-1}px bottom)")
    else:
        print("  Warning: no sharp content found — outputting original")
        cropped = rgba

    cv2.imwrite(str(output_path), cropped)
    print(f"Saved → {output_path}")

    # --- optional: save debug sharpness map ------------------------------
    debug_path = Path(output_path).with_suffix(".debug_sharp.png")
    norm = cv2.normalize(sharp, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    heatmap = cv2.applyColorMap(norm, cv2.COLORMAP_INFERNO)
    cv2.imwrite(str(debug_path), heatmap)
    print(f"Debug sharpness map → {debug_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Remove blurry edges from a splat render")
    parser.add_argument("input",  help="Input PNG (rendered top-down splat)")
    parser.add_argument("output", help="Output PNG (transparent where blurry)")
    parser.add_argument("--window",     type=int,   default=64,
                        help="Laplacian window size in pixels (default 64)")
    parser.add_argument("--percentile", type=float, default=25.0,
                        help="Bottom X%% of sharpness scores are masked out (default 25)")
    parser.add_argument("--feather",    type=int,   default=30,
                        help="Gaussian sigma for soft alpha edges (0 = hard mask, default 30)")
    args = parser.parse_args()
    cleanup(args.input, args.output, args.window, args.percentile, args.feather)
