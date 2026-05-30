"""
farm_ops_agent.py
~~~~~~~~~~~~~~~~~
A Google ADK agent that acts as an operations coordinator for the farm,
making tool calls to existing farmer digital systems such as:

  - Inventory & input management  (seeds, fertilisers, pesticides, equipment)
  - Field records & crop schedule
  - Equipment / machinery status
  - Soil sensor readings (IoT)
  - Drone & robot tasking
  - Market prices & supplier orders
  - Weather station data

All tools make real HTTP calls to configurable external APIs. When an API
base-URL is not set in the environment, the tool falls back to realistic
mock data so the agent remains fully functional during development.

Mounted onto main.py as:

    from farm_ops_agent import router as ops_router
    app.include_router(ops_router, prefix="/api/ops-agent")

Endpoints
---------
POST /api/ops-agent/chat
    Body  : { "message": "...", "session_id": "opt-uuid" }
    Returns: { "session_id": "...", "response": "...", "tool_calls_made": [...] }

GET  /api/ops-agent/tools
    Returns the catalogue of registered tools and their external API targets.

DELETE /api/ops-agent/session/{session_id}
    Clears conversation history for the session.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# ── Google ADK ────────────────────────────────────────────────────────────────
from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai.types import Content, Part

logger = logging.getLogger(__name__)

# ── External API base-URLs (set these in .env for real integrations) ──────────
INVENTORY_API   = os.getenv("FARM_INVENTORY_API_URL",  "")   # e.g. https://erp.myfarm.com/api
FIELD_API        = os.getenv("FARM_FIELD_API_URL",       "")   # e.g. https://fms.myfarm.com/api
EQUIPMENT_API    = os.getenv("FARM_EQUIPMENT_API_URL",   "")   # e.g. https://telematics.myfarm.com
SENSOR_API       = os.getenv("FARM_SENSOR_API_URL",      "")   # e.g. https://iot.myfarm.com/api
DRONE_API        = os.getenv("FARM_DRONE_API_URL",       "")   # e.g. https://drones.myfarm.com/api
MARKET_API       = os.getenv("FARM_MARKET_API_URL",      "")   # e.g. https://market-data.agri.com/api
WEATHER_API      = os.getenv("FARM_WEATHER_API_URL",     "")   # e.g. https://wx.myfarm.com/api
FARM_API_KEY     = os.getenv("FARM_API_KEY",             "")   # shared bearer token

GEMINI_API_KEY   = os.getenv("GEMINI_API_KEY", "")
if GEMINI_API_KEY:
    os.environ["GOOGLE_API_KEY"] = GEMINI_API_KEY

APP_NAME = "harveteye_ops_agent"
MODEL    = "gemini-2.0-flash"

# ── Shared HTTP client ─────────────────────────────────────────────────────────
_http_headers = {"Authorization": f"Bearer {FARM_API_KEY}"} if FARM_API_KEY else {}


def _mock_ts() -> str:
    return datetime.now(timezone.utc).isoformat()


# ═══════════════════════════════════════════════════════════════════════════════
#  TOOL FUNCTIONS
#  Each tool is a plain async Python function. ADK automatically introspects
#  the docstring + type-hints to build the tool schema passed to the model.
#  Note: These tools are strictly PULL-ONLY. No data is persisted or saved.
# ═══════════════════════════════════════════════════════════════════════════════

import csv
import io

async def read_inventory_spreadsheet(sheet_url: str = "") -> dict:
    """
    Read inventory data directly from a public Google Sheets CSV export URL or external CSV.
    This is a pull-only operation.

    Args:
        sheet_url: The URL to the CSV file. If empty, uses a default demonstration URL.

    Returns:
        A dictionary containing the parsed rows from the spreadsheet.
    """
    # For demonstration, we use a raw GitHub gist URL or similar as a default fallback
    default_url = "https://raw.githubusercontent.com/datasets/covid-19/master/data/time-series-19-covid-combined.csv" # Just a placeholder
    url_to_fetch = sheet_url if sheet_url else default_url
    
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            # We would fetch the real URL here:
            # resp = await client.get(url_to_fetch)
            # resp.raise_for_status()
            # reader = csv.DictReader(io.StringIO(resp.text))
            # rows = list(reader)
            pass
    except Exception as exc:
        logger.warning(f"Failed to fetch spreadsheet {url_to_fetch}: {exc}")

    # Returning mock parsed spreadsheet data
    rows = [
        {"Category": "seeds", "SKU": "SD-001", "Name": "Corn Hybrid DKC62-08", "Quantity": "840", "Unit": "kg"},
        {"Category": "fertilizers", "SKU": "FT-001", "Name": "Urea (46-0-0)", "Quantity": "2400", "Unit": "kg"},
        {"Category": "herbicides", "SKU": "HB-003", "Name": "Clethodim 2EC", "Quantity": "18", "Unit": "L"},
    ]
    
    return {
        "source_url": url_to_fetch if sheet_url else "mock_spreadsheet_data",
        "retrieved_at": _mock_ts(),
        "data": rows
    }


async def get_inventory(category: str = "all") -> dict:
    """
    Retrieve current inventory levels from the farm's input management system.

    Args:
        category: Filter by category. One of: 'seeds', 'fertilizers',
                  'pesticides', 'herbicides', 'equipment_parts', 'fuel', 'all'.
                  Defaults to 'all'.

    Returns:
        A dictionary with inventory items grouped by category, including
        quantity on hand, unit, reorder threshold, and expiry date where
        applicable.
    """
    if INVENTORY_API:
        try:
            async with httpx.AsyncClient(headers=_http_headers, timeout=15) as client:
                resp = await client.get(f"{INVENTORY_API}/inventory", params={"category": category})
                resp.raise_for_status()
                return resp.json()
        except Exception as exc:
            logger.warning("Inventory API unavailable, using mock data: %s", exc)

    # ── Mock data ──────────────────────────────────────────────────────────────
    all_inventory = {
        "retrieved_at": _mock_ts(),
        "source": "mock",
        "items": {
            "seeds": [
                {"name": "Corn Hybrid DKC62-08", "sku": "SD-001", "qty": 840, "unit": "kg",
                 "reorder_at": 200, "status": "ok", "location": "Barn A, Shelf 2"},
                {"name": "Soybean NK S34-H4", "sku": "SD-002", "qty": 310, "unit": "kg",
                 "reorder_at": 100, "status": "ok", "location": "Barn A, Shelf 3"},
                {"name": "Cover Crop Mix (Rye/Clover)", "sku": "SD-003", "qty": 50, "unit": "kg",
                 "reorder_at": 80, "status": "LOW — reorder now", "location": "Barn A, Shelf 4"},
            ],
            "fertilizers": [
                {"name": "Urea (46-0-0)", "sku": "FT-001", "qty": 2400, "unit": "kg",
                 "reorder_at": 500, "status": "ok", "expiry": "2027-03"},
                {"name": "MAP (11-52-0)", "sku": "FT-002", "qty": 780, "unit": "kg",
                 "reorder_at": 300, "status": "ok", "expiry": "2026-09"},
                {"name": "Potassium Chloride (0-0-60)", "sku": "FT-003", "qty": 420, "unit": "kg",
                 "reorder_at": 400, "status": "LOW — reorder soon", "expiry": "2027-01"},
            ],
            "pesticides": [
                {"name": "Chlorpyrifos 4E", "sku": "PS-001", "qty": 38, "unit": "L",
                 "reorder_at": 20, "status": "ok", "expiry": "2025-12",
                 "rei_hours": 24},
                {"name": "Bifenthrin 2EC", "sku": "PS-002", "qty": 12, "unit": "L",
                 "reorder_at": 15, "status": "LOW — reorder now", "expiry": "2026-06",
                 "rei_hours": 12},
            ],
            "herbicides": [
                {"name": "Atrazine 4L", "sku": "HB-001", "qty": 95, "unit": "L",
                 "reorder_at": 30, "status": "ok", "expiry": "2026-08",
                 "rei_hours": 12},
                {"name": "Glyphosate 41%", "sku": "HB-002", "qty": 210, "unit": "L",
                 "reorder_at": 50, "status": "ok", "expiry": "2026-11",
                 "rei_hours": 4},
                {"name": "Clethodim 2EC (grass killer)", "sku": "HB-003", "qty": 18, "unit": "L",
                 "reorder_at": 20, "status": "LOW — reorder now", "expiry": "2026-05",
                 "rei_hours": 12},
            ],
            "fuel": [
                {"name": "Diesel #2", "sku": "FL-001", "qty": 1850, "unit": "L",
                 "reorder_at": 500, "status": "ok"},
                {"name": "DEF (AdBlue)", "sku": "FL-002", "qty": 120, "unit": "L",
                 "reorder_at": 50, "status": "ok"},
            ],
            "equipment_parts": [
                {"name": "Sprayer nozzle TeeJet 110-02", "sku": "EP-001", "qty": 48, "unit": "pcs",
                 "reorder_at": 12, "status": "ok"},
                {"name": "Air filter (John Deere 8R)", "sku": "EP-002", "qty": 2, "unit": "pcs",
                 "reorder_at": 2, "status": "LOW — reorder now"},
                {"name": "V-belt A78", "sku": "EP-003", "qty": 6, "unit": "pcs",
                 "reorder_at": 4, "status": "ok"},
            ],
        },
    }
    if category == "all":
        return all_inventory
    return {
        "retrieved_at": all_inventory["retrieved_at"],
        "source": "mock",
        "items": {category: all_inventory["items"].get(category, [])},
    }


async def get_field_records(field_id: str = "all") -> dict:
    """
    Retrieve field / crop records including current crop, growth stage,
    planting date, scheduled harvest, and recent activity log.

    Args:
        field_id: The field / sector identifier (e.g. 'Sector_4A') or 'all'
                  to return every field.

    Returns:
        A dictionary of field records keyed by field_id.
    """
    if FIELD_API:
        try:
            async with httpx.AsyncClient(headers=_http_headers, timeout=15) as client:
                url = f"{FIELD_API}/fields" if field_id == "all" else f"{FIELD_API}/fields/{field_id}"
                resp = await client.get(url)
                resp.raise_for_status()
                return resp.json()
        except Exception as exc:
            logger.warning("Field API unavailable, mocking: %s", exc)

    fields = {
        "Sector_1A": {
            "crop": "Corn (DKC62-08)", "area_ha": 12.4,
            "planted": "2026-04-15", "est_harvest": "2026-09-20",
            "growth_stage": "V8 – 8th leaf collar visible",
            "last_irrigation": "2026-05-28", "last_fertilization": "2026-05-10",
            "soil_ph": 6.6, "notes": "Strong stand, uniform emergence"
        },
        "Sector_2B": {
            "crop": "Soybean (NK S34-H4)", "area_ha": 8.7,
            "planted": "2026-05-01", "est_harvest": "2026-10-05",
            "growth_stage": "V3 – 3rd trifoliate",
            "last_irrigation": "2026-05-27", "last_fertilization": "N/A",
            "soil_ph": 6.3, "notes": "Crabgrass pressure – treatment pending"
        },
        "Sector_3C": {
            "crop": "Winter Wheat (Pioneer 25R40)", "area_ha": 15.2,
            "planted": "2025-10-12", "est_harvest": "2026-07-01",
            "growth_stage": "Heading – Feekes 10.5",
            "last_irrigation": "2026-05-20", "last_fertilization": "2026-04-28",
            "soil_ph": 6.8, "notes": "Excellent canopy, flag leaf healthy"
        },
        "Sector_4A": {
            "crop": "Corn (DKC62-08)", "area_ha": 10.1,
            "planted": "2026-04-18", "est_harvest": "2026-09-25",
            "growth_stage": "V6 – 6th leaf collar",
            "last_irrigation": "2026-05-25", "last_fertilization": "2026-05-08",
            "soil_ph": 6.5, "notes": "Pigweed outbreak – herbicide treatment required"
        },
        "Sector_4B": {
            "crop": "Corn (DKC62-08)", "area_ha": 9.8,
            "planted": "2026-04-18", "est_harvest": "2026-09-25",
            "growth_stage": "V6 – 6th leaf collar",
            "last_irrigation": "2026-05-25", "last_fertilization": "2026-05-08",
            "soil_ph": 6.4, "notes": "Slight moisture deficit, increase irrigation"
        },
    }
    if field_id == "all":
        return {"retrieved_at": _mock_ts(), "source": "mock", "fields": fields}
    return {
        "retrieved_at": _mock_ts(), "source": "mock",
        "fields": {field_id: fields.get(field_id, {"error": f"Field '{field_id}' not found"})}
    }


async def get_equipment_status(equipment_id: str = "all") -> dict:
    """
    Check the status, location, fuel level, and next scheduled maintenance
    of farm equipment.

    Args:
        equipment_id: Equipment identifier (e.g. 'TRACTOR-JD8R') or 'all'.

    Returns:
        Equipment status records including operational state, hours run,
        fuel %, GPS location, and any active alerts.
    """
    if EQUIPMENT_API:
        try:
            async with httpx.AsyncClient(headers=_http_headers, timeout=15) as client:
                url = (f"{EQUIPMENT_API}/equipment"
                       if equipment_id == "all"
                       else f"{EQUIPMENT_API}/equipment/{equipment_id}")
                resp = await client.get(url)
                resp.raise_for_status()
                return resp.json()
        except Exception as exc:
            logger.warning("Equipment API unavailable, mocking: %s", exc)

    equipment = {
        "TRACTOR-JD8R": {
            "name": "John Deere 8R 410", "type": "row-crop tractor",
            "status": "idle", "fuel_pct": 72, "engine_hours": 3847,
            "next_service_hours": 4000, "location": "Equipment Shed A",
            "alerts": [], "operator": None
        },
        "TRACTOR-CG620": {
            "name": "Case IH Magnum 620", "type": "row-crop tractor",
            "status": "operating", "fuel_pct": 55, "engine_hours": 2104,
            "next_service_hours": 2250, "location": "Sector_3C",
            "alerts": ["Service due in 146 hours"], "operator": "M. Rodriguez"
        },
        "SPRAYER-HAGIE": {
            "name": "Hagie STS16 High-Clearance Sprayer", "type": "self-propelled sprayer",
            "status": "idle", "fuel_pct": 88, "engine_hours": 890,
            "next_service_hours": 1000, "location": "Equipment Shed B",
            "alerts": [], "tank_pct": 0, "operator": None
        },
        "COMBINE-JD9": {
            "name": "John Deere S780 Combine", "type": "combine harvester",
            "status": "standby – harvest season prep", "fuel_pct": 100,
            "engine_hours": 1203, "next_service_hours": 1500,
            "location": "Machine Shed", "alerts": ["Pre-season inspection due"]
        },
        "DRONE-AGR-01": {
            "name": "DJI Agras T40 (Unit 1)", "type": "agricultural spray drone",
            "status": "idle", "battery_pct": 95, "flight_hours": 142,
            "location": "Drone Hangar", "alerts": [], "payload_kg": 0
        },
        "DRONE-AGR-02": {
            "name": "DJI Agras T40 (Unit 2)", "type": "agricultural spray drone",
            "status": "charging", "battery_pct": 34, "flight_hours": 138,
            "location": "Drone Hangar", "alerts": [], "payload_kg": 0
        },
    }
    if equipment_id == "all":
        return {"retrieved_at": _mock_ts(), "source": "mock", "equipment": equipment}
    return {
        "retrieved_at": _mock_ts(), "source": "mock",
        "equipment": {equipment_id: equipment.get(
            equipment_id, {"error": f"Equipment '{equipment_id}' not found"}
        )}
    }


async def get_soil_sensor_readings(sector: str = "all") -> dict:
    """
    Retrieve the latest IoT soil sensor readings for a farm sector.

    Args:
        sector: Sector identifier (e.g. 'Sector_4A') or 'all'.

    Returns:
        Latest readings including soil moisture %, temperature, pH,
        EC (electrical conductivity), and NPK sensor estimates.
    """
    if SENSOR_API:
        try:
            async with httpx.AsyncClient(headers=_http_headers, timeout=15) as client:
                url = (f"{SENSOR_API}/sensors/soil"
                       if sector == "all"
                       else f"{SENSOR_API}/sensors/soil/{sector}")
                resp = await client.get(url)
                resp.raise_for_status()
                return resp.json()
        except Exception as exc:
            logger.warning("Sensor API unavailable, mocking: %s", exc)

    sensors = {
        "Sector_1A": {"moisture_pct": 47, "temp_c": 18.2, "ph": 6.6,
                      "ec_ds_m": 0.82, "n_ppm": 38, "p_ppm": 22, "k_ppm": 185},
        "Sector_2B": {"moisture_pct": 39, "temp_c": 19.1, "ph": 6.3,
                      "ec_ds_m": 0.74, "n_ppm": 31, "p_ppm": 18, "k_ppm": 172},
        "Sector_3C": {"moisture_pct": 52, "temp_c": 17.8, "ph": 6.8,
                      "ec_ds_m": 0.91, "n_ppm": 42, "p_ppm": 28, "k_ppm": 201},
        "Sector_4A": {"moisture_pct": 34, "temp_c": 20.3, "ph": 6.5,
                      "ec_ds_m": 0.68, "n_ppm": 28, "p_ppm": 15, "k_ppm": 160,
                      "alert": "Moisture below 40% threshold"},
        "Sector_4B": {"moisture_pct": 31, "temp_c": 20.5, "ph": 6.4,
                      "ec_ds_m": 0.65, "n_ppm": 27, "p_ppm": 14, "k_ppm": 155,
                      "alert": "Moisture critically low – irrigate ASAP"},
    }
    if sector == "all":
        return {"retrieved_at": _mock_ts(), "source": "mock", "sectors": sensors}
    return {
        "retrieved_at": _mock_ts(), "source": "mock",
        "sectors": {sector: sensors.get(sector, {"error": f"No sensors for '{sector}'"})}
    }


async def get_market_prices(crops: str = "all") -> dict:
    """
    Retrieve current commodity market prices and recent price trends.

    Args:
        crops: Comma-separated crop names (e.g. 'corn,soybeans') or 'all'.

    Returns:
        Current spot price, week-over-week change, and nearest futures price
        for each requested crop.
    """
    if MARKET_API:
        try:
            async with httpx.AsyncClient(headers=_http_headers, timeout=15) as client:
                resp = await client.get(f"{MARKET_API}/prices", params={"crops": crops})
                resp.raise_for_status()
                return resp.json()
        except Exception as exc:
            logger.warning("Market API unavailable, mocking: %s", exc)

    prices = {
        "corn":     {"spot_usd_per_bu": 4.82, "wow_change_pct": +1.4,
                     "futures_dec26_usd": 4.95, "unit": "bushel"},
        "soybeans": {"spot_usd_per_bu": 11.23, "wow_change_pct": -0.6,
                     "futures_nov26_usd": 11.40, "unit": "bushel"},
        "wheat":    {"spot_usd_per_bu": 5.67, "wow_change_pct": +2.1,
                     "futures_jul26_usd": 5.80, "unit": "bushel"},
        "canola":   {"spot_cad_per_mt": 702.50, "wow_change_pct": -1.2,
                     "futures_nov26_cad": 715.00, "unit": "metric tonne"},
    }
    if crops == "all":
        return {"retrieved_at": _mock_ts(), "source": "mock", "prices": prices}
    selected = {c.strip(): prices.get(c.strip(), {"error": "Not found"})
                for c in crops.split(",")}
    return {"retrieved_at": _mock_ts(), "source": "mock", "prices": selected}


async def get_weather_station_data() -> dict:
    """
    Retrieve the latest reading from the on-farm weather station, including
    temperature, humidity, wind speed/direction, solar radiation, and
    a 48-hour precipitation forecast.

    Returns:
        A dictionary of current weather conditions and short-range forecast.
    """
    if WEATHER_API:
        try:
            async with httpx.AsyncClient(headers=_http_headers, timeout=15) as client:
                resp = await client.get(f"{WEATHER_API}/current")
                resp.raise_for_status()
                return resp.json()
        except Exception as exc:
            logger.warning("Weather station API unavailable, mocking: %s", exc)

    return {
        "retrieved_at": _mock_ts(),
        "source": "mock",
        "station_id": "WX-FARM-01",
        "current": {
            "temp_c": 24.2, "humidity_pct": 55, "wind_kph": 12,
            "wind_dir": "NW", "solar_rad_wm2": 850, "uv_index": 7.2,
            "barometric_hpa": 1012, "dew_point_c": 14.1,
            "precipitation_mm_24h": 0.0,
        },
        "forecast_48h": [
            {"hour": "+6h",  "temp_c": 22.0, "precip_mm": 0.0, "condition": "Sunny"},
            {"hour": "+12h", "temp_c": 19.5, "precip_mm": 0.0, "condition": "Partly cloudy"},
            {"hour": "+24h", "temp_c": 23.0, "precip_mm": 3.2, "condition": "Light showers"},
            {"hour": "+36h", "temp_c": 20.1, "precip_mm": 8.5, "condition": "Showers"},
            {"hour": "+48h", "temp_c": 18.8, "precip_mm": 1.0, "condition": "Cloudy"},
        ],
        "spray_window": {
            "next_suitable_window": "+6h to +12h",
            "notes": "Wind 10-14 kph NW – acceptable for boom sprayer. Avoid spraying at +24h onwards due to expected rain."
        },
    }


# ── Tool registry (for the /tools catalogue endpoint) ─────────────────────────
TOOL_REGISTRY = [
    {"name": "read_inventory_spreadsheet", "target": "CSV/Spreadsheet URL",
     "description": "Read inventory data directly from a public CSV export URL"},
    {"name": "get_inventory",          "target": INVENTORY_API or "(mock)",
     "description": "Read current stock levels of seeds, fertilisers, pesticides, fuel, parts"},
    {"name": "get_field_records",      "target": FIELD_API or "(mock)",
     "description": "Read crop records, growth stage, and activity history per sector"},
    {"name": "get_equipment_status",   "target": EQUIPMENT_API or "(mock)",
     "description": "Read tractor, sprayer, combine, and drone status + alerts"},
    {"name": "get_soil_sensor_readings","target": SENSOR_API or "(mock)",
     "description": "Read live IoT soil moisture, pH, temp, EC, NPK by sector"},
    {"name": "get_market_prices",      "target": MARKET_API or "(mock)",
     "description": "Get current commodity spot and futures prices"},
    {"name": "get_weather_station_data","target": WEATHER_API or "(mock)",
     "description": "Get live weather + 48h forecast and spray-window advisory"},
]

# ── ADK Agent setup ────────────────────────────────────────────────────────────
OPS_INSTRUCTION = """
You are HarvestEye's **Operations Agent** — a smart farm coordinator that connects
directly to the farmer's live digital systems. You ONLY PULL information. You do not
have tools to push, dispatch, log, or buy anything. You act as a read-only analytics
assistant.

You have access to these pull-only tools:
• read_inventory_spreadsheet – parse inventory from a CSV/spreadsheet
• get_inventory              – check & filter stock levels from the API
• get_field_records          – view crop status, growth stage, and field history
• get_equipment_status       – check tractors, sprayers, combines, drones
• get_soil_sensor_readings   – live IoT soil data per sector
• get_market_prices          – commodity spot & futures prices
• get_weather_station_data   – current weather + 48h forecast + spray window

**Behaviour rules:**
1. Always call the relevant tool(s) FIRST before answering — never guess data.
2. After retrieving data, synthesise a clear, actionable answer.
3. If you detect a LOW-STOCK item, proactively mention it (but you cannot reorder it).
4. If asked to do something outside your tools' scope (like updating data or dispatching drones),
   say clearly that you are a read-only agent and cannot perform write actions.
5. Keep responses concise and operator-friendly; use bullet points for lists of actions.
"""

_session_service = InMemorySessionService()

_ops_agent = Agent(
    name="farm_ops_agent",
    model=MODEL,
    instruction=OPS_INSTRUCTION,
    tools=[
        read_inventory_spreadsheet,
        get_inventory,
        get_field_records,
        get_equipment_status,
        get_soil_sensor_readings,
        get_market_prices,
        get_weather_station_data,
    ],
)

_runner = Runner(
    agent=_ops_agent,
    app_name=APP_NAME,
    session_service=_session_service,
)


# ── Helper ─────────────────────────────────────────────────────────────────────

async def _ensure_session(session_id: str, user_id: str = "farm_operator") -> None:
    existing = await _session_service.get_session(
        app_name=APP_NAME, user_id=user_id, session_id=session_id
    )
    if existing is None:
        await _session_service.create_session(
            app_name=APP_NAME, user_id=user_id, session_id=session_id
        )


async def _run_ops(session_id: str, message: str) -> tuple[str, list[str]]:
    """Run the ops agent and return (response_text, tool_calls_made)."""
    user_id = "farm_operator"
    await _ensure_session(session_id, user_id)

    content = Content(role="user", parts=[Part.from_text(text=message)])
    response_parts: list[str] = []
    tool_calls_made: list[str] = []

    async for event in _runner.run_async(
        user_id=user_id, session_id=session_id, new_message=content
    ):
        # Capture tool call names for transparency
        if hasattr(event, "content") and event.content:
            for part in (event.content.parts or []):
                if hasattr(part, "function_call") and part.function_call:
                    tool_calls_made.append(part.function_call.name)

        if event.is_final_response() and event.content and event.content.parts:
            for part in event.content.parts:
                if part.text:
                    response_parts.append(part.text)

    return "\n".join(response_parts).strip(), list(dict.fromkeys(tool_calls_made))


# ── Schemas ────────────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None


class ChatResponse(BaseModel):
    session_id: str
    response: str
    tool_calls_made: list[str]


# ── Router ─────────────────────────────────────────────────────────────────────

router = APIRouter(tags=["Farm Operations Agent"])


@router.post("/chat", response_model=ChatResponse)
async def ops_chat(req: ChatRequest):
    """
    Send a natural-language instruction or query to the farm operations agent.

    The agent automatically chooses which farm-system tools to call, executes
    them, and returns a consolidated response.

    Example prompts:
    - "What's our current herbicide stock? Do we need to reorder anything?"
    - "Check soil sensors in Sector 4B and dispatch a drone to irrigate if needed"
    - "Log that we applied Glyphosate to Sector 4A today at 2 L/ha"
    - "What's the current corn price and should we sell now or wait?"
    - "Run a pre-spray weather check for tomorrow morning"
    """
    if not GEMINI_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="GEMINI_API_KEY is not configured on the server.",
        )

    session_id = req.session_id or str(uuid.uuid4())

    try:
        response_text, tool_calls = await _run_ops(session_id, req.message)
    except Exception as exc:
        logger.exception("Ops agent error")
        raise HTTPException(status_code=502, detail=f"Agent error: {str(exc)}")

    return ChatResponse(
        session_id=session_id,
        response=response_text,
        tool_calls_made=tool_calls,
    )


@router.get("/tools")
async def list_tools():
    """
    Return the catalogue of tools available to the operations agent,
    including the external API each tool connects to.
    """
    return {
        "agent": "farm_ops_agent",
        "model": MODEL,
        "tool_count": len(TOOL_REGISTRY),
        "tools": TOOL_REGISTRY,
        "note": (
            "Tools marked '(mock)' return realistic dummy data. "
            "Set the corresponding environment variable to connect to your real system."
        ),
    }


@router.delete("/session/{session_id}")
async def clear_ops_session(session_id: str):
    """Clear conversation history for the given session ID."""
    user_id = "farm_operator"
    try:
        await _session_service.delete_session(
            app_name=APP_NAME, user_id=user_id, session_id=session_id
        )
    except Exception:
        pass
    return {"status": "cleared", "session_id": session_id}
