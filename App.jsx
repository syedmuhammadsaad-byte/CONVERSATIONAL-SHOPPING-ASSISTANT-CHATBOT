// import { useState } from 'react'
// import reactLogo from './assets/react.svg'
// import viteLogo from '/vite.svg'
// import './App.css'

// function App() {
//   const [count, setCount] = useState(0)

//   return (
//     <>
//       <div>
//         <a href="https://vite.dev" target="_blank">
//           <img src={viteLogo} className="logo" alt="Vite logo" />
//         </a>
//         <a href="https://react.dev" target="_blank">
//           <img src={reactLogo} className="logo react" alt="React logo" />
//         </a>
//       </div>
//       <h1>Vite + React</h1>
//       <div className="card">
//         <button onClick={() => setCount((count) => count + 1)}>
//           count is {count}
//         </button>
//         <p>
//           Edit <code>src/App.jsx</code> and save to test HMR
//         </p>
//       </div>
//       <p className="read-the-docs">
//         Click on the Vite and React logos to learn more
//       </p>
//     </>
//   )
// }

// export default App


import { useState, useEffect, useRef, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, CartesianGrid } from "recharts";

const API = "http://localhost:8000";

// ── Palette ────────────────────────────────────────────────────────────────
const C = {
  rl:   { bg: "#1a1a2e", border: "#4f46e5", text: "#a5b4fc", badge: "#312e81", label: "RL Mode"   },
  rule: { bg: "#1a1a2e", border: "#d97706", text: "#fcd34d", badge: "#451a03", label: "Rule-based" },
  rand: { bg: "#1a1a2e", border: "#6b7280", text: "#d1d5db", badge: "#1f2937", label: "Random"    },
};

const CATEGORY_COLORS = {
  electronics: { bg: "#fef3c7", icon: "⚡", label: "TECH",   dot: "#f59e0b" },
  clothing:    { bg: "#fce7f3", icon: "👗", label: "FASHION", dot: "#ec4899" },
  home:        { bg: "#e0f2fe", icon: "🏠", label: "HOME",    dot: "#0ea5e9" },
  sports:      { bg: "#dcfce7", icon: "🏃", label: "SPORT",   dot: "#22c55e" },
  beauty:      { bg: "#fdf4ff", icon: "✨", label: "BEAUTY",  dot: "#a855f7" },
};

const ACTION_ICONS = {
  ask_budget:        "💰",
  ask_style:         "👗",
  ask_urgency:       "⏰",
  ask_category:      "🏷️",
  ask_brand:         "🎯",
  recommend_products:"🎯",
  add_to_cart:       "🛒",
  transfer_to_human: "👤",
  end_conversation:  "👋",
};

const RULE_SEQUENCE = [
  { action: "ask_budget",   message: "What's your budget range?" },
  { action: "ask_category", message: "What category are you shopping in?" },
  { action: "ask_style",    message: "What style are you looking for?" },
  { action: "recommend_products", message: null },
];

const RANDOM_QUESTIONS = [
  { action: "ask_budget",   message: "What's your budget range?" },
  { action: "ask_style",    message: "What style are you looking for?" },
  { action: "ask_urgency",  message: "When do you need this by?" },
  { action: "ask_category", message: "What category are you shopping in?" },
  { action: "ask_brand",    message: "Do you have a preferred brand?" },
];

// ── API helpers ─────────────────────────────────────────────────────────────
async function apiChat(sessionId, message, cart = []) {
  const r = await fetch(`${API}/chat/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, message, cart }),
  });
  return r.json();
}

async function apiReward(sessionId, rlStateId, rewardType) {
  if (!rlStateId) return;
  await fetch(`${API}/chat/reward`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, rl_state_id: rlStateId, reward_type: rewardType }),
  });
}

// ── Toast ────────────────────────────────────────────────────────────────────
function Toast({ msg, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 2200); return () => clearTimeout(t); }, []);
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, zIndex: 9999,
      background: "#1e293b", color: "#e2e8f0", padding: "10px 18px",
      borderRadius: 10, fontSize: 13, fontWeight: 500,
      border: "1px solid #334155", boxShadow: "0 8px 32px #0008",
      animation: "slideIn .2s ease",
    }}>{msg}</div>
  );
}

// ── ProductCard (catalog) ───────────────────────────────────────────────────
function ProductCard({ product, onAddToCart }) {
  const cat = CATEGORY_COLORS[product.category] || { bg: "#f1f5f9", icon: "📦", label: "OTHER", dot: "#64748b" };
  return (
    <div style={{
      background: "#fff", borderRadius: 14, overflow: "hidden",
      border: "1px solid #e2e8f0", display: "flex", flexDirection: "column",
      transition: "transform .15s, box-shadow .15s", cursor: "default",
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 24px #0001"; }}
      onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; }}
    >
      <div style={{ background: cat.bg, height: 130, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
        <span style={{ fontSize: 44 }}>{cat.icon}</span>
        <span style={{
          position: "absolute", top: 10, left: 10, background: cat.dot,
          color: "#fff", fontSize: 10, fontWeight: 700, letterSpacing: 1,
          padding: "3px 8px", borderRadius: 5,
        }}>{cat.label}</span>
        <button onClick={() => {}} style={{
          position: "absolute", top: 8, right: 8, background: "#fff8",
          border: "none", borderRadius: "50%", width: 28, height: 28,
          cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center",
        }}>♡</button>
      </div>
      <div style={{ padding: "12px 14px", flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", lineHeight: 1.3, 
          overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
          {product.name}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#4f46e5" }}>${product.price}</span>
          <span style={{ fontSize: 11, color: "#64748b" }}>⭐ {product.rating}</span>
        </div>
        <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.4,
          overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
          {product.description}
        </div>
        <button onClick={() => onAddToCart(product)} style={{
          marginTop: 8, background: "#0f172a", color: "#fff", border: "none",
          borderRadius: 8, padding: "8px 0", fontSize: 12, fontWeight: 600,
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          transition: "background .15s",
        }}
          onMouseEnter={e => e.currentTarget.style.background = "#1e293b"}
          onMouseLeave={e => e.currentTarget.style.background = "#0f172a"}
        >🛒 ADD TO CART</button>
      </div>
    </div>
  );
}

// ── Inline product card (inside chat) ───────────────────────────────────────
function InlineProductCard({ product, sessionId, rlStateId, onAddToCart }) {
  const cat = CATEGORY_COLORS[product.category] || { bg: "#f1f5f9", icon: "📦", label: "OTHER", dot: "#64748b" };
  return (
    <div style={{
      background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0",
      overflow: "hidden", width: 160, flexShrink: 0,
    }}>
      <div style={{ background: cat.bg, height: 72, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
        <span style={{ fontSize: 28 }}>{cat.icon}</span>
        <span style={{
          position: "absolute", top: 6, left: 6, background: cat.dot,
          color: "#fff", fontSize: 9, fontWeight: 700, letterSpacing: 1,
          padding: "2px 6px", borderRadius: 4,
        }}>{cat.label}</span>
      </div>
      <div style={{ padding: "8px 10px" }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#0f172a", lineHeight: 1.3, marginBottom: 2,
          overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
          {product.name}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#4f46e5", marginBottom: 2 }}>${product.price}</div>
        <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6 }}>⭐ {product.rating} · {product.brand}</div>
        <button onClick={() => onAddToCart(product, rlStateId)} style={{
          width: "100%", background: "#0f172a", color: "#fff", border: "none",
          borderRadius: 6, padding: "5px 0", fontSize: 10, fontWeight: 600, cursor: "pointer",
        }}>+ Add to cart</button>
      </div>
    </div>
  );
}

// ── Message bubble ──────────────────────────────────────────────────────────
function MessageBubble({ msg, sessionId, onAddToCart }) {
  const isBot = msg.role === "assistant";
  const time  = new Date(msg.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div style={{ display: "flex", flexDirection: isBot ? "row" : "row-reverse", gap: 10, alignItems: "flex-start" }}>
      {isBot && (
        <div style={{
          width: 34, height: 34, borderRadius: "50%", background: "#e0e7ff",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 16, flexShrink: 0, marginTop: 20,
        }}>🤖</div>
      )}
      <div style={{ maxWidth: "75%", display: "flex", flexDirection: "column", gap: 4, alignItems: isBot ? "flex-start" : "flex-end" }}>
        {isBot && msg.action && (
          <div style={{
            fontSize: 11, fontWeight: 600, color: "#6366f1",
            background: "#eef2ff", padding: "2px 8px", borderRadius: 6,
            display: "inline-flex", alignItems: "center", gap: 4,
          }}>
            {ACTION_ICONS[msg.action] || "🤖"} {msg.action}
          </div>
        )}
        <div style={{
          background: isBot ? "#f8fafc" : "#4f46e5",
          color: isBot ? "#0f172a" : "#fff",
          padding: "10px 14px", borderRadius: isBot ? "4px 14px 14px 14px" : "14px 4px 14px 14px",
          fontSize: 13, lineHeight: 1.5, border: isBot ? "1px solid #e2e8f0" : "none",
          boxShadow: isBot ? "none" : "0 2px 8px #4f46e540",
        }}>
          {msg.text}
        </div>
        {isBot && msg.products && msg.products.length > 0 && (
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginTop: 4, maxWidth: 480 }}>
            {msg.products.map(p => (
              <InlineProductCard key={p.id} product={p} sessionId={sessionId}
                rlStateId={msg.rlStateId} onAddToCart={onAddToCart} />
            ))}
          </div>
        )}
        <div style={{ fontSize: 10, color: "#94a3b8" }}>{time}</div>
      </div>
    </div>
  );
}

// ── Chat Panel ───────────────────────────────────────────────────────────────
function ChatPanel({ strategy, sessionId, cart, onAddToCart, onNewSession }) {
  const [messages, setMessages] = useState([{
    id: 0, role: "assistant", action: null,
    text: "Hi! I'm ShopSense AI. I can help you find exactly what you're looking for. What's on your mind today?",
    ts: Date.now(), products: [],
  }]);
  const [input, setInput]     = useState("");
  const [loading, setLoading] = useState(false);
  const [ruleIdx, setRuleIdx] = useState(0);
  const [usedRand, setUsedRand] = useState([]);
  const [turnNum, setTurnNum] = useState(0);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const addMsg = (msg) => setMessages(p => [...p, { id: Date.now() + Math.random(), ...msg }]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || loading) return;
    const userText = input.trim();
    setInput("");
    setTurnNum(t => t + 1);

    addMsg({ role: "user", text: userText, ts: Date.now() });
    setLoading(true);

    try {
      if (strategy === "rl") {
        const data = await apiChat(sessionId, userText, cart);
        addMsg({
          role: "assistant", action: data.action, text: data.bot_message,
          ts: Date.now(), products: data.products || [], rlStateId: data.rl_state_id,
        });
      } else if (strategy === "rule") {
        const step = RULE_SEQUENCE[Math.min(ruleIdx, RULE_SEQUENCE.length - 1)];
        setRuleIdx(i => i + 1);
        if (step.action === "recommend_products") {
          const data = await apiChat(sessionId, userText, cart);
          addMsg({ role: "assistant", action: "recommend_products", text: data.bot_message, ts: Date.now(), products: data.products || [], rlStateId: data.rl_state_id });
        } else {
          addMsg({ role: "assistant", action: step.action, text: step.message, ts: Date.now(), products: [] });
        }
      } else {
        // random
        const available = RANDOM_QUESTIONS.filter(q => !usedRand.includes(q.action));
        if (available.length === 0 || usedRand.length >= 3) {
          const data = await apiChat(sessionId, userText, cart);
          addMsg({ role: "assistant", action: "recommend_products", text: data.bot_message, ts: Date.now(), products: data.products || [], rlStateId: data.rl_state_id });
        } else {
          const pick = available[Math.floor(Math.random() * available.length)];
          setUsedRand(u => [...u, pick.action]);
          addMsg({ role: "assistant", action: pick.action, text: pick.message, ts: Date.now(), products: [] });
        }
      }
    } catch {
      addMsg({ role: "assistant", action: null, text: "⚠️ Could not reach the API. Make sure the backend is running on localhost:8000.", ts: Date.now(), products: [] });
    }
    setLoading(false);
  }, [input, loading, strategy, sessionId, cart, ruleIdx, usedRand]);

  const handleKey = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } };

  const handleNewSession = () => {
    setMessages([{ id: 0, role: "assistant", action: null, text: "Hi! I'm ShopSense AI. Starting fresh — what are you looking for?", ts: Date.now(), products: [] }]);
    setRuleIdx(0);
    setUsedRand([]);
    setTurnNum(0);
    onNewSession();
  };

  const strat = strategy === "rl" ? C.rl : strategy === "rule" ? C.rule : C.rand;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#f8fafc" }}>
      {/* Chat header */}
      <div style={{ padding: "10px 16px", background: "#fff", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: strategy === "rl" ? "#22c55e" : strategy === "rule" ? "#f59e0b" : "#94a3b8" }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>Active Chat</span>
          <span style={{
            fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6,
            background: strat.badge, color: strat.text, border: `1px solid ${strat.border}`,
          }}>{strat.label}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>Turn {turnNum} / 20</span>
          <button onClick={handleNewSession} style={{
            fontSize: 11, padding: "4px 10px", borderRadius: 6, border: "1px solid #e2e8f0",
            background: "#fff", cursor: "pointer", color: "#64748b", fontWeight: 500,
          }}>+ New Chat</button>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        {messages.map(m => (
          <MessageBubble key={m.id} msg={m} sessionId={sessionId} onAddToCart={onAddToCart} />
        ))}
        {loading && (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#e0e7ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🤖</div>
            <div style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: "4px 14px 14px 14px", padding: "12px 16px", display: "flex", gap: 5, alignItems: "center" }}>
              {[0,1,2].map(i => (
                <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "#94a3b8", animation: `bounce 1s ${i * 0.15}s infinite` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: "10px 14px", background: "#fff", borderTop: "1px solid #e2e8f0", display: "flex", gap: 10, alignItems: "center", flexShrink: 0 }}>
        <input
          value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey}
          placeholder={`Ask ShopSense AI... (${strat.label})`}
          style={{
            flex: 1, padding: "10px 16px", borderRadius: 24, border: "1.5px solid #e2e8f0",
            fontSize: 13, outline: "none", background: "#f8fafc", color: "#0f172a",
            transition: "border .15s",
          }}
          onFocus={e => e.target.style.borderColor = "#4f46e5"}
          onBlur={e => e.target.style.borderColor = "#e2e8f0"}
        />
        <button onClick={handleSend} disabled={loading || !input.trim()} style={{
          width: 40, height: 40, borderRadius: "50%", background: input.trim() ? "#4f46e5" : "#e2e8f0",
          border: "none", cursor: input.trim() ? "pointer" : "default", color: "#fff",
          fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center",
          transition: "background .15s",
        }}>➤</button>
      </div>
    </div>
  );
}

// ── Product Grid ─────────────────────────────────────────────────────────────
function ProductGrid({ onAddToCart, searchQuery, filters }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.category && filters.category !== "all") params.set("category", filters.category);
    if (filters.minPrice) params.set("min_price", filters.minPrice);
    if (filters.maxPrice) params.set("max_price", filters.maxPrice);
    if (filters.minRating) params.set("min_rating", filters.minRating);
    fetch(`${API}/products/?${params}`)
      .then(r => r.json()).then(d => { setProducts(d.products || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [filters]);

  const visible = products.filter(p => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.category.includes(q) || p.brand.toLowerCase().includes(q) || p.tags.some(t => t.includes(q));
  });

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "#94a3b8", fontSize: 13 }}>
      Loading catalog...
    </div>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 14 }}>
      {visible.map(p => <ProductCard key={p.id} product={p} onAddToCart={onAddToCart} />)}
      {visible.length === 0 && (
        <div style={{ gridColumn: "1/-1", textAlign: "center", color: "#94a3b8", fontSize: 13, padding: 40 }}>
          No products found.
        </div>
      )}
    </div>
  );
}

// ── Analytics Dashboard ───────────────────────────────────────────────────────
function AnalyticsDashboard() {
  const [overview,    setOverview]    = useState(null);
  const [comparison,  setComparison]  = useState(null);
  const [satisfaction,setSatisfaction]= useState(null);
  const [loading,     setLoading]     = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/analytics/overview`).then(r => r.json()).catch(() => null),
      fetch(`${API}/analytics/comparison?n_sessions=100`).then(r => r.json()).catch(() => null),
      fetch(`${API}/analytics/satisfaction`).then(r => r.json()).catch(() => null),
    ]).then(([ov, cmp, sat]) => {
      setOverview(ov); setComparison(cmp); setSatisfaction(sat);
      setLoading(false);
    });
  }, []);

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, color: "#94a3b8" }}>
      Loading analytics...
    </div>
  );

  const statCards = [
    { label: "Total Sessions",    value: overview?.total_sessions ?? 0,                      icon: "👥", color: "#4f46e5" },
    { label: "Avg Turns",         value: overview?.avg_turns_per_session?.toFixed(1) ?? "—",  icon: "🔄", color: "#0ea5e9" },
    { label: "Conversion Rate",   value: `${((overview?.purchase_conversion_rate ?? 0)*100).toFixed(1)}%`, icon: "💰", color: "#22c55e" },
    { label: "Satisfaction",      value: satisfaction?.avg_satisfaction_score?.toFixed(1) ?? "—", icon: "⭐", color: "#f59e0b" },
  ];

  const chartData = comparison?.chart_data?.map(d => ({
    name: d.label,
    conversion: +(d.conversion_rate * 100).toFixed(1),
    reward:      +d.avg_reward.toFixed(2),
    turns:       +d.avg_turns_per_session.toFixed(1),
  })) || [];

  const CHART_COLORS = ["#f59e0b", "#94a3b8", "#4f46e5"];

  const satData = satisfaction?.distribution?.map(d => ({
    name: `★${d.score}`, value: d.count,
  })) || [];
  const SAT_COLORS = ["#dc2626","#ea580c","#ca8a04","#65a30d","#16a34a"];

  const questionData = (overview?.most_asked_questions || []).map(q => ({
    name: q.action.replace("ask_",""), count: q.count,
  }));

  const summary = comparison?.summary;

  return (
    <div style={{ padding: "24px 28px", overflowY: "auto", height: "100%" }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", margin: 0 }}>Analytics Dashboard</h2>
        <p style={{ fontSize: 13, color: "#64748b", margin: "4px 0 0" }}>Strategy comparison · 100 simulated sessions each</p>
      </div>

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 28 }}>
        {statCards.map(s => (
          <div key={s.label} style={{ background: "#fff", borderRadius: 12, padding: "16px 18px", border: "1px solid #e2e8f0" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: "#64748b", fontWeight: 500 }}>{s.label}</span>
              <span style={{ fontSize: 18 }}>{s.icon}</span>
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Strategy comparison */}
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", padding: "20px 24px", marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", margin: "0 0 4px" }}>Strategy Comparison — Simulated 100 Sessions Each</h3>
        <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 20px" }}>Rule-based · Random · RL Bandit</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 10 }}>Conversion Rate by Strategy</div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} barSize={36}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
                <Tooltip formatter={v => `${v}%`} />
                <Bar dataKey="conversion" radius={[6,6,0,0]}>
                  {chartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 10 }}>Average Reward by Strategy</div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} barSize={36}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip />
                <Bar dataKey="reward" radius={[6,6,0,0]}>
                  {chartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        {/* Summary badges */}
        {summary && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginTop: 20 }}>
            {[
              { label: "Best Conversion", value: summary.best_conversion, icon: "🥇", color: "#fef9c3", border: "#fde047" },
              { label: "Best Avg Reward", value: summary.best_avg_reward, icon: "💡", color: "#e0f2fe", border: "#38bdf8" },
              { label: "Fewest Turns",   value: summary.fewest_turns,    icon: "⚡", color: "#fce7f3", border: "#f472b6" },
            ].map(b => (
              <div key={b.label} style={{ background: b.color, border: `1px solid ${b.border}`, borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 20 }}>{b.icon}</span>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "#475569" }}>{b.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>{b.value?.replace("_", " ")}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Session Insights */}
      <div style={{ marginBottom: 8 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", margin: "0 0 14px" }}>Session Insights</h3>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }}>
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", padding: "18px 20px" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 14 }}>Most Asked Clarifying Questions</div>
          {questionData.length > 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <PieChart width={120} height={120}>
                <Pie data={questionData} cx={55} cy={55} innerRadius={30} outerRadius={55} dataKey="count">
                  {questionData.map((_, i) => <Cell key={i} fill={["#4f46e5","#0ea5e9","#22c55e","#f59e0b","#ec4899"][i]} />)}
                </Pie>
              </PieChart>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {questionData.map((d, i) => (
                  <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: ["#4f46e5","#0ea5e9","#22c55e","#f59e0b","#ec4899"][i] }} />
                    <span style={{ fontSize: 11, color: "#475569" }}>{d.name}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#0f172a", marginLeft: "auto" }}>{d.count}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ color: "#94a3b8", fontSize: 12, textAlign: "center", paddingTop: 20 }}>No data yet — start chatting!</div>
          )}
        </div>

        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", padding: "18px 20px" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 14 }}>User Satisfaction Score Distribution</div>
          <ResponsiveContainer width="100%" height={130}>
            <LineChart data={satData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#4f46e5" strokeWidth={2} dot={{ fill: "#4f46e5", r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Avg turns per strategy */}
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", padding: "18px 20px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 14 }}>Average Turns per Session by Strategy</div>
        <ResponsiveContainer width="100%" height={120}>
          <BarChart data={chartData} layout="vertical" barSize={22}>
            <XAxis type="number" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={72} />
            <Tooltip />
            <Bar dataKey="turns" radius={[0,6,6,0]}>
              {chartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Catalog Page ─────────────────────────────────────────────────────────────
function CatalogPage({ onAddToCart, searchQuery }) {
  const [filters, setFilters] = useState({ category: "all", minPrice: "", maxPrice: "", minRating: "" });
  const set = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const cats = ["all","electronics","clothing","home","sports","beauty"];

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Filter sidebar */}
      <div style={{ width: 200, flexShrink: 0, borderRight: "1px solid #e2e8f0", padding: 20, overflowY: "auto", background: "#fff" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: 1, marginBottom: 14 }}>FILTERS</div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 8 }}>Category</div>
          {cats.map(c => (
            <label key={c} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, cursor: "pointer" }}>
              <input type="radio" name="cat" checked={filters.category === c} onChange={() => set("category", c)}
                style={{ accentColor: "#4f46e5" }} />
              <span style={{ fontSize: 12, color: "#374151", textTransform: "capitalize" }}>{c}</span>
            </label>
          ))}
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 8 }}>Price Range</div>
          <input placeholder="Min $" value={filters.minPrice} onChange={e => set("minPrice", e.target.value)}
            style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 12, marginBottom: 6, boxSizing: "border-box" }} />
          <input placeholder="Max $" value={filters.maxPrice} onChange={e => set("maxPrice", e.target.value)}
            style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 12, boxSizing: "border-box" }} />
        </div>

        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 8 }}>Min Rating</div>
          {["","3","3.5","4","4.5"].map(r => (
            <label key={r} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, cursor: "pointer" }}>
              <input type="radio" name="rating" checked={filters.minRating === r} onChange={() => set("minRating", r)}
                style={{ accentColor: "#4f46e5" }} />
              <span style={{ fontSize: 12, color: "#374151" }}>{r ? `★ ${r}+` : "Any"}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: 0 }}>Product Inventory</h2>
            <p style={{ fontSize: 12, color: "#64748b", margin: "2px 0 0" }}>Browse our complete catalog of 50+ curated items.</p>
          </div>
          <button style={{ fontSize: 12, padding: "7px 14px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", cursor: "pointer", color: "#374151", fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
            ⚙ Sort &amp; Filter
          </button>
        </div>
        <ProductGrid onAddToCart={onAddToCart} searchQuery={searchQuery} filters={filters} />
      </div>
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [page,     setPage]     = useState("assistant"); // assistant | catalog | analytics
  const [strategy, setStrategy] = useState("rl");        // rl | rule | rand
  const [sessionId,setSessionId]= useState(() => crypto.randomUUID());
  const [cart,     setCart]     = useState([]);
  const [search,   setSearch]   = useState("");
  const [toast,    setToast]    = useState(null);
  const [cartOpen, setCartOpen] = useState(false);

  const showToast = (msg) => { setToast(msg); };

  const handleAddToCart = useCallback(async (product, rlStateId = null) => {
    setCart(c => {
      const ex = c.find(x => x.product_id === product.id);
      if (ex) return c.map(x => x.product_id === product.id ? { ...x, quantity: x.quantity + 1 } : x);
      return [...c, { product_id: product.id, quantity: 1, product }];
    });
    showToast(`🛒 ${product.name} added to cart!`);
    if (rlStateId) await apiReward(sessionId, rlStateId, "add_to_cart").catch(() => {});
  }, [sessionId]);

  const handleNewSession = () => setSessionId(crypto.randomUUID());

  const stratBtns = [
    { key: "rl",   label: "RL",          color: "#4f46e5" },
    { key: "rule", label: "Rule-based",   color: "#d97706" },
    { key: "rand", label: "Random",       color: "#6b7280" },
  ];

  const navItems = [
    { key: "assistant", icon: "🤖", label: "Assistant" },
    { key: "catalog",   icon: "📦", label: "Product Catalog" },
    { key: "analytics", icon: "📊", label: "Policy Analytics" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "'DM Sans', 'Segoe UI', sans-serif", background: "#f8fafc" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 99px; }
        @keyframes bounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-5px)} }
        @keyframes slideIn { from{transform:translateY(12px);opacity:0} to{transform:translateY(0);opacity:1} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
      `}</style>

      {/* Navbar */}
      <div style={{
        height: 56, background: "#fff", borderBottom: "1px solid #e2e8f0",
        display: "flex", alignItems: "center", padding: "0 20px", gap: 20, flexShrink: 0,
        boxShadow: "0 1px 3px #0000000a",
      }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginRight: 8 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: "#4f46e5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🛍</div>
          <span style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", letterSpacing: -.3 }}>SHOPSENSE</span>
        </div>

        {/* Strategy toggles */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", background: "#f1f5f9", borderRadius: 10 }}>
          <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600, marginRight: 4 }}>RL Mode</span>
          {stratBtns.map(b => (
            <button key={b.key} onClick={() => setStrategy(b.key)} style={{
              padding: "4px 12px", borderRadius: 7, border: "none", cursor: "pointer",
              fontSize: 11, fontWeight: 600,
              background: strategy === b.key ? b.color : "transparent",
              color: strategy === b.key ? "#fff" : "#64748b",
              transition: "all .15s",
            }}>{b.label}</button>
          ))}
        </div>

        {/* Search */}
        <div style={{ flex: 1, maxWidth: 280, position: "relative" }}>
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "#94a3b8" }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Quick search catalog..."
            style={{ width: "100%", padding: "7px 12px 7px 30px", borderRadius: 9, border: "1.5px solid #e2e8f0", fontSize: 12, outline: "none", background: "#f8fafc", color: "#0f172a" }}
            onFocus={e => e.target.style.borderColor = "#4f46e5"}
            onBlur={e => e.target.style.borderColor = "#e2e8f0"}
          />
        </div>

        <div style={{ flex: 1 }} />

        {/* Cart */}
        <button onClick={() => setCartOpen(o => !o)} style={{
          display: "flex", alignItems: "center", gap: 7, padding: "7px 14px",
          borderRadius: 9, border: "1.5px solid #e2e8f0", background: "#fff",
          cursor: "pointer", fontSize: 13, color: "#374151", fontWeight: 500,
          position: "relative",
        }}>
          🛒 CART
          {cart.length > 0 && (
            <span style={{ background: "#4f46e5", color: "#fff", borderRadius: "50%", width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700 }}>
              {cart.reduce((s, x) => s + x.quantity, 0)}
            </span>
          )}
        </button>
        <button onClick={() => {}} style={{
          padding: "7px 16px", borderRadius: 9, background: "#4f46e5",
          color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
        }}>Checkout</button>
      </div>

      {/* Body */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Sidebar */}
        <div style={{ width: 196, background: "#fff", borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "18px 12px", flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: 1, marginBottom: 10, paddingLeft: 8 }}>NAVIGATION</div>
            {navItems.map(n => (
              <button key={n.key} onClick={() => setPage(n.key)} style={{
                width: "100%", display: "flex", alignItems: "center", gap: 10,
                padding: "9px 12px", borderRadius: 9, border: "none",
                background: page === n.key ? "#eef2ff" : "transparent",
                color: page === n.key ? "#4f46e5" : "#64748b",
                fontWeight: page === n.key ? 600 : 400, fontSize: 13, cursor: "pointer",
                marginBottom: 2, textAlign: "left", transition: "all .15s",
              }}>
                <span style={{ fontSize: 16 }}>{n.icon}</span>
                {n.label}
              </button>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: 1, marginBottom: 10, paddingLeft: 8 }}>AGENT STATUS</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#f8fafc", borderRadius: 9 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: strategy === "rl" ? "#22c55e" : strategy === "rule" ? "#f59e0b" : "#94a3b8" }} />
              <span style={{ fontSize: 12, color: "#374151", fontWeight: 500 }}>
                {strategy === "rl" ? "RL Policy Active" : strategy === "rule" ? "Rule-Based Mode" : "Random Mode"}
              </span>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {page === "assistant" && (
            <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
              {/* Chat panel */}
              <div style={{ width: 480, flexShrink: 0, borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column", overflow: "hidden" }}>
                <ChatPanel strategy={strategy} sessionId={sessionId} cart={cart} onAddToCart={handleAddToCart} onNewSession={handleNewSession} />
              </div>
              {/* Product panel */}
              <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                <div style={{ padding: "14px 20px 10px", background: "#fff", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
                  <div>
                    <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", margin: 0 }}>Product Inventory</h2>
                    <p style={{ fontSize: 11, color: "#64748b", margin: "2px 0 0" }}>Browse our complete catalog of 50+ curated items.</p>
                  </div>
                  <button style={{ fontSize: 12, padding: "6px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", cursor: "pointer", color: "#374151", fontWeight: 500 }}>⚙ Sort &amp; Filter</button>
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
                  <ProductGrid onAddToCart={handleAddToCart} searchQuery={search} filters={{ category: "all" }} />
                </div>
              </div>
            </div>
          )}

          {page === "catalog" && (
            <CatalogPage onAddToCart={handleAddToCart} searchQuery={search} />
          )}

          {page === "analytics" && (
            <div style={{ flex: 1, overflow: "hidden" }}>
              <AnalyticsDashboard />
            </div>
          )}
        </div>
      </div>

      {/* Cart drawer */}
      {cartOpen && (
        <div style={{ position: "fixed", top: 56, right: 0, width: 320, background: "#fff", borderLeft: "1px solid #e2e8f0", height: "calc(100vh - 56px)", zIndex: 100, padding: 20, overflowY: "auto", boxShadow: "-4px 0 24px #0001", animation: "slideIn .2s ease" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", margin: 0 }}>Your Cart ({cart.reduce((s,x)=>s+x.quantity,0)})</h3>
            <button onClick={() => setCartOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#94a3b8" }}>✕</button>
          </div>
          {cart.length === 0 ? (
            <p style={{ color: "#94a3b8", fontSize: 13, textAlign: "center", marginTop: 40 }}>Your cart is empty.</p>
          ) : (
            <>
              {cart.map(item => (
                <div key={item.product_id} style={{ display: "flex", gap: 12, padding: "12px 0", borderBottom: "1px solid #f1f5f9" }}>
                  <div style={{ width: 44, height: 44, borderRadius: 8, background: CATEGORY_COLORS[item.product?.category]?.bg || "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
                    {CATEGORY_COLORS[item.product?.category]?.icon || "📦"}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#0f172a", lineHeight: 1.3 }}>{item.product?.name}</div>
                    <div style={{ fontSize: 12, color: "#4f46e5", fontWeight: 600, marginTop: 2 }}>${item.product?.price} × {item.quantity}</div>
                  </div>
                </div>
              ))}
              <div style={{ marginTop: 16, padding: "14px 0", borderTop: "2px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#0f172a" }}>Total</span>
                  <span style={{ fontSize: 16, fontWeight: 700, color: "#4f46e5" }}>
                    ${cart.reduce((s,x) => s + (x.product?.price || 0) * x.quantity, 0).toFixed(2)}
                  </span>
                </div>
                <button style={{ width: "100%", background: "#4f46e5", color: "#fff", border: "none", borderRadius: 10, padding: "11px 0", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                  Checkout
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}
    </div>
  );
}