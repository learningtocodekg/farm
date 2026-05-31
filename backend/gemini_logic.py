import os
import base64
import asyncio
import json
from pathlib import Path
from typing import List

import httpx
import google.generativeai as genai
from fastapi import APIRouter, File, UploadFile, HTTPException
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()

REPORT_PROMPT = """You are an expert agricultural AI assistant.
Generate a comprehensive farm health report based on typical sensor data (Moisture, Nutrient, Temperature, Weed Control).
Output your response as a valid JSON object following this exact schema:
{
  "analyst": "string",
  "markdownText": "string (A detailed markdown report with headings, bullet points, and actionable recommendations)",
  "scores": {
    "overall": {
      "value": number (0-100),
      "max": 100,
      "description": "string"
    },
    "categories": [
      {
        "id": "moisture",
        "title": "Moisture Index",
        "score": number,
        "max": 100,
        "status": "string"
      },
      {
        "id": "nutrient",
        "title": "Nutrient Balance",
        "score": number,
        "max": 100,
        "status": "string"
      },
      {
        "id": "temperature",
        "title": "Temperature Stability",
        "score": number,
        "max": 100,
        "status": "string"
      },
      {
        "id": "weed",
        "title": "Weed Control",
        "score": number,
        "max": 100,
        "status": "string"
      }
    ]
  }
}
Return ONLY the raw JSON object, without any markdown formatting blocks like ```json.
"""

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

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
    images_b64: List[tuple[str, str]],
    batch_label: str,
) -> dict:
    """Send one Gemini API request and return the parsed result."""
    if not GEMINI_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="GEMINI_API_KEY environment variable is not set.",
        )

    try:
        model = genai.GenerativeModel("gemini-2.5-flash")

        # Build image content for Gemini
        image_parts = []
        for idx, (b64_data, mime_type) in enumerate(images_b64):
            point_label = "Point A" if idx < 4 else "Point B"
            direction = DIRECTIONS[idx % 4]
            image_parts.append(f"{point_label} {direction} View:")

            # Convert base64 to bytes for Gemini
            image_bytes = base64.b64decode(b64_data)
            image_parts.append({
                "mime_type": mime_type,
                "data": b64_data,
            })

        image_parts.append(FARM_ANALYSIS_PROMPT)

        # Call Gemini API
        response = model.generate_content(
            image_parts,
            generation_config={
                "temperature": 0.2,
                "max_output_tokens": 2048,
            }
        )

        text = response.text

        try:
            analysis_json = json.loads(text)
        except json.JSONDecodeError:
            analysis_json = {"raw_text": text}

        return {"batch": batch_label, "analysis": analysis_json}
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Gemini API error on {batch_label}: {str(exc)}",
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

    tasks = []
    for i, batch_images in enumerate(batches):
        tasks.append(_call_gemini(batch_images, f"Batch {i + 1}"))

    results = await asyncio.gather(*tasks)

    return {
        "total_photos": len(photos),
        "total_points": len(photos) // 4,
        "results": results,
    }


@router.get("/report")
async def generate_report():
    cached_report_path = Path(__file__).parent.parent / "frontend" / "src" / "reportData.json"
    if cached_report_path.exists():
        try:
            return json.loads(cached_report_path.read_text())
        except Exception:
            pass

    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY environment variable is not set.")

    try:
        model = genai.GenerativeModel("gemini-2.5-flash")
        response = model.generate_content(
            REPORT_PROMPT,
            generation_config={
                "temperature": 0.7,
            }
        )
        text = response.text
        if not text:
            raise ValueError("Gemini API returned empty response")

        # Strip markdown code blocks if present
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()

        # Properly escape the text for JSON parsing
        # Use json.loads on the encoded string to handle literal newlines
        try:
            report_data = json.loads(text)
        except json.JSONDecodeError as e:
            # Try encoding and decoding to handle raw newlines
            text_bytes = text.encode('utf-8').decode('unicode-escape')
            report_data = json.loads(text_bytes)

        # Optionally cache the result
        try:
            cached_report_path.parent.mkdir(parents=True, exist_ok=True)
            cached_report_path.write_text(json.dumps(report_data, indent=2))
        except Exception:
            pass

        return report_data
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse Gemini response as JSON: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini API error: {str(e)}")
