"""
Merge nearby anomaly detections into single representatives.

Usage:
    python scripts/cluster.py [--radius 0.5] [--input frontend/public/anomalies.json] [--output frontend/public/anomalies.json]

The same physical weed can appear in multiple frames (overlapping coverage)
or produce several bounding boxes in one frame. This script collapses any
detections whose 3-D positions are within --radius world units of each other
into a single point (centroid of the cluster), keeping the type and highest-
confidence frame name.
"""

import argparse
import json
import math
from pathlib import Path

SCRIPT_DIR   = Path(__file__).parent
DEFAULT_IN   = SCRIPT_DIR.parent / "frontend" / "public" / "anomalies.json"
DEFAULT_OUT  = DEFAULT_IN
DEFAULT_RADIUS = 0.5


def dist(a, b):
    return math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3)))


def cluster(anomalies: list[dict], radius: float) -> list[dict]:
    """Greedy single-linkage clustering in O(n²) — fine for <1000 points."""
    remaining = list(anomalies)
    groups: list[list[dict]] = []

    while remaining:
        seed = remaining.pop(0)
        group = [seed]
        still_remaining = []
        for candidate in remaining:
            if dist(seed["position"], candidate["position"]) <= radius:
                group.append(candidate)
            else:
                still_remaining.append(candidate)
        remaining = still_remaining
        groups.append(group)

    merged = []
    for i, group in enumerate(groups):
        n = len(group)
        cx = sum(a["position"][0] for a in group) / n
        cy = sum(a["position"][1] for a in group) / n
        cz = sum(a["position"][2] for a in group) / n

        # Pick the most common type in the group
        type_counts: dict[str, int] = {}
        for a in group:
            type_counts[a["type"]] = type_counts.get(a["type"], 0) + 1
        dominant_type = max(type_counts, key=lambda t: type_counts[t])

        rep = {
            "id":       f"c{i}",
            "type":     dominant_type,
            "position": [cx, cy, cz],
            "count":    n,
            "sources":  [a["id"] for a in group],
        }
        # Preserve frame reference from the first member if present
        if "frame" in group[0]:
            rep["frame"] = group[0]["frame"]

        merged.append(rep)

    return merged


def main():
    parser = argparse.ArgumentParser(description="Cluster nearby anomaly detections.")
    parser.add_argument("--radius", type=float, default=DEFAULT_RADIUS,
                        help="Max distance (world units) to merge into one point (default: 0.5)")
    parser.add_argument("--input",  default=str(DEFAULT_IN),  help="Input anomalies JSON")
    parser.add_argument("--output", default=str(DEFAULT_OUT), help="Output anomalies JSON (overwrites input by default)")
    args = parser.parse_args()

    input_path  = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        print(f"ERROR: {input_path} not found. Run detect.py first.")
        raise SystemExit(1)

    anomalies = json.loads(input_path.read_text())
    if not anomalies:
        print("No anomalies to cluster.")
        return

    before = len(anomalies)
    merged = cluster(anomalies, args.radius)
    after  = len(merged)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(merged, indent=2))

    print(f"Clustered {before} detections -> {after} unique anomalies (radius={args.radius})")
    print(f"Written to: {output_path}")


if __name__ == "__main__":
    main()
