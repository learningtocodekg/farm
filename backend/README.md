# Backend Documentation

## Simplified Version

### What is this?
This is a FastAPI backend designed to process and analyze images of farm crops using the Gemini AI model, as well as coordinate various farm operations through specialized agents.

### How to Run
1. Navigate to the `backend/` directory.
2. Ensure your `.env` file contains your Gemini API key:
   ```env
   GEMINI_API_KEY=your_api_key_here
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Start the server:
   ```bash
   uvicorn main:app --reload
   ```
   The API will be available at `http://localhost:8000`.

### Key Features
- **Point-Based Anomaly Detection**: Upload photos in multiples of 4 (North, South, East, West views). The backend uses Gemini to return exactly which direction has a crop anomaly (e.g., weeds, pests).
- **Specialized Agents**: Routes requests to hardware robot agents, farm ops agents, and research agents.

---

## Detailed Version

### Architecture Overview
The backend is built with **FastAPI** and is split into two primary domains:
1. **Gemini Logic (`gemini_logic.py`)**: AI-powered photo analysis.
2. **Farm Agents (`agents/`)**: Distinct sub-agents (Operations, Research, Robot) that handle specific workflows.

### The `/api/analyze` Endpoint (Gemini Integration)
The core feature of this backend is its ability to perform directional point-based anomaly detection.

**How it works:**
- The frontend sends a batch of JPEG photos to the `/api/analyze` endpoint.
- The backend enforces that the total number of photos is a multiple of 4.
- Each group of 4 photos represents a **Point** on the farm. Within each Point, the images are strictly assumed to represent the **North**, **South**, **East**, and **West** views.
- The `gemini_logic.py` module constructs a prompt for the Gemini 2.0 Flash model, explicitly labeling the 4 images with their respective directions.
- Gemini processes the prompt and returns a strictly formatted **JSON response**.

**Example Gemini Output Structure:**
```json
{
  "total_photos": 4,
  "total_points": 1,
  "results": [
    {
      "point": "Point 1",
      "analysis": {
        "anomalies_detected": true,
        "details": [
          {
            "direction": "North",
            "anomaly_type": "weed",
            "description": "Broadleaf weed detected near crop base",
            "severity": "medium"
          }
        ],
        "overall_assessment": "Generally healthy except for weeds in the North view."
      }
    }
  ]
}
```

### The Agent Routers
The `main.py` file serves as the core router, mounting various specialized sub-modules from the `agents/` directory to keep the application organized:

- **`/api/agent` (`agents/farm_agent.py`)**: General research and reasoning tasks.
- **`/api/ops-agent` (`agents/farm_ops_agent.py`)**: Pull-only operations, designed to handle background data retrieval and daily logs.
- **`/api/robot` (`agents/farm_robot_agent.py`)**: Direct communication and coordination with autonomous hardware/robots roaming the farm.

### Configuration and Environment
All secrets and variables are expected to be in a local `.env` file at the root of the `backend/` directory.

```env
GEMINI_API_KEY=your_google_gemini_api_key
```
If the API key is missing or invalid, the `/api/analyze` endpoint will safely catch this and return a `500 Internal Server Error` detailing the missing configuration.
