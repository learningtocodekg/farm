import os
import base64
import asyncio
import json
from typing import List

import httpx
from fastapi import APIRouter, File, UploadFile, HTTPException

router = APIRouter()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.0-flash:generateContent"
)

FARM_ANALYSIS_PROMPT = """You are an expert agricultural AI assistant analyzing farm photos.
You are provided with up to 8 images representing the North, South, East, and West views from one or two points on the farm.
The images are provided in pairs of points (e.g. Point A and Point B).
If there are 4 images, they belong to Point A. If there are 8 images, the first 4 belong to Point A and the last 4 belong to Point B.

Perform a detailed analysis for each point to identify if any of the views contain a farm anomaly (e.g. weed, pest, disease, nutrient deficiency, etc.).

Return the response strictly as a JSON object with the following structure:
{
  "points": [
    {
      "point_id": "Identifier of the point (e.g. Point A or Point B)",
      "anomalies_detected": boolean,
      "details": [
        {
          "direction": "North|South|East|West",
          "anomaly_type": "weed|pest|disease|other",
          "description": "Brief description of the anomaly found in this direction",
          "severity": "low|medium|high"
        }
      ],
      "overall_assessment": "Brief summary of the point"
    }
  ]
}

If no anomalies are found in any direction for a given point, set anomalies_detected to false and leave details empty for that point.
"""

DIRECTIONS = ["North", "South", "East", "West"]

def _build_gemini_request(images_b64: List[tuple[str, str]]) -> dict:
    """Build a Gemini API request body with up to 8 directional images."""
    parts = []
    for idx, (b64_data, mime_type) in enumerate(images_b64):
        point_label = "Point A" if idx < 4 else "Point B"
        direction = DIRECTIONS[idx % 4]
        parts.append({"text": f"{point_label} {direction} View:"})
        parts.append({
            "inline_data": {
                "mime_type": mime_type,
                "data": b64_data,
            }
        })
    parts.append({"text": FARM_ANALYSIS_PROMPT})
    return {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 2048,
            "responseMimeType": "application/json",
        },
    }


async def _call_gemini(
    client: httpx.AsyncClient,
    images_b64: List[tuple[str, str]],
    batch_label: str,
) -> dict:
    """Send one Gemini API request and return the parsed result."""
    if not GEMINI_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="GEMINI_API_KEY environment variable is not set.",
        )

    payload = _build_gemini_request(images_b64)
    url = f"{GEMINI_URL}?key={GEMINI_API_KEY}"

    try:
        response = await client.post(url, json=payload, timeout=120.0)
        response.raise_for_status()
        data = response.json()
        text = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "No response generated.")
        )
        
        try:
            analysis_json = json.loads(text)
        except json.JSONDecodeError:
            analysis_json = {"raw_text": text}
            
        return {"batch": batch_label, "analysis": analysis_json}
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Gemini API error on {batch_label}: {exc.response.text}",
        )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Network error calling Gemini on {batch_label}: {str(exc)}",
        )


@router.post("/analyze")
async def analyze_photos(photos: List[UploadFile] = File(...)):
    """
    Accepts multiples of 4 JPEG photos (N, S, E, W views for each point).
    Sends each batch (up to 8 photos, i.e. 2 points) to Gemini.
    Returns structured analysis results per batch.
    """
    if not photos:
        raise HTTPException(status_code=400, detail="No photos provided.")
    if len(photos) % 4 != 0:
        raise HTTPException(
            status_code=400,
            detail=f"Number of photos must be a multiple of 4. Received {len(photos)}.",
        )
    if len(photos) > 80:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum 80 photos allowed (20 points). Received {len(photos)}.",
        )

    # Read and base64-encode all uploaded files
    images_b64: List[tuple[str, str]] = []
    for photo in photos:
        content = await photo.read()
        mime_type = photo.content_type or "image/jpeg"
        b64 = base64.b64encode(content).decode("utf-8")
        images_b64.append((b64, mime_type))

    # Split into chunks of 8 (Batches)
    batches = [images_b64[i:i + 8] for i in range(0, len(images_b64), 8)]

    async with httpx.AsyncClient() as client:
        tasks = []
        for i, batch_images in enumerate(batches):
            tasks.append(_call_gemini(client, batch_images, f"Batch {i + 1}"))

        results = await asyncio.gather(*tasks)

    return {
        "total_photos": len(photos),
        "total_points": len(photos) // 4,
        "results": results,
    }
