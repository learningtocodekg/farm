"""
Top-down farm image → focal strip (in-focus soil + flanking crop rows).

Uses Laplacian variance (sharpness) to find the in-focus centre of the image.
The blurry out-of-focus edges are discarded; the sharp centre is kept.
Works on natural-colour 3D splat renders — no heatmap overlay required.
"""

import cv2
import numpy as np


def process_topdown(bgr: np.ndarray) -> tuple[np.ndarray, dict]:
    """
    Args:
        bgr: BGR screenshot from the top-down splat viewer.

    Returns:
        (cropped_bgr, meta)
    """
    H, W = bgr.shape[:2]

    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)

    # Laplacian sharpness per column — blurry edges score low, sharp centre scores high
    lap = cv2.Laplacian(gray, cv2.CV_32F)
    col_sharp = np.var(lap, axis=0)          # shape (W,)

    # Smooth with a ~3% wide window to suppress noise
    k = max(3, W // 30)
    col_sharp = np.convolve(col_sharp, np.ones(k) / k, mode='same')

    # Keep columns above the 30th-percentile sharpness threshold
    thresh = np.percentile(col_sharp, 30)
    sharp_cols = np.where(col_sharp > thresh)[0]

    if len(sharp_cols) == 0:
        return bgr.copy(), {"error": "no sharp region found"}

    x0 = max(0, int(sharp_cols.min()))
    x1 = min(W, int(sharp_cols.max()) + 1)

    cropped = bgr[:, x0:x1]
    meta = {"x0": x0, "x1": x1, "width": x1 - x0}
    return cropped, meta
