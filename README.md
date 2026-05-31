# 🌾 HarvestEye

> **QuackHacks 2026** — Gemini-powered precision agriculture platform built with real-world farm data.

HarvestEye is an intelligent farm monitoring and analysis system that combines **3D Gaussian Splatting** visualization with a **dual-agent Gemini AI architecture** to give farmers actionable, real-time insights on crop health, weed threats, soil conditions, and environmental conditions — all rendered in an immersive 3D farm interface.

We went **in person to multiple farms** to collect real-world data to power the platform.

---

## ✨ Features

- **3D Gaussian Splatting Viewer** — Immersive, photorealistic 3D reconstruction of real farm environments captured on-site
- **Live Farm Dashboard** — HUD overlay with soil health analytics, weed identification, ambient conditions, and meteorological data
- **Dual-Agent AI Analysis** — Two parallel agentic workflows process uploaded farm photos in batches, then aggregate results into a unified report
- **Weed Identification & Treatment** — Detects weed species (Pigweed, Crabgrass), displays botanical info, and lets you dispatch an autonomous robot with a chosen treatment plan
- **AI Farm Analysis Report** — Full markdown report with per-category health scores (moisture, nutrients, temperature, weed presence) rendered in a polished document view
- **Camera Mode Toggle** — Switch between perspective and top-down views of the 3D farm model

---

## 🏗️ Architecture

### Dual-Agent AI Pipeline

```
Photos (1–20)
      │
      ▼
┌─────────────────────────────────────────────────────┐
│                  FastAPI Backend                    │
│                                                     │
│   Batch 1 (Photos 1–10)  →  Gemini Agent 1  ─────┐ │
│                                                   ├─┤─→ Aggregated Report
│   Batch 2 (Photos 11–20) →  Gemini Agent 2  ─────┘ │
│                                                     │
└─────────────────────────────────────────────────────┘
```

Both agents run **in parallel** (`asyncio.gather`) using `gemini-2.0-flash`, each analyzing up to 10 images with detailed agricultural prompts covering crop health, weed detection, soil conditions, and pest damage.

### Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React + TypeScript (Vite), React Router, Lucide Icons, TailwindCSS |
| **3D Rendering** | 3D Gaussian Splatting (custom WebGL viewer) |
| **Backend** | FastAPI (Python), `httpx` async HTTP client |
| **AI** | Google Gemini 2.0 Flash (via REST API) |
| **Markdown** | `react-markdown` + `remark-gfm` |

### Project Structure

```
farm/
├── frontend/
│   └── src/
│       ├── App.tsx          # Routing (/ dashboard, /report)
│       ├── Overlay.tsx      # 3D viewer HUD + dashboard panels
│       ├── Report.tsx       # AI analysis report page
│       ├── reportData.json  # Sample report data + health scores
│       └── app.css / index.css
└── backend/
    ├── main.py              # FastAPI app + dual-agent Gemini pipeline
    ├── requirements.txt
    └── .env                 # GEMINI_API_KEY
```

---

## 🚀 How to Run

### Prerequisites

- Node.js ≥ 18
- Python ≥ 3.10
- A [Google Gemini API key](https://aistudio.google.com/app/apikey)

### 1. Backend

```bash
cd backend
```

Add your API key to `.env`:

```
GEMINI_API_KEY=your_key_here
```

Install dependencies and start the server:

```bash
pip install -r requirements.txt
uvicorn main:app --reload
```

The API will be available at `http://localhost:8000`.

**Endpoints:**
- `GET  /api/health` — Health check
- `POST /api/analyze` — Upload 1–20 farm photos for dual-agent AI analysis

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

The app will be available at `http://localhost:5173`.

---

## 🤖 API Usage

```bash
# Analyze up to 20 farm photos
curl -X POST http://localhost:8000/api/analyze \
  -F "photos=@field1.jpg" \
  -F "photos=@field2.jpg"
```

Response:
```json
{
  "total_photos": 2,
  "batches_processed": 1,
  "results": [
    {
      "batch": "Batch 1 (Photos 1–10)",
      "analysis": "## Crop Health Assessment\n..."
    }
  ]
}
```

---

## 👥 Team

Built at **QuackHacks 2026** 🦆
