"""
daily_poll.py — Simulated daily AI agent pipeline.

This script is NEVER meant to be deployed or run in production.
It demonstrates the full autonomous farm loop for demo purposes:

  1. Poll soil sensor readings from Firebase
  2. Run AI agent scan → detect anomalies
  3. Call dummy drone/sprinkler task executors
  4. Update Firebase with anomaly results + soil health index
  5. Log all AI agent actions to the agentLogs collection

Run manually: python scripts/daily_poll.py
Requirements: pip install firebase-admin google-generativeai python-dotenv
"""

import os
import json
import datetime
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / "backend" / ".env")

import firebase_admin
from firebase_admin import credentials, firestore
import google.generativeai as genai

# ─── Firebase init ─────────────────────────────────────────────────────────────
SERVICE_ACCOUNT = Path(__file__).parent.parent / "firebase-migration" / "serviceAccount.json"
if not firebase_admin._apps:
    cred = credentials.Certificate(str(SERVICE_ACCOUNT))
    firebase_admin.initialize_app(cred)

db = firestore.client()

# ─── Gemini init ───────────────────────────────────────────────────────────────
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

# ─── Dummy drone/task executors ────────────────────────────────────────────────
# These are hardcoded stubs. In a real system these would trigger actual hardware.

def dispatch_spray_drone(drone_id: int, lat: float, lng: float, reason: str) -> str:
    print(f"  [DRONE] Drone #{drone_id} → spray at ({lat:.4f}, {lng:.4f}): {reason}")
    return f"Drone #{drone_id} dispatched for herbicide spray to {lat:.4f}, {lng:.4f}"

def dispatch_fertilizer_drone(drone_id: int, lat: float, lng: float, reason: str) -> str:
    print(f"  [DRONE] Drone #{drone_id} → fertilize at ({lat:.4f}, {lng:.4f}): {reason}")
    return f"Drone #{drone_id} dispatched for fertilizer spread to {lat:.4f}, {lng:.4f}"

def activate_sprinkler(zone: str, lat: float, lng: float, reason: str) -> str:
    print(f"  [SPRINKLER] Zone {zone} activated at ({lat:.4f}, {lng:.4f}): {reason}")
    return f"Sprinkler activated in zone {zone} at {lat:.4f}, {lng:.4f}"

# Hardcoded AI agent decision table — maps anomaly type to the action the agent takes.
# In production this would be a real LLM reasoning loop over live sensor readings.
HARDCODED_AGENT_ACTIONS = [
    {
        "anomaly_type": "weed",
        "sector": "4A",
        "lat": 36.7905,
        "lng": -119.4181,
        "severity": "high",
        "label": "Pigweed cluster detected",
        "executor": lambda: dispatch_spray_drone(12, 36.7905, -119.4181, "Pigweed cluster detected in sector 4A"),
    },
    {
        "anomaly_type": "pest",
        "sector": "3B",
        "lat": 36.7893,
        "lng": -119.4145,
        "severity": "medium",
        "label": "Aphid infestation spotted",
        "executor": lambda: dispatch_spray_drone(33, 36.7893, -119.4145, "Aphid infestation in sector 3B"),
    },
    {
        "anomaly_type": "moisture_deficit",
        "sector": "5D",
        "lat": 36.7870,
        "lng": -119.4145,
        "severity": "critical",
        "label": "Critical moisture deficit",
        "executor": lambda: activate_sprinkler("5D", 36.7870, -119.4145, "Moisture below 20% threshold"),
    },
    {
        "anomaly_type": "nutrient_deficiency",
        "sector": "1A",
        "lat": 36.7905,
        "lng": -119.4181,
        "severity": "warning",
        "label": "NPK deficiency — low nitrogen",
        "executor": lambda: dispatch_fertilizer_drone(21, 36.7905, -119.4181, "N levels critically low in sector 1A"),
    },
]

# ─── Step 1: Poll soil sensors from Firebase ───────────────────────────────────

def poll_soil_sensors() -> list[dict]:
    print("\n[1] Polling soil sensors from Firebase...")
    docs = db.collection("soilSensors").get()
    sensors = [doc.to_dict() for doc in docs]
    print(f"    Read {len(sensors)} sensors")
    return sensors

# ─── Step 2: AI agent scan (hardcoded decisions) ───────────────────────────────

def run_agent_scan(sensors: list[dict]) -> list[dict]:
    print("\n[2] Running AI agent scan on sensor readings...")
    # Real implementation: send sensor array to Gemini, ask which zones need action.
    # Here we return the hardcoded action table directly.
    print(f"    Agent identified {len(HARDCODED_AGENT_ACTIONS)} anomalies requiring action")
    return HARDCODED_AGENT_ACTIONS

# ─── Step 3: Execute drone/task actions ───────────────────────────────────────

def execute_drone_tasks(anomalies: list[dict]) -> list[str]:
    print("\n[3] Executing drone/sprinkler tasks...")
    drone_log_messages = []
    for anomaly in anomalies:
        action_description = anomaly["executor"]()
        drone_log_messages.append(action_description)
    return drone_log_messages

# ─── Step 4: Write anomalies to Firebase ──────────────────────────────────────

def write_anomalies(anomalies: list[dict], drone_messages: list[str]):
    print("\n[4] Writing anomalies to Firebase...")
    now = datetime.datetime.utcnow()
    batch = db.batch()

    for i, anomaly in enumerate(anomalies):
        doc_ref = db.collection("anomalies").document()
        batch.set(doc_ref, {
            "type": anomaly["anomaly_type"],
            "label": anomaly["label"],
            "sector": anomaly["sector"],
            "severity": anomaly["severity"],
            "lat": anomaly["lat"],
            "lng": anomaly["lng"],
            "drone_action": drone_messages[i],
            "created_at": firestore.SERVER_TIMESTAMP,
        })

    batch.commit()
    print(f"    Wrote {len(anomalies)} anomaly documents")

# ─── Step 5: Gemini soil health index ─────────────────────────────────────────

SOIL_HEALTH_PROMPT = """You are an agricultural AI analyst.
Given the following soil sensor readings from a vineyard farm, compute a composite soil health index.

Sensor data (averaged across 20 sensors):
{sensor_summary}

Number of active anomalies: {anomaly_count}
Anomaly breakdown: {anomaly_breakdown}

Return ONLY a valid JSON object with this exact schema:
{{
  "overall_score": <integer 0-100>,
  "moisture_score": <integer 0-100>,
  "nutrient_score": <integer 0-100>,
  "ph_score": <integer 0-100>,
  "weed_pressure_score": <integer 0-100>,
  "summary": "<2-3 sentence plain text summary of current soil health and key action items>"
}}

Scoring guide:
- moisture_score: based on average moisture (ideal 50-65%)
- nutrient_score: based on N/P/K levels (ideal N>40, P>25, K>170)
- ph_score: based on pH (ideal 6.3-6.8)
- weed_pressure_score: 100 minus penalty for weed/pest anomalies
- overall_score: weighted average of the four category scores
"""

def compute_soil_health_index(sensors: list[dict], anomalies: list[dict]) -> dict:
    print("\n[5] Computing soil health index with Gemini AI...")

    # Compute sensor averages for the prompt
    avg = {
        "moisture": sum(s.get("moisture", 0) for s in sensors) / len(sensors),
        "nitrogen": sum(s.get("nitrogen", 0) for s in sensors) / len(sensors),
        "phosphorus": sum(s.get("phosphorus", 0) for s in sensors) / len(sensors),
        "potassium": sum(s.get("potassium", 0) for s in sensors) / len(sensors),
        "ph": sum(s.get("ph", 0) for s in sensors) / len(sensors),
    }
    sensor_summary = (
        f"Moisture: {avg['moisture']:.1f}%, Nitrogen: {avg['nitrogen']:.1f} ppm, "
        f"Phosphorus: {avg['phosphorus']:.1f} ppm, Potassium: {avg['potassium']:.1f} ppm, pH: {avg['ph']:.2f}"
    )

    anomaly_breakdown = ", ".join(
        f"{a['anomaly_type']} ({a['severity']})" for a in anomalies
    )

    if not GEMINI_API_KEY:
        print("    WARNING: No GEMINI_API_KEY — using hardcoded fallback scores")
        return {
            "overall_score": 78,
            "moisture_score": 62,
            "nutrient_score": 85,
            "ph_score": 91,
            "weed_pressure_score": 55,
            "summary": (
                "Soil health is moderate. Moisture deficits in sectors 5D and 4C require irrigation. "
                "Nutrient levels are strong across most zones. Weed pressure is elevated in sectors 4A and 2B — "
                "drone intervention underway."
            ),
        }

    prompt = SOIL_HEALTH_PROMPT.format(
        sensor_summary=sensor_summary,
        anomaly_count=len(anomalies),
        anomaly_breakdown=anomaly_breakdown,
    )
    model = genai.GenerativeModel("gemini-2.5-flash")
    response = model.generate_content(prompt, generation_config={"temperature": 0.3})
    text = response.text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    result = json.loads(text)
    print(f"    Overall soil health score: {result['overall_score']}/100")
    return result

def write_soil_health(health: dict):
    doc_ref = db.collection("soilHealth").document()
    doc_ref.set({**health, "created_at": firestore.SERVER_TIMESTAMP})
    print(f"    Wrote soilHealth document (score: {health['overall_score']})")

# ─── Step 6: Write agent action logs to Firebase ──────────────────────────────

def write_agent_logs(drone_messages: list[str], anomalies: list[dict]):
    print("\n[6] Writing AI agent action logs to Firebase...")
    now = datetime.datetime.utcnow()
    batch = db.batch()

    log_entries = []
    for i, (msg, anomaly) in enumerate(zip(drone_messages, anomalies)):
        t = now - datetime.timedelta(minutes=i * 3)
        log_entries.append({
            "time": t.strftime("%H:%M"),
            "message": msg,
            "ts": t,
        })

    for entry in log_entries:
        doc_ref = db.collection("agentLogs").document()
        batch.set(doc_ref, {
            "time": entry["time"],
            "message": entry["message"],
            "ts": firestore.SERVER_TIMESTAMP,
        })

    batch.commit()
    print(f"    Wrote {len(log_entries)} agent log entries")

# ─── Main pipeline ─────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  FARM AI DAILY POLL PIPELINE")
    print(f"  {datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 60)

    sensors = poll_soil_sensors()
    anomalies = run_agent_scan(sensors)
    drone_messages = execute_drone_tasks(anomalies)
    write_anomalies(anomalies, drone_messages)
    health = compute_soil_health_index(sensors, anomalies)
    write_soil_health(health)
    write_agent_logs(drone_messages, anomalies)

    print("\n✅ Daily poll pipeline complete.")
    print(f"   Anomalies logged: {len(anomalies)}")
    print(f"   Soil health score: {health['overall_score']}/100")

if __name__ == "__main__":
    main()
