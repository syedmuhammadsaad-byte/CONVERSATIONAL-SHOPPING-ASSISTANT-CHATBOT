"""
Chat Router — Phase 4 (fixed)
==============================
Wires NLU → RL Agent → Recommender → SQLite.

Key fixes:
  - Intent passed to select_action so greeting/goodbye handled correctly
  - 'greet' pseudo-action returns friendly greeting without asking questions
  - Auto-reward fires on every turn based on previous action + current reply
  - history format verified to match what rl_agent expects
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.db import get_db
from database.models import CartItem, Conversation, RLState, User
from services.nlu import NLUService, UserIntent
from services.recommender import Recommender
from services.rl_agent import RLAgent, Reward

router = APIRouter(prefix="/chat", tags=["chat"])


# ═══════════════════════════════════════════════════════════════════════════
# Schemas
# ═══════════════════════════════════════════════════════════════════════════

class CartItemInput(BaseModel):
    product_id: int
    quantity: int = 1

class ChatRequest(BaseModel):
    session_id: str = ""
    message: str
    cart: List[CartItemInput] = []

class ChatResponse(BaseModel):
    session_id: str
    bot_message: str
    action: str
    products: List[Dict[str, Any]] = []
    turn_number: int
    rl_state_id: Optional[int] = None

class RewardRequest(BaseModel):
    session_id: str
    rl_state_id: int
    reward_type: str

class AnalyzeRequest(BaseModel):
    message: str


# ═══════════════════════════════════════════════════════════════════════════
# Constants
# ═══════════════════════════════════════════════════════════════════════════

REWARD_MAP: Dict[str, float] = {
    "purchase_completed": Reward.PURCHASE_COMPLETED,
    "add_to_cart":        Reward.ADD_TO_CART,
    "informative_answer": Reward.INFORMATIVE_ANSWER,
    "user_abandons":      Reward.USER_ABANDONS,
    "repeated_question":  Reward.REPEATED_QUESTION,
}

GREETINGS = [
    "Hi there! 👋 I'm ShopBot, your AI shopping assistant. What are you looking for today?",
    "Hello! 😊 Tell me what you need and I'll find the best options for you.",
    "Hey! Great to see you. What can I help you find today?",
]

import random as _random


# ═══════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════

def _utcnow():
    return datetime.now(timezone.utc)

def _get_or_create_user(session_id: str, db: Session) -> User:
    user = db.query(User).filter(User.session_id == session_id).first()
    if not user:
        user = User(session_id=session_id, created_at=_utcnow())
        db.add(user)
        db.flush()
    return user


def _load_history(user: User, db: Session, limit: int = 10) -> List[dict]:
    """
    Load last `limit` turns as list of dicts.
    Assistant turns include 'action' key — critical for repeated-question guard.
    """
    rows = (
        db.query(Conversation)
        .filter(Conversation.user_id == user.id)
        .order_by(Conversation.timestamp.desc())
        .limit(limit)
        .all()
    )
    rows.reverse()
    history = []
    for r in rows:
        entry: dict = {"role": r.role, "message": r.message}
        if r.role == "assistant" and r.message.startswith("ACTION:"):
            parts = r.message.split("|", 1)
            entry["action"]  = parts[0].replace("ACTION:", "")
            entry["message"] = parts[1] if len(parts) > 1 else ""
        history.append(entry)
    return history


# Products that exist in clothing but users search with sporty/athletic terms
_CLOTHING_SPORT_KEYWORDS = {
    "shoes", "shoe", "sneakers", "sneaker", "boots", "boot",
    "running", "footwear", "shirt", "tshirt", "hoodie", "jacket",
    "pants", "jeans", "dress", "clothing", "wear", "outfit",
}

# Items we don't carry — return polite refusal
_OUT_OF_CATALOG = {
    "gun", "weapon", "knife", "drug", "alcohol", "cigarette",
    "tobacco", "explosive", "ammunition", "firearm",
}

# Frustration signals — escalate to human
_FRUSTRATION_SIGNALS = {
    "shut up", "stop", "useless", "terrible", "awful", "hate",
    "stupid", "dumb", "idiot", "not working", "broken", "garbage",
    "rubbish", "trash", "worst", "horrible",
}

def _is_out_of_catalog(message: str) -> bool:
    lower = message.lower()
    return any(kw in lower for kw in _OUT_OF_CATALOG)

def _is_frustrated(message: str) -> bool:
    lower = message.lower()
    return any(phrase in lower for phrase in _FRUSTRATION_SIGNALS)

def _build_filters(intent: UserIntent) -> Dict[str, Any]:
    filters: Dict[str, Any] = {}
    if intent.budget:
        filters["max_price"] = intent.budget

    kw_lower = [k.lower() for k in intent.keywords]

    # If keywords suggest clothing/shoes, don't force sports category
    has_clothing_kw = any(kw in _CLOTHING_SPORT_KEYWORDS for kw in kw_lower)

    if not has_clothing_kw:
        # Style → category mapping (only when no clothing keywords present)
        if intent.style_preference in ("sporty", "outdoor", "athletic"):
            filters["category"] = "sports"
        elif intent.style_preference in ("casual", "formal"):
            filters["category"] = "clothing"

    if intent.keywords:
        filters["keywords"] = intent.keywords

    filters["in_stock"] = True
    return filters


def _build_bot_message(action: str, agent: RLAgent, intent: UserIntent,
                        products: list, turn_number: int) -> str:
    """Generate natural-language response for each action."""

    if action == "greet":
        return _random.choice(GREETINGS)

    if action.startswith("ask_"):
        return agent.get_action_question(action)

    if action == "recommend_products":
        if not products:
            return (
                "I searched our catalog but couldn't find an exact match. "
                "Could you tell me more — what category, budget, or style are you after?"
            )
        names  = ", ".join(p["name"] for p in products[:3])
        prefix = ""
        if intent.budget:
            prefix += f"Within your ${intent.budget:.0f} budget, "
        if intent.style_preference:
            prefix += f"for a {intent.style_preference} style, "
        suffix = " — and a few more below!" if len(products) > 3 else "!"
        return f"{prefix}here are my top picks for you: {names}{suffix}"

    if action == "add_to_cart":
        return "Great choice! Shall I add that to your cart?"

    if action == "transfer_to_human":
        return agent.get_action_question(action)

    if action == "end_conversation":
        return agent.get_action_question(action)

    return "How can I help you find the perfect product today?"


def _auto_reward_previous_turn(user: User, current_intent: UserIntent,
                                db: Session, agent: RLAgent) -> None:
    """
    Reward the previous bot action based on what the user just said.
    - ask_budget   + user gave budget   → +1
    - ask_style    + user gave style    → +1
    - ask_urgency  + user gave urgency  → +1
    - ask_category + user gave keywords → +1
    - recommend_products + user still chatting → +1
    """
    last_rl = (
        db.query(RLState)
        .filter(RLState.user_id == user.id)
        .order_by(RLState.timestamp.desc())
        .first()
    )
    if not last_rl or last_rl.reward != 0.0:
        return

    last_action = last_rl.action_taken
    reward = 0.0

    if last_action == "ask_budget"   and current_intent.budget          is not None: reward = Reward.INFORMATIVE_ANSWER
    elif last_action == "ask_style"  and current_intent.style_preference is not None: reward = Reward.INFORMATIVE_ANSWER
    elif last_action == "ask_urgency" and current_intent.urgency         is not None: reward = Reward.INFORMATIVE_ANSWER
    elif last_action in ("ask_category", "ask_brand") and len(current_intent.keywords) > 0: reward = Reward.INFORMATIVE_ANSWER
    elif last_action == "recommend_products": reward = Reward.INFORMATIVE_ANSWER

    if reward != 0.0:
        state_vec = np.array(last_rl.state_vector, dtype=np.float64)
        agent.update(state_vec, last_action, reward)
        last_rl.reward = reward


# Product category keywords — used to detect topic switches
_CATEGORY_KEYWORDS = {
    "electronics": {"headphone", "headphones", "laptop", "phone", "smartphone",
                    "tablet", "camera", "speaker", "speakers", "keyboard", "mouse",
                    "monitor", "charger", "tv", "television", "earphone", "earphones",
                    "earbuds", "ipad", "iphone", "samsung", "kindle", "audio",
                    "wireless", "bluetooth", "gaming"},
    "clothing":    {"shoe", "shoes", "sneaker", "sneakers", "boot", "boots",
                    "shirt", "shirts", "pants", "jeans", "jacket", "jackets",
                    "hoodie", "dress", "clothing", "wear", "outfit", "footwear",
                    "socks", "coat", "sweater", "hoodie", "tshirt", "top"},
    "home":        {"vacuum", "cleaner", "blender", "coffee", "mattress", "pillow",
                    "shelf", "lamp", "cookware", "skillet", "fryer", "furniture",
                    "appliance", "kitchen", "pot", "pan", "mop", "robot"},
    "sports":      {"yoga", "mat", "dumbbell", "dumbbells", "weight", "weights",
                    "bike", "basketball", "tennis", "golf", "hiking", "camping",
                    "gym", "workout", "exercise", "fitness", "kayak", "treadmill"},
    "beauty":      {"moisturizer", "serum", "sunscreen", "mascara", "shampoo",
                    "conditioner", "skincare", "makeup", "perfume", "lotion",
                    "cream", "foundation", "lipstick", "hairdryer"},
}

def _detect_category(keywords: list) -> str | None:
    """Detect product category from a list of keywords."""
    kw_set = {k.lower() for k in keywords}
    for cat, cat_keywords in _CATEGORY_KEYWORDS.items():
        if kw_set & cat_keywords:
            return cat
    return None

def _is_topic_switch(current_intent: UserIntent, history: List[dict]) -> bool:
    """
    Detect if the user switched to a completely different product category.
    Returns True if current message is about a different category than recent history.
    """
    if not current_intent.keywords:
        return False

    current_cat = _detect_category(current_intent.keywords)
    if not current_cat:
        return False

    # Only look at the last 2 user messages to detect the CURRENT topic
    # (not full history which may contain older switched-away topics)
    recent_user_msgs = [
        h["message"] for h in history[-6:]
        if h.get("role") == "user"
    ][-2:]

    if not recent_user_msgs:
        return False

    nlu = NLUService.get()
    prior_keywords = []
    for msg in recent_user_msgs:
        prior = nlu.analyze(msg)
        prior_keywords.extend(prior.keywords)

    prior_cat = _detect_category(prior_keywords)

    # Topic switch if categories differ and current message has a clear search intent
    return (
        prior_cat is not None
        and current_cat != prior_cat
        and current_intent.intent in ("search", "question")
    )


def _build_cumulative_profile(intent: UserIntent, history: List[dict]) -> UserIntent:
    """
    Build a context-aware cumulative profile by finding the current topic window.

    Strategy:
    - Find the last topic-switch point in history (where user changed product type)
    - Only merge context from messages AFTER that point
    - Budget/urgency carry forward within the same topic window
    - Keywords and style are topic-specific and reset on topic switch
    """
    from services.nlu import UserIntent as UI

    nlu = NLUService.get()

    # If this message itself is a topic switch → start completely fresh
    if _is_topic_switch(intent, history):
        return intent

    # Get all user messages in order with their history index
    user_msg_pairs = [
        (i, h["message"])
        for i, h in enumerate(history)
        if h.get("role") == "user"
    ]

    # Find where the current topic window starts:
    # Walk backwards through user messages to find the most recent topic switch
    window_start = 0
    for j in range(len(user_msg_pairs) - 1, -1, -1):
        hist_idx, msg_text = user_msg_pairs[j]
        msg_intent = nlu.analyze(msg_text)
        prior_history = history[:hist_idx]
        if _is_topic_switch(msg_intent, prior_history):
            window_start = j   # include this switch message in the window
            break

    # Messages in the current topic window (excluding current message)
    window_msgs = [msg for _, msg in user_msg_pairs[window_start:]]

    # Accumulate context only from within this window
    cumulative_budget   = intent.budget
    cumulative_style    = intent.style_preference
    cumulative_urgency  = intent.urgency
    cumulative_keywords = list(intent.keywords)

    # Detect the category of the current window to avoid cross-category pollution
    current_cat = _detect_category(cumulative_keywords)

    for text in window_msgs:
        prior = nlu.analyze(text)
        prior_cat = _detect_category(prior.keywords)

        # Skip keywords from a different category (e.g. headphones when searching shoes)
        same_cat = (current_cat is None or prior_cat is None or current_cat == prior_cat)

        if cumulative_budget  is None and prior.budget          is not None:
            cumulative_budget  = prior.budget
        if cumulative_style   is None and prior.style_preference is not None and same_cat:
            cumulative_style   = prior.style_preference
        if cumulative_urgency is None and prior.urgency          is not None:
            cumulative_urgency = prior.urgency
        if same_cat:
            for kw in prior.keywords:
                if kw not in cumulative_keywords and kw not in ("thanks", "ok", "now", "right", "also", "want"):
                    cumulative_keywords.append(kw)

    return UI(
        intent           = intent.intent,
        budget           = cumulative_budget,
        style_preference = cumulative_style,
        urgency          = cumulative_urgency,
        keywords         = cumulative_keywords,
        embedding        = intent.embedding,
    )


# ═══════════════════════════════════════════════════════════════════════════
# Routes
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/", summary="Chat health check")
def chat_status():
    return {"status": "ok", "message": "Chat router fully wired."}


@router.post("/", response_model=ChatResponse, summary="Send a chat message")
def chat(body: ChatRequest, db: Session = Depends(get_db)):
    # ── 1. Session ────────────────────────────────────────────────────────
    session_id  = body.session_id.strip() or str(uuid.uuid4())
    user        = _get_or_create_user(session_id, db)

    # ── 2. History ────────────────────────────────────────────────────────
    history     = _load_history(user, db, limit=10)
    turn_number = sum(1 for h in history if h["role"] == "user")

    # ── 3. NLU ────────────────────────────────────────────────────────────
    nlu    = NLUService.get()
    intent = nlu.analyze(body.message)

    # ── 4. Auto-reward previous turn ──────────────────────────────────────
    agent = RLAgent.get()
    if turn_number > 0:
        _auto_reward_previous_turn(user, intent, db, agent)

    # ── 5. Check for out-of-catalog or frustrated user ───────────────────
    if _is_out_of_catalog(body.message):
        db.add(Conversation(user_id=user.id, role="user", message=body.message, timestamp=_utcnow()))
        db.add(Conversation(user_id=user.id, role="assistant",
                            message="ACTION:end_conversation|Sorry, that item isn't available in our catalog. I carry electronics, clothing, home goods, sports gear, and beauty products. What can I help you find?",
                            timestamp=_utcnow()))
        db.commit()
        return ChatResponse(session_id=session_id,
                            bot_message="Sorry, that item isn't available in our catalog. I carry electronics, clothing, home goods, sports gear, and beauty products. What can I help you find?",
                            action="end_conversation", products=[], turn_number=turn_number+1, rl_state_id=None)

    if _is_frustrated(body.message):
        db.add(Conversation(user_id=user.id, role="user", message=body.message, timestamp=_utcnow()))
        db.add(Conversation(user_id=user.id, role="assistant",
                            message="ACTION:transfer_to_human|I'm sorry I'm not being helpful. Let me connect you with a human agent who can assist you better.",
                            timestamp=_utcnow()))
        db.commit()
        return ChatResponse(session_id=session_id,
                            bot_message="I'm sorry I'm not being helpful. Let me connect you with a human agent who can assist you better.",
                            action="transfer_to_human", products=[], turn_number=turn_number+1, rl_state_id=None)

    # ── 6. Build cumulative intent profile from full conversation history ──
    cumulative_intent = _build_cumulative_profile(intent, history)

    # ── 7. RL action selection (intent-aware) ─────────────────────────────
    cart_size = len(body.cart)
    state_vec = agent.build_state_vector(cumulative_intent, turn_number, cart_size)
    action    = agent.select_action(state_vec, history, intent=cumulative_intent)

    # ── 8. Recommender ────────────────────────────────────────────────────
    products: List[Dict[str, Any]] = []
    if action == "recommend_products":
        recommender  = Recommender.get()
        filters      = _build_filters(cumulative_intent)
        raw_products = recommender.recommend(filters, top_n=5)
        products     = [p.model_dump() for p in raw_products]

    # ── 9. Bot message ────────────────────────────────────────────────────
    bot_message = _build_bot_message(action, agent, cumulative_intent, products, turn_number)

    # ── 10. Persist user message ───────────────────────────────────────────
    db.add(Conversation(
        user_id=user.id, role="user",
        message=body.message, timestamp=_utcnow(),
    ))

    # ── 11. Persist bot response ───────────────────────────────────────────
    db.add(Conversation(
        user_id=user.id, role="assistant",
        message=f"ACTION:{action}|{bot_message}", timestamp=_utcnow(),
    ))

    # ── 12. Persist RLState (greet action maps to end_conversation for storage)
    stored_action = action if action != "greet" else "end_conversation"
    rl_state = RLState(
        user_id      = user.id,
        session_id   = session_id,
        state_vector = state_vec.tolist(),
        action_taken = stored_action,
        reward       = 0.0,
        timestamp    = _utcnow(),
    )
    db.add(rl_state)
    db.commit()
    db.refresh(rl_state)

    return ChatResponse(
        session_id  = session_id,
        bot_message = bot_message,
        action      = action,
        products    = products,
        turn_number = turn_number + 1,
        rl_state_id = rl_state.id,
    )


@router.post("/reward", summary="Submit reward signal")
def submit_reward(body: RewardRequest, db: Session = Depends(get_db)):
    if body.reward_type not in REWARD_MAP:
        raise HTTPException(status_code=422,
            detail=f"Unknown reward_type. Valid: {list(REWARD_MAP.keys())}")

    rl_state = db.query(RLState).filter(RLState.id == body.rl_state_id).first()
    if not rl_state:
        raise HTTPException(status_code=404, detail=f"RLState id={body.rl_state_id} not found.")
    if rl_state.session_id != body.session_id:
        raise HTTPException(status_code=403, detail="session_id does not match.")

    reward    = REWARD_MAP[body.reward_type]
    state_vec = np.array(rl_state.state_vector, dtype=np.float64)

    agent = RLAgent.get()
    agent.update(state_vec, rl_state.action_taken, reward)

    rl_state.reward = reward
    db.commit()

    return {
        "status":      "ok",
        "rl_state_id": rl_state.id,
        "action":      rl_state.action_taken,
        "reward":      reward,
        "reward_type": body.reward_type,
        "message":     f"Agent updated: W[{rl_state.action_taken}] adjusted by {reward:+.1f}",
    }


@router.get("/history/{session_id}", summary="Get conversation history")
def get_history(session_id: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.session_id == session_id).first()
    if not user:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found.")

    rows = (
        db.query(Conversation)
        .filter(Conversation.user_id == user.id)
        .order_by(Conversation.timestamp.asc())
        .all()
    )
    history = []
    for r in rows:
        entry = {"id": r.id, "role": r.role, "timestamp": r.timestamp.isoformat()}
        if r.role == "assistant" and r.message.startswith("ACTION:"):
            parts = r.message.split("|", 1)
            entry["action"]  = parts[0].replace("ACTION:", "")
            entry["message"] = parts[1] if len(parts) > 1 else ""
        else:
            entry["message"] = r.message
        history.append(entry)

    return {
        "session_id": session_id,
        "turn_count": sum(1 for h in history if h["role"] == "user"),
        "history":    history,
    }


@router.post("/analyze", response_model=UserIntent, summary="Analyze intent (debug)")
def analyze_message(body: AnalyzeRequest):
    if not body.message.strip():
        raise HTTPException(status_code=422, detail="Message must not be empty.")
    return NLUService.get().analyze(body.message)