import os
import base64
import asyncio
from typing import List

import httpx
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from farm_agent import router as agent_router
from farm_ops_agent import router as ops_router
from farm_robot_agent import router as robot_router

app = FastAPI(title="Farm Analysis API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount the ADK-powered farm research agent
app.include_router(agent_router, prefix="/api/agent")

# Mount the ADK-powered pull-only operations agent
app.include_router(ops_router, prefix="/api/ops-agent")

# Mount the ADK-powered hardware robot agent
app.include_router(robot_router, prefix="/api/robot")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.0-flash:generateContent"
)

FARM_ANALYSIS_PROMPT = """You are an expert agricultural AI assistant analyzing farm photos.
For each photo provided, perform a detailed analysis covering:

1. **Crop Health** - Identify any signs of disease, nutrient deficiency, or stress.
2. **Weed Detection** - Identify any weeds present, their species if possible, and severity.
3. **Soil Conditions** - Note any visible soil issues, erosion, or moisture problems.
4. **Pest Damage** - Look for signs of insect or animal damage.
5. **Overall Assessment** - Provide a brief health score (0-100) and key recommendations.

Structure your response as a clear, actionable report. Be specific about what you observe in the images.
If multiple images are provided, analyze each one and then give an overall combined assessment."""


def _build_gemini_request(images_b64: List[tuple[str, str]]) -> dict:
    """Build a Gemini API request body with multiple images."""
    parts = []
    for idx, (b64_data, mime_type) in enumerate(images_b64):
        parts.append({"text": f"Photo {idx + 1}:"})
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
            "temperature": 0.4,
            "maxOutputTokens": 2048,
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
        return {"batch": batch_label, "analysis": text}
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


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/analyze")
async def analyze_photos(photos: List[UploadFile] = File(...)):
    """
    Accepts 1–20 JPEG photos.
    Sends them to Gemini in up to 2 parallel API calls (max 10 photos each).
    Returns combined analysis results.
    """
    if not photos:
        raise HTTPException(status_code=400, detail="No photos provided.")
    if len(photos) > 20:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum 20 photos allowed. Received {len(photos)}.",
        )

    # Read and base64-encode all uploaded files
    images_b64: List[tuple[str, str]] = []
    for photo in photos:
        content = await photo.read()
        mime_type = photo.content_type or "image/jpeg"
        b64 = base64.b64encode(content).decode("utf-8")
        images_b64.append((b64, mime_type))

    # Split into 2 batches of at most 10
    batch1 = images_b64[:10]
    batch2 = images_b64[10:20]  # Empty if ≤ 10 photos

    async with httpx.AsyncClient() as client:
        tasks = [_call_gemini(client, batch1, "Batch 1 (Photos 1–10)")]
        if batch2:
            tasks.append(_call_gemini(client, batch2, "Batch 2 (Photos 11–20)"))

        results = await asyncio.gather(*tasks)

    return {
        "total_photos": len(photos),
        "batches_processed": len(results),
        "results": results,
    }
