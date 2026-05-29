"use client";
import { useState, useEffect, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────
const ADMIN_PASS = process.env.NEXT_PUBLIC_ALS_PASS || "vidzen-admin-2026";
const STORAGE_KEY = "als_blocked_v2";
const AUTH_KEY = "als_auth";

// ─────────────────────────────────────────────────────────────────────────────
// Parsers
// ─────────────────────────────────────────────────────────────────────────────
function parseUrls(raw) {
  const lines = raw.split(/[\n,]+/).map(l => l.trim()).filter(Boolean);
  return lines.map(line => {
    const clean = line
      .replace(/hxxps?/i, "https")
      .replace(/\[\.\]/g, ".")
      .replace(/\s/g, "");
    try {
      const url = new URL(clean);
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "movie" && parts[1]) return { type: "movie", id: parts[1], raw: clean };
      if (parts[0] === "tv" && parts[1]) {
        return { type: "tv", id: parts[1], season: parts[2] || null, episode: parts[3] || null, raw: clean };
      }
      return { type: "unknown", raw: clean };
    } catch {
      return { type: "error", raw: clean };
    }
  });
}

function toBlocklistCode(items) {
  const date = new Date().toISOString().split("T")[0];
  const lines = items.map(item => {
    if (item.type === "movie") return `  { type: "movie", id: "${item.id}", reason: "ALS Block ${date}" },`;
    if (item.type === "tv") {
      const s = item.season ? `, season: "${item.season}"` : "";
      const e = item.episode ? `, episode: "${item.episode}"` : "";
      return `  { type: "tv", id: "${item.id}"${s}${e}, reason: "ALS Block ${date}" },`;
    }
    return null;
  }).filter(Boolean);
  return `// Paste into app/lib/blocklist.js → BLOCKLIST array:\n${lines.join("\n")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  bg: "#050810",
  surface: "#0c1120",
  surfaceHi: "#121929",
  border: "rgba(255,255,255,0.06)",
  borderHi: "rgba(255,255,255,0.1)",
  brand: "#f43f5e",
  brandDim: "rgba(244,63,94,0.15)",
  brandBorder: "rgba(244,63,94,0.25)",
  green: "#10b981",
  amber: "#f59e0b",
  red: "#ef4444",
  muted: "rgba(255,255,255,0.35)",
  text: "rgba(255,255,255,0.85)",
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────
function Badge({ color = C.brand, children, style = {} }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      background: color + "18",
      border: `1px solid ${color}33`,
      color,
      borderRadius: 6, padding: "2px 10px",
      fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
      ...style,
    }}>{children}</span>
  );
}

function Pill({ color = C.brand, children }) {
  return (
    <span style={{
      background: color + "14", border: `1px solid ${color}28`,
      color, borderRadius: 20, padding: "3px 12px",
      fontSize: 11, fontWeight: 700,
    }}>{children}</span>
  );
}

function GlassCard({ children, style = {} }) {
  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 20,
      overflow: "hidden",
      ...style,
    }}>{children}</div>
  );
}

function CardHeader({ left, right }) {
  return (
    <div style={{
      padding: "16px 22px",
      borderBottom: `1px solid ${C.border}`,
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
    }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: C.muted }}>{left}</span>
      {right}
    </div>
  );
}

function Btn({ children, onClick, disabled, variant = "ghost", style = {} }) {
  const base = {
    display: "inline-flex", alignItems: "center", gap: 7,
    padding: "9px 22px", borderRadius: 12,
    fontSize: 13, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
    transition: "all 0.18s",
    fontFamily: "inherit", border: "none",
    ...style,
  };
  if (variant === "primary") return (
    <button onClick={onClick} disabled={disabled} style={{
      ...base,
      background: `linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)`,
      color: "#fff",
      boxShadow: "0 4px 24px rgba(244,63,94,0.25)",
    }}>{children}</button>
  );
  if (variant === "ghost") return (
    <button onClick={onClick} disabled={disabled} style={{
      ...base,
      background: "transparent",
      border: `1px solid ${C.borderHi}`,
      color: C.muted,
    }}>{children}</button>
  );
  if (variant === "danger") return (
    <button onClick={onClick} disabled={disabled} style={{
      ...base,
      background: "rgba(239,68,68,0.08)",
      border: "1px solid rgba(239,68,68,0.2)",
      color: "rgba(239,68,68,0.8)",
    }}>{children}</button>
  );
  return <button onClick={onClick} disabled={disabled} style={base}>{children}</button>;
}

const typeColors = { movie: "#818cf8", tv: "#10b981", unknown: C.amber, error: C.red };

// ─────────────────────────────────────────────────────────────────────────────
// Login Screen
// ─────────────────────────────────────────────────────────────────────────────
function LoginScreen({ onAuth }) {
  const [pass, setPass] = useState("");
  const [shake, setShake] = useState(false);
  const [hint, setHint] = useState("");

  const submit = useCallback(() => {
    if (pass === ADMIN_PASS) {
      try { localStorage.setItem(AUTH_KEY, "1"); } catch {}
      onAuth();
    } else {
      setShake(true);
      setHint("Incorrect password.");
      setTimeout(() => setShake(false), 600);
    }
  }, [pass, onAuth]);

  return (
    <div style={{
      minHeight: "100vh", background: C.bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
        @keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        .login-card{animation:fadeIn .4s ease}
        .login-input:focus{border-color:rgba(244,63,94,0.5)!important;box-shadow:0 0 0 3px rgba(244,63,94,0.08)!important}
      `}</style>

      {/* Ambient glow */}
      <div style={{ position:"fixed",inset:0,pointerEvents:"none",overflow:"hidden",zIndex:0 }}>
        <div style={{ position:"absolute",top:"-20%",left:"50%",transform:"translateX(-50%)",width:600,height:600,borderRadius:"50%",background:"radial-gradient(circle,rgba(244,63,94,0.1) 0%,transparent 70%)",filter:"blur(40px)" }} />
      </div>

      <div className="login-card" style={{
        position:"relative", zIndex:1,
        width: "100%", maxWidth: 400,
        margin: "0 24px",
      }}>
        {/* Logo */}
        <div style={{ textAlign:"center", marginBottom: 36 }}>
          <div style={{
            width:56, height:56, borderRadius:16,
            background:"linear-gradient(135deg, rgba(244,63,94,0.2), rgba(225,29,72,0.1))",
            border:"1px solid rgba(244,63,94,0.3)",
            display:"flex", alignItems:"center", justifyContent:"center",
            margin:"0 auto 16px",
          }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(244,63,94,0.9)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>
          <h1 style={{ fontSize:22, fontWeight:800, color:"#fff", margin:"0 0 4px" }}>ALS Admin</h1>
          <p style={{ fontSize:13, color:C.muted, margin:0 }}>Automated Link Suspender · VidZen</p>
        </div>

        {/* Card */}
        <div style={{
          background:C.surface, border:`1px solid ${C.border}`,
          borderRadius:24, padding:"28px 28px 24px",
          animation: shake ? "shake .5s ease" : "none",
        }}>
          <label style={{ display:"block", fontSize:12, fontWeight:600, color:C.muted, marginBottom:8, letterSpacing:"0.06em" }}>
            ADMIN PASSWORD
          </label>
          <input
            className="login-input"
            type="password"
            value={pass}
            onChange={e => { setPass(e.target.value); setHint(""); }}
            onKeyDown={e => e.key === "Enter" && submit()}
            placeholder="Enter password"
            autoFocus
            style={{
              width:"100%", padding:"12px 16px",
              background:"rgba(255,255,255,0.03)",
              border:`1px solid ${C.border}`,
              borderRadius:12, color:"#fff",
              fontSize:14, fontFamily:"inherit",
              outline:"none", boxSizing:"border-box",
              marginBottom: hint ? 8 : 20,
              transition:"all 0.2s",
            }}
          />
          {hint && <p style={{ fontSize:12, color:"rgba(239,68,68,0.8)", margin:"0 0 16px" }}>{hint}</p>}

          <button
            onClick={submit}
            style={{
              width:"100%", padding:"12px",
              background:"linear-gradient(135deg, #f43f5e, #e11d48)",
              border:"none", borderRadius:12,
              color:"#fff", fontSize:14, fontWeight:700,
              cursor:"pointer", fontFamily:"inherit",
              boxShadow:"0 4px 20px rgba(244,63,94,0.3)",
              transition:"opacity 0.2s",
            }}
          >
            Unlock Admin Panel →
          </button>
        </div>

        <p style={{ textAlign:"center", marginTop:20, fontSize:11, color:"rgba(255,255,255,0.2)" }}>
          Access restricted · DSA Compliance Tool
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main ALS Panel
// ─────────────────────────────────────────────────────────────────────────────
function ALSPanel({ onLogout }) {
  const [input, setInput] = useState("");
  const [parsed, setParsed] = useState([]);
  const [committed, setCommitted] = useState([]);
  const [tab, setTab] = useState("add");
  const [copied, setCopied] = useState(false);
  const [search, setSearch] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    const load = async () => {
      let local = [];
      try { local = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch {}
      try {
        const res = await fetch(`/api/admin/blocklist?auth=${encodeURIComponent(ADMIN_PASS)}`, { headers: { "x-als-auth": ADMIN_PASS } });
        if (res.ok) {
          const { blocklist } = await res.json();
          if (blocklist && Array.isArray(blocklist)) {
            const serverItems = blocklist.map(b => ({ ...b, server: true }));
            const merged = [...serverItems];
            for (const item of local) {
              if (!merged.some(c => c.type === item.type && c.id === String(item.id) && c.season === String(item.season) && c.episode === String(item.episode))) {
                merged.push(item);
              }
            }
            setCommitted(merged);
            return;
          }
        }
      } catch (err) {
        console.error("Failed to load server blocklist", err);
      }
      setCommitted(local);
    };
    load();
  }, []);

  const save = list => {
    setCommitted(list);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list.filter(i => !i.server))); } catch {}
  };

  const handleParse = () => {
    setParsed(parseUrls(input));
    setConfirmed(false);
  };

  const handleCommit = () => {
    const valid = parsed.filter(p => p.type === "movie" || p.type === "tv");
    const next = [...committed];
    for (const item of valid) {
      if (!next.some(c => c.type === item.type && c.id === item.id && c.season === item.season && c.episode === item.episode)) {
        next.push({ ...item, addedAt: Date.now() });
      }
    }
    save(next);
    setParsed([]); setInput(""); setConfirmed(false);
    setTab("list");
  };

  const handleRemove = idx => {
    const next = [...committed];
    if (next[idx].server) {
      alert("This entry is hardcoded in blocklist.js. You must remove it from the code to unsuspend it permanently.");
      return;
    }
    next.splice(idx, 1);
    save(next);
  };

  const handleCopy = () => {
    const localOnly = committed.filter(c => !c.server);
    if (localOnly.length === 0) {
      alert("No new pending items to copy!");
      return;
    }
    navigator.clipboard.writeText(toBlocklistCode(localOnly))
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); });
  };

  const validParsed = parsed.filter(p => p.type === "movie" || p.type === "tv");
  const filtered = search.trim()
    ? committed.filter(c => c.id.includes(search) || c.type.includes(search))
    : committed;

  const stats = {
    total: committed.length,
    movies: committed.filter(c => c.type === "movie").length,
    tv: committed.filter(c => c.type === "tv").length,
  };

  return (
    <div style={{
      minHeight:"100vh", background:C.bg,
      fontFamily:"'Plus Jakarta Sans', system-ui, sans-serif", color:"#fff",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500&display=swap');
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        .als-row:hover{background:rgba(255,255,255,0.025)!important}
        .tab-btn:hover{color:rgba(255,255,255,0.7)!important}
        .btn-ghost:hover{background:rgba(255,255,255,0.06)!important;color:rgba(255,255,255,0.7)!important}
        textarea:focus{border-color:rgba(244,63,94,0.4)!important;outline:none}
        input:focus{border-color:rgba(244,63,94,0.4)!important;outline:none}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.08);border-radius:4px}
      `}</style>

      {/* ── Ambient glows */}
      <div style={{position:"fixed",inset:0,pointerEvents:"none",overflow:"hidden",zIndex:0}}>
        <div style={{position:"absolute",top:"-10%",left:"60%",width:500,height:500,borderRadius:"50%",background:"radial-gradient(circle,rgba(244,63,94,0.06) 0%,transparent 70%)",filter:"blur(50px)"}} />
        <div style={{position:"absolute",bottom:"0",left:"10%",width:400,height:400,borderRadius:"50%",background:"radial-gradient(circle,rgba(16,185,129,0.04) 0%,transparent 70%)",filter:"blur(40px)"}} />
      </div>

      {/* ── Header */}
      <header style={{
        position:"sticky",top:0,zIndex:100,
        background:"rgba(5,8,16,0.85)",
        backdropFilter:"blur(20px) saturate(180%)",
        borderBottom:`1px solid ${C.border}`,
        padding:"0 28px",
        height:64,
        display:"flex", alignItems:"center", justifyContent:"space-between", gap:16,
      }}>
        <div style={{display:"flex", alignItems:"center", gap:14}}>
          {/* Shield logo */}
          <div style={{
            width:38, height:38, borderRadius:12, flexShrink:0,
            background:"linear-gradient(135deg,rgba(244,63,94,0.2),rgba(225,29,72,0.1))",
            border:"1px solid rgba(244,63,94,0.3)",
            display:"flex", alignItems:"center", justifyContent:"center",
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(244,63,94,0.9)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <div>
            <p style={{fontSize:15, fontWeight:800, margin:0, lineHeight:1.2}}>Automated Link Suspender</p>
            <p style={{fontSize:11, color:C.muted, margin:0}}>VidZen DSA Compliance · Admin</p>
          </div>
        </div>

        <div style={{display:"flex", alignItems:"center", gap:10}}>
          <Pill color={C.green}>{stats.total} Suspended</Pill>
          <button onClick={onLogout} className="btn-ghost" style={{
            background:"transparent", border:`1px solid ${C.border}`,
            color:C.muted, borderRadius:10, padding:"6px 14px",
            fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit",
            transition:"all 0.15s",
          }}>Log out</button>
        </div>
      </header>

      {/* ── Stats bar */}
      <div style={{
        position:"relative", zIndex:1,
        padding:"20px 28px 0",
        display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:12,
        maxWidth:960, margin:"0 auto",
      }}>
        {[
          { label:"Total Suspended", value:stats.total, color:C.brand, icon:"🔒" },
          { label:"Movies", value:stats.movies, color:"#818cf8", icon:"🎬" },
          { label:"TV Shows", value:stats.tv, color:C.green, icon:"📺" },
        ].map(s => (
          <div key={s.label} style={{
            background:C.surface, border:`1px solid ${C.border}`,
            borderRadius:16, padding:"16px 20px",
            display:"flex", alignItems:"center", gap:14,
          }}>
            <span style={{fontSize:24}}>{s.icon}</span>
            <div>
              <p style={{fontSize:24, fontWeight:800, margin:0, color:s.color, lineHeight:1}}>{s.value}</p>
              <p style={{fontSize:11, color:C.muted, margin:"3px 0 0", fontWeight:500}}>{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Main content */}
      <main style={{
        position:"relative", zIndex:1,
        maxWidth:960, margin:"24px auto 0",
        padding:"0 28px 60px",
        animation:"fadeUp .35s ease",
      }}>

        {/* Tabs */}
        <div style={{display:"flex", gap:4, marginBottom:24, background:C.surface, borderRadius:14, padding:4, border:`1px solid ${C.border}`, width:"fit-content"}}>
          {[["add","+ Add URLs"],["list",`Suspended (${stats.total})`]].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} className="tab-btn" style={{
              padding:"8px 22px", borderRadius:10, border:"none",
              fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit",
              background: tab === key ? "rgba(244,63,94,0.15)" : "transparent",
              color: tab === key ? "#f43f5e" : C.muted,
              transition:"all 0.15s",
            }}>{label}</button>
          ))}
        </div>

        {/* ═══ ADD TAB ════════════════════════════════════════════ */}
        {tab === "add" && (
          <div style={{display:"flex", flexDirection:"column", gap:20}}>
            <GlassCard>
              <CardHeader
                left="Paste URLs to suspend"
                right={<Badge color={C.muted}>Supports hxxps://vidzen[.]fun/... format</Badge>}
              />
              <div style={{padding:"16px 20px"}}>
                <textarea
                  value={input}
                  onChange={e => { setInput(e.target.value); setParsed([]); }}
                  placeholder={"https://vidzen.fun/movie/1613798\nhxxps://vidzen[.]fun/tv/299172/1/1\nhttps://vidzen.fun/tv/137883/2/5\n\n# Paste the full DMCA URL list here..."}
                  style={{
                    width:"100%", minHeight:200, background:"rgba(255,255,255,0.02)",
                    border:`1px solid ${C.border}`, borderRadius:12,
                    padding:"14px 16px", color:"#fff", fontSize:13,
                    fontFamily:"'Fira Code', monospace", lineHeight:1.7,
                    resize:"vertical", boxSizing:"border-box", transition:"border-color 0.2s",
                  }}
                />
                <div style={{marginTop:14, display:"flex", gap:10, alignItems:"center"}}>
                  <Btn variant="primary" onClick={handleParse} disabled={!input.trim()}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                    Parse URLs
                  </Btn>
                  {parsed.length > 0 && (
                    <span style={{fontSize:12, color:C.muted}}>
                      {validParsed.length} valid · {parsed.length - validParsed.length} skipped
                    </span>
                  )}
                </div>
              </div>
            </GlassCard>

            {/* Preview */}
            {parsed.length > 0 && (
              <GlassCard style={{animation:"fadeUp .25s ease"}}>
                <CardHeader
                  left={`Preview — ${parsed.length} parsed`}
                  right={<Pill color={C.green}>{validParsed.length} will be blocked</Pill>}
                />
                <div style={{maxHeight:260, overflowY:"auto"}}>
                  {parsed.map((item, i) => (
                    <div key={i} className="als-row" style={{
                      padding:"10px 20px",
                      borderBottom:`1px solid ${C.border}`,
                      display:"flex", alignItems:"center", gap:10,
                      transition:"background 0.1s",
                    }}>
                      <Badge color={typeColors[item.type]}>{item.type}</Badge>
                      <span style={{flex:1, fontSize:12, color:C.muted, fontFamily:"monospace", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
                        {item.type === "movie" && `id: ${item.id}`}
                        {item.type === "tv" && `id: ${item.id}${item.season ? ` · S${item.season}` : ""}${item.episode ? `E${item.episode}` : " · all episodes"}`}
                        {(item.type === "unknown" || item.type === "error") && item.raw}
                      </span>
                      {(item.type === "movie" || item.type === "tv")
                        ? <Pill color={C.brand}>Will block</Pill>
                        : <Pill color={C.amber}>Skipped</Pill>
                      }
                    </div>
                  ))}
                </div>

                {/* Confirm + suspend */}
                <div style={{padding:"16px 20px", borderTop:`1px solid ${C.border}`, display:"flex", alignItems:"center", gap:14, flexWrap:"wrap"}}>
                  <label style={{display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontSize:13, color:C.muted}}>
                    <input
                      type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}
                      style={{width:16, height:16, accentColor:C.brand, cursor:"pointer"}}
                    />
                    I confirm these URLs should be suspended under DSA / DMCA notice
                  </label>
                  <Btn variant="primary" onClick={handleCommit} disabled={!confirmed || validParsed.length === 0}>
                    🔒 Suspend {validParsed.length} Link{validParsed.length !== 1 ? "s" : ""} Now
                  </Btn>
                </div>
              </GlassCard>
            )}
          </div>
        )}

        {/* ═══ LIST TAB ════════════════════════════════════════════ */}
        {tab === "list" && (
          <div style={{display:"flex", flexDirection:"column", gap:16}}>
            {/* Toolbar */}
            <div style={{display:"flex", gap:12, alignItems:"center", flexWrap:"wrap"}}>
              <div style={{flex:1, minWidth:200, position:"relative"}}>
                <svg style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}
                  width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" strokeLinecap="round">
                  <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                </svg>
                <input
                  value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search by ID or type…"
                  style={{
                    width:"100%", padding:"9px 12px 9px 36px",
                    background:C.surface, border:`1px solid ${C.border}`,
                    borderRadius:12, color:"#fff", fontSize:13, fontFamily:"inherit",
                    boxSizing:"border-box", transition:"border-color 0.2s",
                  }}
                />
              </div>
              <Btn variant="ghost" onClick={handleCopy} className="btn-ghost" style={{flexShrink:0}}>
                {copied
                  ? <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!</>
                  : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy blocklist.js code</>
                }
              </Btn>
            </div>

            <GlassCard>
              {committed.length === 0
                ? (
                  <div style={{padding:"60px 20px", textAlign:"center", color:C.muted}}>
                    <div style={{fontSize:40, marginBottom:12}}>🔓</div>
                    <p style={{fontSize:14, margin:0}}>No links suspended yet.</p>
                    <p style={{fontSize:12, margin:"6px 0 0", color:"rgba(255,255,255,0.2)"}}>Use the "Add URLs" tab to get started.</p>
                  </div>
                )
                : (
                  <>
                    <CardHeader
                      left={`${filtered.length} of ${committed.length} entries`}
                      right={search ? <Pill color={C.amber}>Filtered</Pill> : null}
                    />
                    <div style={{maxHeight:460, overflowY:"auto"}}>
                      {filtered.map((item, i) => {
                        const realIdx = committed.indexOf(item);
                        return (
                          <div key={i} className="als-row" style={{
                            padding:"11px 20px",
                            borderBottom:`1px solid ${C.border}`,
                            display:"flex", alignItems:"center", gap:10,
                            transition:"background 0.1s",
                          }}>
                            <Badge color={typeColors[item.type]} style={{flexShrink:0, width:46, justifyContent:"center"}}>{item.type}</Badge>
                            <div style={{flex:1, minWidth:0}}>
                              <p style={{margin:0, fontSize:12, fontFamily:"monospace", color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
                                id: {item.id}
                                {item.type === "tv" && (item.season
                                  ? ` · S${item.season}${item.episode ? `E${item.episode}` : "→all"}`
                                  : " · ALL seasons")}
                              </p>
                              {item.addedAt && (
                                <p style={{margin:0, fontSize:10, color:"rgba(255,255,255,0.25)"}}>
                                  Added {new Date(item.addedAt).toLocaleDateString()}
                                </p>
                              )}
                              {item.server && item.reason && (
                                <p style={{margin:0, fontSize:10, color:"rgba(255,255,255,0.25)"}}>
                                  {item.reason}
                                </p>
                              )}
                            </div>
                            {item.server ? <Pill color={C.brand}>🔒 Hardcoded</Pill> : <Pill color={C.amber}>⏳ Pending Deploy</Pill>}
                            <button
                              onClick={() => handleRemove(realIdx)}
                              className="btn-ghost"
                              title={item.server ? "Cannot remove hardcoded items here" : "Unsuspend"}
                              style={{
                                background:"none", border:`1px solid ${C.border}`,
                                color:"rgba(255,255,255,0.25)", borderRadius:8,
                                padding:"5px 10px", fontSize:11, cursor: item.server ? "not-allowed" : "pointer",
                                fontFamily:"inherit", flexShrink:0, transition:"all 0.15s",
                                opacity: item.server ? 0.3 : 1
                              }}
                              onMouseEnter={e => { if (!item.server) { e.currentTarget.style.borderColor="rgba(239,68,68,0.4)"; e.currentTarget.style.color="rgba(239,68,68,0.8)"; } }}
                              onMouseLeave={e => { if (!item.server) { e.currentTarget.style.borderColor=C.border; e.currentTarget.style.color="rgba(255,255,255,0.25)"; } }}
                            >✕</button>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )
              }
            </GlassCard>

            {/* Deploy instruction */}
            {committed.length > 0 && (
              <div style={{
                background:"rgba(99,102,241,0.06)",
                border:"1px solid rgba(99,102,241,0.14)",
                borderRadius:14, padding:"14px 18px",
                fontSize:13, color:"rgba(255,255,255,0.4)", lineHeight:1.8,
              }}>
                <strong style={{color:"rgba(129,140,248,0.9)"}}>📋 To make suspensions permanent across deploys:</strong>
                {" "}Click <em>Copy blocklist.js code</em> → paste the entries into{" "}
                <code style={{background:"rgba(255,255,255,0.06)",borderRadius:4,padding:"1px 6px",fontFamily:"monospace",fontSize:12}}>app/lib/blocklist.js</code>
                {" "}→ <code style={{background:"rgba(255,255,255,0.06)",borderRadius:4,padding:"1px 6px",fontFamily:"monospace",fontSize:12}}>BLOCKLIST</code> array → redeploy.
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root export
// ─────────────────────────────────────────────────────────────────────────────
export default function ALSAdminPage() {
  const [authed, setAuthed] = useState(null); // null = checking

  useEffect(() => {
    try {
      setAuthed(localStorage.getItem(AUTH_KEY) === "1");
    } catch {
      setAuthed(false);
    }
  }, []);

  const logout = () => {
    try { localStorage.removeItem(AUTH_KEY); } catch {}
    setAuthed(false);
  };

  // Still hydrating
  if (authed === null) return (
    <div style={{minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center"}}>
      <div style={{width:24,height:24,borderRadius:"50%",border:"2px solid rgba(244,63,94,0.3)",borderTopColor:"#f43f5e",animation:"spin 0.8s linear infinite"}} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (!authed) return <LoginScreen onAuth={() => setAuthed(true)} />;
  return <ALSPanel onLogout={logout} />;
}
