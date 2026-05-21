from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database.db import engine
from database import models
from routers import products, chat, analytics

# ── Create all DB tables on startup ──────────────────────────────────────────
models.Base.metadata.create_all(bind=engine)

# ── App init ──────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Conversational Shopping Assistant API",
    description=(
        "RL-powered chatbot backend that asks clarifying questions to narrow "
        "product recommendations. Built with FastAPI, SQLAlchemy, and a "
        "Contextual Bandit / DQN agent."
    ),
    version="0.1.0",
)

# ── CORS — allow React dev server ─────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],   # React frontend
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(products.router)
app.include_router(chat.router)
app.include_router(analytics.router)


# ── Root ──────────────────────────────────────────────────────────────────────
@app.get("/", tags=["health"])
def root():
    return {
        "status": "ok",
        "message": "Conversational Shopping Assistant API is running.",
        "docs": "/docs",
        "phases": {
            "phase_1": "✅ FastAPI skeleton + SQLite + Product catalog",
            "phase_2": "⏳ NLU service (HuggingFace BERT)",
            "phase_3": "⏳ RL Contextual Bandit agent",
            "phase_4": "⏳ Chat router wiring",
            "phase_5": "⏳ Analytics + comparison endpoint",
            "phase_6": "⏳ React frontend",
        }
    }


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok"}