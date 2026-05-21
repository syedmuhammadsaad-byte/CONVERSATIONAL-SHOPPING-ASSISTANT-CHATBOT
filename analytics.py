"""
Analytics Router — Phase 5
===========================
Aggregate stats, per-session breakdown, RL vs rule-based vs random comparison,
and simulated user satisfaction scores.

Endpoints
---------
GET /analytics/overview
GET /analytics/session/{session_id}
GET /analytics/comparison
GET /analytics/satisfaction
"""

from __future__ import annotations

import random
import statistics
from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database.db import get_db
from database.models import CartItem, Conversation, RLState, User
from services.nlu import NLUService
from services.rl_agent import (
    ACTIONS, N_ACTIONS, STATE_DIM, Reward, RLAgent, _load_weights
)
from services.recommender import Recommender

router = APIRouter(prefix="/analytics", tags=["analytics"])


# ═══════════════════════════════════════════════════════════════════════════
# Internal helpers
# ═══════════════════════════════════════════════════════════════════════════

def _parse_action(conv_message: str) -> Optional[str]:
    """Extract action name from assistant message stored as ACTION:<name>|<text>."""
    if conv_message.startswith("ACTION:"):
        return conv_message.split("|", 1)[0].replace("ACTION:", "")
    return None


def _session_outcome(session_id: str, db: Session) -> str:
    """
    Determine session outcome from RLState rewards.
    purchase > add_to_cart > abandoned > in_progress
    """
    rl_rows = (
        db.query(RLState)
        .filter(RLState.session_id == session_id)
        .all()
    )
    rewards = [r.reward for r in rl_rows]
    if Reward.PURCHASE_COMPLETED in rewards:
        return "purchase"
    if any(r == Reward.USER_ABANDONS for r in rewards):
        return "abandoned"
    if any(r > 0 for r in rewards):
        return "in_progress"
    return "in_progress"


def _satisfaction_score(turns: int, outcome: str, repeated_questions: int) -> float:
    """
    Compute a 1-5 satisfaction score for a session.

    Rules
    -----
    Base score by outcome:
      purchase   → 4.0
      in_progress → 3.0
      abandoned  → 1.5

    Turn penalty: −0.1 per turn above 5 (up to −1.0)
    Repeated question penalty: −0.3 per repeated question (up to −0.9)
    Clamp to [1.0, 5.0], round to 1 decimal.
    """
    base = {"purchase": 4.0, "in_progress": 3.0, "abandoned": 1.5}.get(outcome, 2.0)
    turn_penalty     = min((max(turns - 5, 0)) * 0.1, 1.0)
    repeat_penalty   = min(repeated_questions * 0.3, 0.9)
    score = base - turn_penalty - repeat_penalty
    # add small random noise for realism (±0.2)
    score += random.uniform(-0.2, 0.2)
    return round(max(1.0, min(5.0, score)), 1)


# ═══════════════════════════════════════════════════════════════════════════
# Simulation helpers (for /comparison)
# ═══════════════════════════════════════════════════════════════════════════

# Sample messages to drive simulated sessions
_SAMPLE_MESSAGES = [
    "I need wireless headphones under $150",
    "looking for casual shoes around $80",
    "show me the best laptops",
    "I want a yoga mat for home workouts",
    "find me a gift under $50",
    "need a waterproof jacket for hiking",
    "I am looking for gaming keyboards",
    "something sporty for the gym under $40",
    "recommend me a good coffee maker",
    "I want premium skincare products",
    "looking for running shoes under $120",
    "best wireless speakers under $100",
    "need a smart home device",
    "show me formal office wear",
    "find me outdoor camping gear",
]

# Fixed rule-based action sequence
_RULE_BASED_SEQUENCE = [
    "ask_budget", "ask_style", "ask_category",
    "recommend_products", "add_to_cart", "end_conversation",
]


def _simulate_session(
    strategy: str,
    message: str,
    agent_weights: Optional[np.ndarray],
    max_turns: int = 10,
    seed: int = 0,
) -> Dict[str, Any]:
    """
    Simulate a single user session for a given strategy.

    Returns dict with: turns, total_reward, purchased, cart_added, actions
    """
    rng = random.Random(seed)
    np.random.seed(seed)

    nlu    = NLUService.get()
    intent = nlu.analyze(message)

    # Build a fixed state vector (same user state throughout sim for simplicity)
    dummy_agent = RLAgent.__new__(RLAgent)
    dummy_agent.W       = agent_weights if agent_weights is not None else np.zeros((N_ACTIONS, STATE_DIM))
    dummy_agent.epsilon = 0.15
    dummy_agent.lr      = 0.01
    dummy_agent._update_count = 0

    state = dummy_agent.build_state_vector(intent, turn_number=0, cart_size=0)

    actions_taken: List[str] = []
    total_reward   = 0.0
    purchased      = False
    cart_added     = False
    history: List[dict] = []

    for turn in range(max_turns):
        # ── Pick action by strategy ────────────────────────────────────────
        if strategy == "rule_based":
            action = _RULE_BASED_SEQUENCE[min(turn, len(_RULE_BASED_SEQUENCE) - 1)]

        elif strategy == "random":
            action = rng.choice(ACTIONS)

        else:  # rl_bandit
            action = dummy_agent.select_action(state, history)

        actions_taken.append(action)
        history.append({"role": "assistant", "action": action})

        # ── Simulate user reaction ─────────────────────────────────────────
        # Probability model: asking too many questions increases abandon risk
        ask_count = sum(1 for a in actions_taken if a.startswith("ask_"))

        if action == "recommend_products":
            # 35% chance of purchase, 25% add-to-cart, rest continue
            r = rng.random()
            if r < 0.35:
                reward  = Reward.PURCHASE_COMPLETED
                purchased = True
            elif r < 0.60:
                reward    = Reward.ADD_TO_CART
                cart_added = True
            else:
                reward = Reward.INFORMATIVE_ANSWER

        elif action == "add_to_cart":
            reward    = Reward.ADD_TO_CART
            cart_added = True

        elif action == "end_conversation":
            reward = 0.0
            break

        elif action == "transfer_to_human":
            reward = 0.0
            break

        elif action.startswith("ask_"):
            # Repeated question → negative reward + higher abandon risk
            repeated = action in [h.get("action") for h in history[:-1]]
            if repeated:
                reward = Reward.REPEATED_QUESTION
            else:
                reward = Reward.INFORMATIVE_ANSWER

            # Abandon probability grows with number of questions asked
            abandon_prob = 0.05 + ask_count * 0.08
            if rng.random() < abandon_prob:
                total_reward += Reward.USER_ABANDONS
                break
        else:
            reward = 0.0

        total_reward += reward

        # Update RL weights in-place during rl_bandit sim (online learning)
        if strategy == "rl_bandit" and agent_weights is not None:
            dummy_agent.update(state, action, reward)

        if purchased:
            break

    return {
        "turns":        len(actions_taken),
        "total_reward": round(total_reward, 2),
        "purchased":    purchased,
        "cart_added":   cart_added,
        "actions":      actions_taken,
    }


def _run_comparison(n_sessions: int = 100) -> Dict[str, Any]:
    """Simulate n_sessions for each strategy and aggregate results."""
    # Load current trained weights for RL (don't mutate the live agent)
    trained_W = _load_weights().copy()

    strategies = {
        "rule_based": None,
        "random":     None,
        "rl_bandit":  trained_W,
    }

    results: Dict[str, Any] = {}

    for strategy, weights in strategies.items():
        session_results = []
        for i in range(n_sessions):
            msg = _SAMPLE_MESSAGES[i % len(_SAMPLE_MESSAGES)]
            sim = _simulate_session(strategy, msg, weights, seed=i * 31 + 7)
            session_results.append(sim)

        purchases      = [s for s in session_results if s["purchased"]]
        cart_adds      = [s for s in session_results if s["cart_added"]]
        turns_list     = [s["turns"] for s in session_results]
        rewards_list   = [s["total_reward"] for s in session_results]
        purchase_turns = [s["turns"] for s in purchases]

        results[strategy] = {
            "conversion_rate":        round(len(purchases) / n_sessions, 4),
            "cart_add_rate":          round(len(cart_adds) / n_sessions, 4),
            "avg_turns_per_session":  round(statistics.mean(turns_list), 2),
            "avg_turns_to_purchase":  round(statistics.mean(purchase_turns), 2) if purchase_turns else None,
            "avg_reward":             round(statistics.mean(rewards_list), 2),
            "total_purchases":        len(purchases),
            "total_sessions":         n_sessions,
        }

    return results


# ═══════════════════════════════════════════════════════════════════════════
# Routes
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/", summary="Analytics health check")
def analytics_status():
    return {"status": "ok", "message": "Analytics router ready (Phase 5)."}


# ── 1. Overview ────────────────────────────────────────────────────────────

@router.get("/overview", summary="Aggregate stats across all sessions")
def get_overview(db: Session = Depends(get_db)):
    """Return aggregate statistics computed from the SQLite database."""

    all_users = db.query(User).all()
    total_sessions = len(all_users)

    if total_sessions == 0:
        return {
            "total_sessions": 0,
            "avg_turns_per_session": 0.0,
            "purchase_conversion_rate": 0.0,
            "cart_add_rate": 0.0,
            "human_escalation_rate": 0.0,
            "most_asked_questions": [],
            "top_products": [],
            "message": "No sessions recorded yet. Start chatting via POST /chat/",
        }

    # ── Turns per session ──────────────────────────────────────────────────
    turns_per_session = []
    for user in all_users:
        turns = (
            db.query(Conversation)
            .filter(Conversation.user_id == user.id, Conversation.role == "user")
            .count()
        )
        turns_per_session.append(turns)
    avg_turns = round(statistics.mean(turns_per_session), 2) if turns_per_session else 0.0

    # ── Conversion rates from RLState rewards ─────────────────────────────
    all_rl = db.query(RLState).all()
    sessions_with_purchase   = set()
    sessions_with_cart       = set()
    sessions_with_escalation = set()

    for rl in all_rl:
        if rl.reward == Reward.PURCHASE_COMPLETED:
            sessions_with_purchase.add(rl.session_id)
        if rl.reward == Reward.ADD_TO_CART:
            sessions_with_cart.add(rl.session_id)
        if rl.action_taken == "transfer_to_human":
            sessions_with_escalation.add(rl.session_id)

    purchase_rate   = round(len(sessions_with_purchase)   / total_sessions, 4)
    cart_rate       = round(len(sessions_with_cart)        / total_sessions, 4)
    escalation_rate = round(len(sessions_with_escalation)  / total_sessions, 4)

    # ── Most asked clarifying questions ───────────────────────────────────
    action_counter: Counter = Counter()
    all_convos = db.query(Conversation).filter(Conversation.role == "assistant").all()
    for c in all_convos:
        action = _parse_action(c.message)
        if action and action.startswith("ask_"):
            action_counter[action] += 1

    most_asked = [
        {"action": action, "count": count}
        for action, count in action_counter.most_common(5)
    ]

    # ── Top products by cart adds ──────────────────────────────────────────
    # Track which products appeared in recommend_products turns
    # (Phase 6 will wire actual CartItem saves; for now infer from RL states)
    cart_rl = db.query(RLState).filter(
        RLState.reward == Reward.ADD_TO_CART
    ).all()

    top_products: List[Dict] = []
    if cart_rl:
        recommender = Recommender.get()
        nlu = NLUService.get()
        product_counter: Counter = Counter()
        for rl in cart_rl[:50]:   # cap at 50 to avoid heavy computation
            # reconstruct top product from session's first message
            user = db.query(User).filter(User.id == rl.user_id).first()
            if user:
                first_msg = (
                    db.query(Conversation)
                    .filter(Conversation.user_id == user.id, Conversation.role == "user")
                    .order_by(Conversation.timestamp)
                    .first()
                )
                if first_msg:
                    intent   = nlu.analyze(first_msg.message)
                    products = recommender.recommend(
                        {"keywords": intent.keywords, "max_price": intent.budget},
                        top_n=1
                    )
                    if products:
                        product_counter[products[0].id] += 1

        all_products = {p.id: p for p in recommender._products}
        top_products = [
            {
                "product_id": pid,
                "name":       all_products[pid].name if pid in all_products else "Unknown",
                "cart_adds":  cnt,
            }
            for pid, cnt in product_counter.most_common(5)
        ]

    return {
        "total_sessions":            total_sessions,
        "avg_turns_per_session":     avg_turns,
        "purchase_conversion_rate":  purchase_rate,
        "cart_add_rate":             cart_rate,
        "human_escalation_rate":     escalation_rate,
        "most_asked_questions":      most_asked,
        "top_products":              top_products,
    }


# ── 2. Per-session ─────────────────────────────────────────────────────────

@router.get("/session/{session_id}", summary="Per-session analytics")
def get_session_analytics(session_id: str, db: Session = Depends(get_db)):
    """Return detailed breakdown for a single session."""

    user = db.query(User).filter(User.session_id == session_id).first()
    if not user:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found.")

    convos = (
        db.query(Conversation)
        .filter(Conversation.user_id == user.id)
        .order_by(Conversation.timestamp)
        .all()
    )

    turns         = sum(1 for c in convos if c.role == "user")
    actions_taken = [
        _parse_action(c.message)
        for c in convos
        if c.role == "assistant" and _parse_action(c.message)
    ]

    # Products recommended (infer from recommend_products actions)
    products_recommended: List[int] = []
    if "recommend_products" in actions_taken:
        first_user_msg = next((c.message for c in convos if c.role == "user"), "")
        nlu     = NLUService.get()
        intent  = nlu.analyze(first_user_msg)
        rec     = Recommender.get()
        prods   = rec.recommend(
            {"keywords": intent.keywords, "max_price": intent.budget}, top_n=5
        )
        products_recommended = [p.id for p in prods]

    # Cart items from DB
    cart_items = [
        ci.product_id
        for ci in db.query(CartItem).filter(CartItem.user_id == user.id).all()
    ]

    outcome = _session_outcome(session_id, db)

    return {
        "session_id":            session_id,
        "turns":                 turns,
        "actions_taken":         actions_taken,
        "products_recommended":  products_recommended,
        "cart_items":            cart_items,
        "outcome":               outcome,
    }


# ── 3. RL vs Rule-based vs Random comparison ──────────────────────────────

@router.get("/comparison", summary="RL vs rule-based vs random strategy comparison")
def get_comparison(n_sessions: int = 100):
    """
    Simulate 100 sessions per strategy and compare.
    n_sessions: number of sessions to simulate per strategy (max 200).
    """
    n_sessions = min(max(n_sessions, 10), 200)
    comparison = _run_comparison(n_sessions)

    # Build a flat list for easy chart rendering in React
    chart_data = [
        {
            "strategy":             strategy,
            "label":                {
                "rule_based": "Rule-Based",
                "random":     "Random",
                "rl_bandit":  "RL Bandit",
            }[strategy],
            **stats,
        }
        for strategy, stats in comparison.items()
    ]

    return {
        "n_sessions_per_strategy": n_sessions,
        "strategies":              comparison,
        "chart_data":              chart_data,
        "summary": {
            "best_conversion":  max(comparison, key=lambda s: comparison[s]["conversion_rate"]),
            "best_avg_reward":  max(comparison, key=lambda s: comparison[s]["avg_reward"]),
            "fewest_turns":     min(comparison, key=lambda s: comparison[s]["avg_turns_per_session"]),
        },
    }


# ── 4. Satisfaction scores ─────────────────────────────────────────────────

@router.get("/satisfaction", summary="Simulated user satisfaction scores")
def get_satisfaction(db: Session = Depends(get_db)):
    """
    Compute a satisfaction score (1–5) for every recorded session
    based on turns taken, outcome, and repeated questions.
    Returns score distribution + average.
    """
    random.seed(42)   # deterministic noise

    all_users = db.query(User).all()

    if not all_users:
        return {
            "avg_satisfaction_score": 0.0,
            "distribution":           [{"score": s, "count": 0} for s in range(1, 6)],
            "total_sessions_scored":  0,
            "message":                "No sessions recorded yet.",
        }

    scores: List[float] = []

    for user in all_users:
        session_id = user.session_id

        # Turns
        turns = (
            db.query(Conversation)
            .filter(Conversation.user_id == user.id, Conversation.role == "user")
            .count()
        )

        # Outcome
        outcome = _session_outcome(session_id, db)

        # Repeated questions
        assistant_convos = (
            db.query(Conversation)
            .filter(Conversation.user_id == user.id, Conversation.role == "assistant")
            .order_by(Conversation.timestamp)
            .all()
        )
        actions_seq = [
            _parse_action(c.message)
            for c in assistant_convos
            if _parse_action(c.message) and _parse_action(c.message).startswith("ask_")
        ]
        # Count actions that appeared more than once
        action_counts   = Counter(actions_seq)
        repeated_q_count = sum(v - 1 for v in action_counts.values() if v > 1)

        score = _satisfaction_score(turns, outcome, repeated_q_count)
        scores.append(score)

    # Distribution: bucket into integer 1-5
    bucket_counts: Counter = Counter()
    for s in scores:
        bucket = int(round(s))
        bucket = max(1, min(5, bucket))
        bucket_counts[bucket] += 1

    distribution = [
        {"score": i, "count": bucket_counts.get(i, 0)}
        for i in range(1, 6)
    ]

    avg_score = round(statistics.mean(scores), 2) if scores else 0.0

    return {
        "avg_satisfaction_score": avg_score,
        "distribution":           distribution,
        "total_sessions_scored":  len(scores),
        "score_breakdown": {
            "min":    round(min(scores), 2) if scores else 0,
            "max":    round(max(scores), 2) if scores else 0,
            "median": round(statistics.median(scores), 2) if scores else 0,
        },
    }