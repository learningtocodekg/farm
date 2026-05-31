from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from agents.farm_agent import router as agent_router
from agents.farm_ops_agent import router as ops_router
from agents.farm_robot_agent import router as robot_router
from gemini_logic import router as gemini_router

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

# Mount the Gemini analysis route
app.include_router(gemini_router, prefix="/api")

@app.get("/api/health")
def health():
    return {"status": "ok"}
