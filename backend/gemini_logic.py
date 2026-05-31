import os
import base64
import asyncio
import json
from pathlib import Path
from typing import List

import httpx
from fastapi import APIRouter, File, UploadFile, HTTPException
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash:generateContent"
)

# ─── Firebase admin (optional — graceful fallback if not configured) ───────────

def _get_firestore():
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore

        sa_path = Path(__file__).parent.parent / "firebase-migration" / "serviceAccount.json"
        if not firebase_admin._apps:
            if sa_path.exists():
                cred = credentials.Certificate(str(sa_path))
            else:
                cred = credentials.ApplicationDefault()
            firebase_admin.initialize_app(cred)
        return firestore.client()
    except Exception:
        return None

def _fetch_firebase_report_data():
    """Pull soil sensors, agent logs, anomalies, and soil health from Firestore."""
    db = _get_firestore()
    if db is None:
        return None

    try:
        # Soil sensors
        sensor_docs = db.collection("soilSensors").get()
        sensors = [d.to_dict() for d in sensor_docs]

        # Agent logs — latest 10
        log_docs = (
            db.collection("agentLogs")
            .order_by("ts", direction="DESCENDING")
            .limit(10)
            .get()
        )
        agent_logs = [d.to_dict() for d in log_docs]

        # Anomalies — latest 20 by created_at
        anomaly_docs = (
            db.collection("anomalies")
            .order_by("created_at", direction="DESCENDING")
            .limit(20)
            .get()
        )
        anomalies = [d.to_dict() for d in anomaly_docs]

        # Latest soil health index
        health_docs = (
            db.collection("soilHealth")
            .order_by("created_at", direction="DESCENDING")
            .limit(1)
            .get()
        )
        soil_health = health_docs[0].to_dict() if health_docs else None

        return {
            "sensors": sensors,
            "agent_logs": agent_logs,
            "anomalies": anomalies,
            "soil_health": soil_health,
        }
    except Exception as e:
        print(f"[gemini_logic] Firebase fetch failed: {e}")
        return None


def _build_report_prompt(firebase_data: dict | None) -> str:
    if firebase_data is None:
        # No Firebase — ask Gemini to generate a generic report
        return """You are an expert agricultural AI assistant.
Generate a comprehensive farm health report based on typical vineyard sensor data.
Output your response as a valid JSON object following this exact schema:
{
  "analyst": "AgrAI-7",
  "markdownText": "string — detailed markdown report with headings and recommendations",
  "anomalyCount": 0,
  "soilHealthIndex": null,
  "scores": {
    "overall": { "value": number, "max": 100, "description": "string" },
    "categories": [
      { "id": "moisture",    "title": "Moisture Index",      "score": number, "max": 100, "status": "string" },
      { "id": "nutrient",    "title": "Nutrient Balance",    "score": number, "max": 100, "status": "string" },
      { "id": "temperature", "title": "Temperature Stability","score": number, "max": 100, "status": "string" },
      { "id": "weed",        "title": "Weed Control",        "score": number, "max": 100, "status": "string" }
    ]
  }
}
Return ONLY the raw JSON object."""

    sensors = firebase_data["sensors"]
    anomalies = firebase_data["anomalies"]
    agent_logs = firebase_data["agent_logs"]
    soil_health = firebase_data["soil_health"]

    # Compute sensor averages
    def avg(key): return sum(s.get(key, 0) for s in sensors) / max(len(sensors), 1)
    sensor_summary = (
        f"Moisture: {avg('moisture'):.1f}%, "
        f"Nitrogen: {avg('nitrogen'):.1f} ppm, "
        f"Phosphorus: {avg('phosphorus'):.1f} ppm, "
        f"Potassium: {avg('potassium'):.1f} ppm, "
        f"pH: {avg('ph'):.2f}"
    )

    # Anomaly stats
    severity_counts: dict[str, int] = {}
    type_counts: dict[str, int] = {}
    for a in anomalies:
        sev = a.get("severity", "unknown")
        typ = a.get("type", "unknown")
        severity_counts[sev] = severity_counts.get(sev, 0) + 1
        type_counts[typ] = type_counts.get(typ, 0) + 1

    anomaly_summary = (
        f"Total anomalies: {len(anomalies)}. "
        f"By severity: {json.dumps(severity_counts)}. "
        f"By type: {json.dumps(type_counts)}."
    )

    # Recent agent actions
    log_lines = "\n".join(
        f"  - [{entry.get('time', '?')}] {entry.get('message', '')}"
        for entry in agent_logs[:5]
    )

    # Soil health index (pre-computed by daily_poll.py)
    if soil_health:
        shi_lines = (
            f"Overall: {soil_health.get('overall_score')}/100, "
            f"Moisture: {soil_health.get('moisture_score')}/100, "
            f"Nutrients: {soil_health.get('nutrient_score')}/100, "
            f"pH: {soil_health.get('ph_score')}/100, "
            f"Weed Pressure: {soil_health.get('weed_pressure_score')}/100"
        )
        shi_overall = soil_health.get("overall_score", 0)
        shi_summary = soil_health.get("summary", "")
    else:
        shi_lines = "Not yet computed"
        shi_overall = None
        shi_summary = ""

    return f"""You are an expert agricultural AI assistant generating a farm health report.

## Real-time data pulled from Firebase:

### Soil Sensor Averages (from {len(sensors)} sensors)
{sensor_summary}

### Anomaly Statistics
{anomaly_summary}

### Recent AI Agent Actions
{log_lines}

### Pre-computed Soil Health Index
{shi_lines}
{f'Soil Health Summary: {shi_summary}' if shi_summary else ''}

## Instructions
Using the real data above, generate a comprehensive farm health report.
Reference specific sensor readings, anomaly counts, and AI agent actions in your analysis.
Be concrete — mention actual numbers, sectors, and recommendations.

Output your response as a valid JSON object following this exact schema:
{{
  "analyst": "AgrAI-7",
  "markdownText": "string — detailed markdown report with headings and recommendations. Reference actual data.",
  "anomalyCount": {len(anomalies)},
  "soilHealthIndex": {shi_overall if shi_overall is not None else "null"},
  "scores": {{
    "overall": {{ "value": number, "max": 100, "description": "string" }},
    "categories": [
      {{ "id": "moisture",    "title": "Moisture Index",       "score": number, "max": 100, "status": "string" }},
      {{ "id": "nutrient",    "title": "Nutrient Balance",     "score": number, "max": 100, "status": "string" }},
      {{ "id": "temperature", "title": "Temperature Stability","score": number, "max": 100, "status": "string" }},
      {{ "id": "weed",        "title": "Weed Control",         "score": number, "max": 100, "status": "string" }}
    ]
  }}
}}
Return ONLY the raw JSON object, no markdown code blocks."""


# ─── Cached report path ────────────────────────────────────────────────────────

CACHED_REPORT = Path(__file__).parent.parent / "frontend" / "src" / "reportData.json"


# ─── Weed / farm photo analysis ───────────────────────────────────────────────

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
    parts = []
    for idx, (b64_data, mime_type) in enumerate(images_b64):
        point_label = "Point A" if idx < 4 else "Point B"
        direction = DIRECTIONS[idx % 4]
        parts.append({"text": f"{point_label} {direction} View:"})
        parts.append({"inline_data": {"mime_type": mime_type, "data": b64_data}})
    parts.append({"text": FARM_ANALYSIS_PROMPT})
    return {
        "contents": [{"parts": parts}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 2048, "responseMimeType": "application/json"},
    }


async def _call_gemini_analyze(
    client: httpx.AsyncClient,
    images_b64: List[tuple[str, str]],
    batch_label: str,
) -> dict:
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY environment variable is not set.")

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
        raise HTTPException(status_code=502, detail=f"Gemini API error on {batch_label}: {exc.response.text}")
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Network error calling Gemini on {batch_label}: {str(exc)}")


@router.post("/analyze")
async def analyze_photos(photos: List[UploadFile] = File(...)):
    if not photos:
        raise HTTPException(status_code=400, detail="No photos provided.")
    if len(photos) % 4 != 0:
        raise HTTPException(status_code=400, detail=f"Number of photos must be a multiple of 4. Received {len(photos)}.")
    if len(photos) > 80:
        raise HTTPException(status_code=400, detail=f"Maximum 80 photos allowed (20 points). Received {len(photos)}.")

    images_b64: List[tuple[str, str]] = []
    for photo in photos:
        content = await photo.read()
        mime_type = photo.content_type or "image/jpeg"
        b64 = base64.b64encode(content).decode("utf-8")
        images_b64.append((b64, mime_type))

    batches = [images_b64[i:i + 8] for i in range(0, len(images_b64), 8)]

    async with httpx.AsyncClient() as client:
        tasks = [_call_gemini_analyze(client, batch, f"Batch {i + 1}") for i, batch in enumerate(batches)]
        results = await asyncio.gather(*tasks)

    return {"total_photos": len(photos), "total_points": len(photos) // 4, "results": results}


@router.get("/report")
async def generate_report(fresh: bool = False):
    """
    Generate a farm health report using Gemini AI backed by live Firebase data.

    Query params:
      fresh=true — force regeneration even if cache exists
    """
    # Serve cached report unless fresh=true
    if not fresh and CACHED_REPORT.exists():
        try:
            return json.loads(CACHED_REPORT.read_text())
        except Exception:
            pass

    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY environment variable is not set.")

    # Pull live Firebase data
    firebase_data = _fetch_firebase_report_data()

    prompt = _build_report_prompt(firebase_data)

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.5},
    }
    url = f"{GEMINI_URL}?key={GEMINI_API_KEY}"

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(url, json=payload, timeout=90.0)
            response.raise_for_status()
            data = response.json()
            text = (
                data.get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [{}])[0]
                .get("text", "{}")
            )
            # Strip any markdown code fences
            if text.startswith("```"):
                text = text.split("```")[1]
                if text.startswith("json"):
                    text = text[4:]
                text = text.strip()

            report_data = json.loads(text)

            # Inject firebase counts in case Gemini hallucinated different numbers
            if firebase_data:
                report_data["anomalyCount"] = len(firebase_data["anomalies"])
                if firebase_data["soil_health"]:
                    report_data["soilHealthIndex"] = firebase_data["soil_health"].get("overall_score")

            # Cache the result
            try:
                CACHED_REPORT.parent.mkdir(parents=True, exist_ok=True)
                CACHED_REPORT.write_text(json.dumps(report_data, indent=2))
            except Exception:
                pass

            return report_data
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=e.response.status_code, detail=f"Gemini API error: {e.response.text}")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
