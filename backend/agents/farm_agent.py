"""
farm_agent.py
~~~~~~~~~~~~~
A Google ADK-powered research agent that performs live web research on
soil health, crop diseases, pests, irrigation, and other farm topics.

Exposes a FastAPI router so it can be mounted onto the existing main.py app:

    from agents.farm_agent import router as agent_router
    app.include_router(agent_router, prefix="/api/agent")

Endpoints
---------
POST /api/agent/research
    Body: { "query": "...", "session_id": "optional-uuid" }
    Returns: { "session_id": "...", "response": "...", "sources": [...] }

POST /api/agent/suggest
    Body: { "context": "...", "session_id": "optional-uuid" }
    Returns: { "session_id": "...", "suggestions": [...] }

DELETE /api/agent/session/{session_id}
    Clears the conversation history for the given session.
"""

import os
import uuid
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# ── Google ADK imports ────────────────────────────────────────────────────────
from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.tools import google_search
from google.genai.types import Content, Part

logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
if GEMINI_API_KEY:
    os.environ["GOOGLE_API_KEY"] = GEMINI_API_KEY   # ADK uses GOOGLE_API_KEY

APP_NAME = "harveteye_farm_agent"
MODEL = "gemini-2.0-flash"

RESEARCH_INSTRUCTION = """
You are HarvestEye's expert agricultural research assistant with deep knowledge in:
- Soil science: pH, macronutrients (N/P/K), micronutrients, organic matter, soil microbiology
- Crop agronomy: growth stages, nutrient management, yield optimisation
- Plant pathology: fungal/bacterial/viral diseases, diagnosis, and treatment
- Integrated Pest Management (IPM): identification, thresholds, biological and chemical controls
- Irrigation: drip, sprinkler, flood; water scheduling, salinity management
- Climate-smart farming: cover cropping, no-till, carbon sequestration
- Sustainable inputs: organic fertilisers, biopesticides, soil amendments

When answering, ALWAYS:
1. Use the google_search tool to retrieve the most current research, extension service
   bulletins, and peer-reviewed recommendations before responding.
2. Cite your sources clearly at the end of every response in a "**Sources**" section.
3. Provide concrete, actionable advice tailored to the specific crop/region mentioned.
4. Flag any safety considerations (chemical handling, re-entry intervals, etc.).
5. Keep your tone practical and farmer-friendly while staying scientifically accurate.
"""

SUGGESTION_INSTRUCTION = """
You are HarvestEye's proactive farm advisor. Given a summary of current farm conditions
(photos analysis, sensor data, recent observations), use google_search to research the
latest best practices and generate a prioritised list of actionable improvement suggestions.

Format your output as a numbered list where each item follows this structure:
  [Priority: High/Medium/Low] **Action title**
  - What to do and why
  - Estimated timeline
  - Expected benefit

Search for and cite the most recent (last 2 years) extension service publications, 
university research, or government agricultural bulletins to back your recommendations.
"""

# ── Shared ADK singletons (created once at module load) ───────────────────────
_session_service = InMemorySessionService()

_research_agent = Agent(
    name="farm_research_agent",
    model=MODEL,
    instruction=RESEARCH_INSTRUCTION,
    tools=[google_search],
)

_suggestion_agent = Agent(
    name="farm_suggestion_agent",
    model=MODEL,
    instruction=SUGGESTION_INSTRUCTION,
    tools=[google_search],
)

_research_runner = Runner(
    agent=_research_agent,
    app_name=APP_NAME,
    session_service=_session_service,
)

_suggestion_runner = Runner(
    agent=_suggestion_agent,
    app_name=APP_NAME,
    session_service=_session_service,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _ensure_session(session_id: str, user_id: str = "farm_user") -> None:
    """Create the ADK session if it does not yet exist."""
    existing = await _session_service.get_session(
        app_name=APP_NAME, user_id=user_id, session_id=session_id
    )
    if existing is None:
        await _session_service.create_session(
            app_name=APP_NAME, user_id=user_id, session_id=session_id
        )


async def _run_agent(runner: Runner, session_id: str, message: str) -> tuple[str, list[str]]:
    """
    Run an ADK agent and return (response_text, list_of_source_urls).
    """
    user_id = "farm_user"
    await _ensure_session(session_id, user_id)

    content = Content(role="user", parts=[Part.from_text(text=message)])

    response_parts: list[str] = []

    async for event in runner.run_async(
        user_id=user_id,
        session_id=session_id,
        new_message=content,
    ):
        if event.is_final_response() and event.content and event.content.parts:
            for part in event.content.parts:
                if part.text:
                    response_parts.append(part.text)

    full_response = "\n".join(response_parts).strip()

    # Extract any URLs from the response for the sources field
    import re
    urls = re.findall(r"https?://[^\s\)\]\>\"\']+", full_response)
    sources = list(dict.fromkeys(urls))  # deduplicate, preserve order

    return full_response, sources


# ── Request / Response schemas ─────────────────────────────────────────────────

class ResearchRequest(BaseModel):
    query: str
    session_id: Optional[str] = None


class ResearchResponse(BaseModel):
    session_id: str
    response: str
    sources: list[str]


class SuggestRequest(BaseModel):
    context: str
    session_id: Optional[str] = None


class SuggestResponse(BaseModel):
    session_id: str
    suggestions: str
    sources: list[str]


# ── Router ────────────────────────────────────────────────────────────────────

router = APIRouter(tags=["Farm Research Agent"])


@router.post("/research", response_model=ResearchResponse)
async def research_topic(req: ResearchRequest):
    """
    Perform live web research on any farm/soil/crop topic.

    The agent uses Google Search to fetch current knowledge and synthesises
    an actionable answer with cited sources.
    """
    if not GEMINI_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="GEMINI_API_KEY is not configured on the server.",
        )

    session_id = req.session_id or str(uuid.uuid4())

    try:
        response_text, sources = await _run_agent(
            _research_runner, session_id, req.query
        )
    except Exception as exc:
        logger.exception("Farm research agent error")
        raise HTTPException(status_code=502, detail=f"Agent error: {str(exc)}")

    return ResearchResponse(
        session_id=session_id,
        response=response_text,
        sources=sources,
    )


@router.post("/suggest", response_model=SuggestResponse)
async def suggest_improvements(req: SuggestRequest):
    """
    Given farm condition context (e.g. from photo analysis), produce a
    prioritised list of research-backed improvement suggestions.
    """
    if not GEMINI_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="GEMINI_API_KEY is not configured on the server.",
        )

    session_id = req.session_id or str(uuid.uuid4())

    prompt = (
        "Here is the current farm condition summary:\n\n"
        f"{req.context}\n\n"
        "Please research current best practices and provide prioritised, "
        "actionable suggestions to improve farm health and productivity."
    )

    try:
        response_text, sources = await _run_agent(
            _suggestion_runner, session_id, prompt
        )
    except Exception as exc:
        logger.exception("Farm suggestion agent error")
        raise HTTPException(status_code=502, detail=f"Agent error: {str(exc)}")

    return SuggestResponse(
        session_id=session_id,
        suggestions=response_text,
        sources=sources,
    )


@router.delete("/session/{session_id}")
async def clear_session(session_id: str):
    """Delete all conversation history for the given session ID."""
    user_id = "farm_user"
    try:
        await _session_service.delete_session(
            app_name=APP_NAME, user_id=user_id, session_id=session_id
        )
    except Exception:
        pass  # session may not exist; that's fine
    return {"status": "cleared", "session_id": session_id}
