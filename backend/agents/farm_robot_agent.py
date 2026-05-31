"""
farm_robot_agent.py
~~~~~~~~~~~~~~~~~~~
A Google ADK agent that coordinates a theoretical autonomous farm robot.
It is capable of moving to specific real-world locations (sectors/coordinates),
identifying weeds, picking them, or spraying specific amounts of fertilizer.

Mounted onto main.py as:

    from agents.farm_robot_agent import router as robot_router
    app.include_router(robot_router, prefix="/api/robot")

Endpoints
---------
POST /api/robot/command
    Body  : { "message": "...", "session_id": "opt-uuid" }
    Returns: { "session_id": "...", "response": "...", "tool_calls_made": [...] }

DELETE /api/robot/session/{session_id}
    Clears conversation history for the session.
"""

from __future__ import annotations

import logging
import uuid
import os
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# ── Google ADK ────────────────────────────────────────────────────────────────
from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai.types import Content, Part

logger = logging.getLogger(__name__)

GEMINI_API_KEY   = os.getenv("GEMINI_API_KEY", "")
if GEMINI_API_KEY:
    os.environ["GOOGLE_API_KEY"] = GEMINI_API_KEY

APP_NAME = "harvesteye_robot_agent"
MODEL    = "gemini-1.5-flash"


# ═══════════════════════════════════════════════════════════════════════════════
#  TOOL FUNCTIONS (Mock Hardware Drivers)
# ═══════════════════════════════════════════════════════════════════════════════

async def get_robot_status() -> dict:
    """
    Check the current status, battery level, payload, and location of the autonomous robot.
    """
    return {
        "status": "idle",
        "battery_pct": 87,
        "location": "Base Station",
        "current_task": None,
        "payloads": {
            "herbicide_tank_pct": 100,
            "fertilizer_tank_pct": 100,
            "weed_collection_bin_pct": 0
        }
    }


async def move_to_location(sector: str, latitude: float = None, longitude: float = None) -> dict:
    """
    Command the robot to navigate to a specific sector or exact GPS coordinates.
    
    Args:
        sector: The farm sector to move to (e.g. 'Sector_4A').
        latitude: Optional precise GPS latitude.
        longitude: Optional precise GPS longitude.
    """
    dest = f"Sector {sector}" if not latitude else f"Coordinates ({latitude}, {longitude}) in Sector {sector}"
    return {
        "status": "arrived",
        "message": f"Successfully navigated avoiding obstacles to {dest}.",
        "time_taken_seconds": 124,
        "battery_cost_pct": 2
    }


async def pull_weed(weed_type: str, quantity: int) -> dict:
    """
    Use the robot's physical manipulators to safely extract weeds from the soil 
    without damaging surrounding crops.
    
    Args:
        weed_type: The type of weed to identify and pull (e.g. 'Pigweed', 'Crabgrass').
        quantity: The estimated number of weeds to pull in the immediate vicinity.
    """
    return {
        "action": "pull_weed",
        "target": weed_type,
        "extracted_count": quantity,
        "message": f"Successfully identified and extracted {quantity} {weed_type} plants. Roots removed intact.",
        "bin_capacity_used_pct": 5
    }


async def spray_chemical(chemical_type: str, volume_liters: float, target_area: str) -> dict:
    """
    Use the robot's precision micro-sprayers to apply fertilizer or herbicide to a targeted area.
    
    Args:
        chemical_type: What to spray (e.g. 'Nitrogen Fertilizer', 'Glyphosate').
        volume_liters: Amount of chemical to apply.
        target_area: Description of the target (e.g. 'Corn roots in Sector 4A').
    """
    return {
        "action": "spray_chemical",
        "chemical": chemical_type,
        "volume_applied": volume_liters,
        "target": target_area,
        "message": f"Precision applied {volume_liters}L of {chemical_type} to {target_area}. Micro-spray prevented drift.",
        "tank_remaining_pct": 95
    }


# ── ADK Agent setup ────────────────────────────────────────────────────────────
ROBOT_INSTRUCTION = """
You are the central intelligence for HarvestEye's **Autonomous Farm Robot**. 
You command a highly advanced physical robot capable of navigating the farm, picking weeds, and precision-spraying chemicals.

You have access to these hardware interface tools:
• get_robot_status   – check battery, location, and payload levels.
• move_to_location   – command the robot to drive to a specific sector or GPS coordinate.
• pull_weed          – use robotic manipulators to physically pull weeds.
• spray_chemical     – use precision micro-sprayers to apply fertilizer or herbicide.

**Behaviour rules:**
1. Always check `get_robot_status` first if you need to know where you are or your battery levels.
2. You must `move_to_location` before you can pull weeds or spray in a new area.
3. Be direct and confirm the actions you have executed in the physical world. 
4. Synthesise your tool results into a concise mission report for the farmer.
"""

_session_service = InMemorySessionService()

_robot_agent = Agent(
    name="farm_robot_agent",
    model=MODEL,
    instruction=ROBOT_INSTRUCTION,
    tools=[
        get_robot_status,
        move_to_location,
        pull_weed,
        spray_chemical,
    ],
)

_runner = Runner(
    agent=_robot_agent,
    app_name=APP_NAME,
    session_service=_session_service,
)


# ── Helper ─────────────────────────────────────────────────────────────────────

async def _ensure_session(session_id: str, user_id: str = "robot_operator") -> None:
    existing = await _session_service.get_session(
        app_name=APP_NAME, user_id=user_id, session_id=session_id
    )
    if existing is None:
        await _session_service.create_session(
            app_name=APP_NAME, user_id=user_id, session_id=session_id
        )


async def _run_robot(session_id: str, message: str) -> tuple[str, list[str]]:
    """Run the robot agent and return (response_text, tool_calls_made)."""
    user_id = "robot_operator"
    await _ensure_session(session_id, user_id)

    content = Content(role="user", parts=[Part.from_text(text=message)])
    response_parts: list[str] = []
    tool_calls_made: list[str] = []

    async for event in _runner.run_async(
        user_id=user_id, session_id=session_id, new_message=content
    ):
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

class CommandRequest(BaseModel):
    message: str
    session_id: Optional[str] = None


class CommandResponse(BaseModel):
    session_id: str
    response: str
    tool_calls_made: list[str]


# ── Router ─────────────────────────────────────────────────────────────────────

router = APIRouter(tags=["Farm Robot Agent"])


@router.post("/command", response_model=CommandResponse)
async def robot_command(req: CommandRequest):
    """
    Send natural-language missions to the autonomous farm robot.
    The agent will break down the mission into physical movement and action tool calls.
    """
    if not GEMINI_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="GEMINI_API_KEY is not configured.",
        )

    session_id = req.session_id or str(uuid.uuid4())

    try:
        response_text, tool_calls = await _run_robot(session_id, req.message)
    except Exception as exc:
        logger.exception("Robot agent error")
        raise HTTPException(status_code=502, detail=f"Hardware failure: {str(exc)}")

    return CommandResponse(
        session_id=session_id,
        response=response_text,
        tool_calls_made=tool_calls,
    )


@router.delete("/session/{session_id}")
async def clear_robot_session(session_id: str):
    user_id = "robot_operator"
    try:
        await _session_service.delete_session(
            app_name=APP_NAME, user_id=user_id, session_id=session_id
        )
    except Exception:
        pass
    return {"status": "cleared", "session_id": session_id}
