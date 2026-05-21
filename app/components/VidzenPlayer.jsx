"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { MediaPlayer, MediaProvider } from "@vidstack/react";
import {
  defaultLayoutIcons,
  DefaultVideoLayout,
} from "@vidstack/react/player/layouts/default";
import "@vidstack/react/player/styles/default/theme.css";
import "@vidstack/react/player/styles/default/layouts/video.css";
import { saveProgress, getProgress } from "../lib/watchProgress";

const TMDB_KEY = process.env.NEXT_PUBLIC_TMDB_API_KEY || "5263089f83877823a641b104f4f8d041";
const SAVE_INTERVAL = 5000;

const SERVER_LABELS = {
  "sv-c3d5": { name: "Alpha", color: "#22c55e" },
  "sv-a1f3": { name: "Core",  color: "#3b82f6" },
  "sv-b2e4": { name: "Fast",  color: "#8b5cf6" },
  "sv-d4c6": { name: "Orbit", color: "#10b981" },
  "sv-e5b7": { name: "Delta", color: "#f59e0b" },
};

export default function VidzenPlayer({ type = "movie", id, season, episode }) {
  const playerRef = useRef(null);
  const [sources, setSources] = useState([]);
  const sourcesRef = useRef(sources);
  const [subtitles, setSubtitles] = useState([]);
  const [currentServer, setCurrentServer] = useState(null);
  const [availableServers, setAvailableServers] = useState([]);
  const [error, setError] = useState(null);
  const [switching, setSwitching] = useState(null);
  const [serverMenuOpen, setServerMenuOpen] = useState(false);
  const [failedServers, setFailedServers] = useState(new Set());
  const [meta, setMeta] = useState({ title: "", poster: "", backdrop: "" });
  const [devToolsBlocked, setDevToolsBlocked] = useState(false);
  const [toast, setToast] = useState(null); // { message, type: 'error' | 'warn' }

  const progressRef = useRef({ time: 0, duration: 0 });
  const saveTimerRef = useRef(null);

  // ── DevTools Detection (from SiteGuard) ───────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      const blocked = e.detail?.blocked ?? false;
      setDevToolsBlocked(blocked);
      if (blocked) {
        try { playerRef.current?.pause(); } catch {}
      }
    };
    window.addEventListener('vz:devtools', handler);
    return () => window.removeEventListener('vz:devtools', handler);
  }, []);

  // ── Fetch TMDB metadata ─────────────────────────────────────────────────
  useEffect(() => {
    async function fetchMeta() {
      try {
        const url = type === "movie"
          ? `https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_KEY}`
          : `https://api.themoviedb.org/3/tv/${id}?api_key=${TMDB_KEY}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setMeta({
            title: data.title || data.name || "",
            poster: data.poster_path ? `https://image.tmdb.org/t/p/w780${data.poster_path}` : "",
            backdrop: data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : "",
          });
        }
      } catch { /* non-critical */ }
    }
    fetchMeta();
  }, [id, type]);

  // ── Toast notification helper ────────────────────────────────────────
  const showToast = useCallback((message, type = 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // ── Fetch sources from bridge API ───────────────────────────────────────
  const fetchSources = useCallback(async (server = null) => {
    setError(null);
    if (server) setSwitching(server);
    try {
      const params = new URLSearchParams({ type, id });
      if (season) params.set("season", season);
      if (episode) params.set("episode", episode);
      if (server) params.set("server", server);

      const res = await fetch(`/api/sources?${params}`);
      const data = await res.json();

      if (data.servers) setAvailableServers(data.servers);

      if (!data.sources?.length) {
        // Server switch failed — DON'T clear current stream
        if (server && sourcesRef.current.length > 0) {
          setFailedServers(prev => new Set([...prev, server]));
          // Show a toast instead of replacing the player
          const msg = data.error || `${SERVER_LABELS[server]?.name || server} is unavailable`;
          showToast(msg, 'error');
          setSwitching(null);
          return; // Keep current stream playing
        }
        throw new Error(data.error || "No sources found");
      }

      // Handle fallback responses (stale cache used when forced server failed)
      if (data.fallback && data.error) {
        showToast(data.error, 'warn');
      }

      setSources(data.sources);
      sourcesRef.current = data.sources;
      setCurrentServer(data.provider);

      // Fetch subtitles from our subs API if provider didn't return any
      if (!data.subtitles?.length) {
        fetchSubtitles();
      } else {
        setSubtitles(data.subtitles);
      }
      setSwitching(null);
    } catch (err) {
      console.error("[VidzenPlayer] Source fetch failed:", err.message);
      // Only show error overlay if we have NO current sources at all
      if (!sourcesRef.current.length) {
        setError(err.message);
      } else {
        showToast(err.message, 'error');
      }
      setSwitching(null);
    }
  }, [type, id, season, episode, showToast]);

  // ── Fetch subtitles from our /api/subs endpoint ─────────────────────────
  const fetchSubtitles = useCallback(async () => {
    try {
      const params = new URLSearchParams({ tmdb_id: id, type });
      if (season) params.set("season", season);
      if (episode) params.set("episode", episode);
      const res = await fetch(`/api/subs?${params}`);
      if (res.ok) {
        const data = await res.json();
        if (data?.subtitles?.length) setSubtitles(data.subtitles);
      }
    } catch { /* non-critical */ }
  }, [id, type, season, episode]);

  useEffect(() => { fetchSources(); }, [fetchSources]);

  // ── Auto-clear failed servers after 2 minutes (transient 502s recover) ───
  useEffect(() => {
    if (failedServers.size === 0) return;
    const timer = setTimeout(() => {
      console.log("[VidzenPlayer] Auto-clearing failed servers (2m cooldown)");
      setFailedServers(new Set());
    }, 2 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [failedServers]);


  // ── Watch progress: save periodically ───────────────────────────────────
  useEffect(() => {
    saveTimerRef.current = setInterval(() => {
      const { time, duration } = progressRef.current;
      if (time > 0 && duration > 0) {
        saveProgress({
          type, id, season, episode,
          watched: time, duration,
          title: meta.title,
          poster_path: meta.poster?.replace("https://image.tmdb.org/t/p/w780", "") || "",
          backdrop_path: meta.backdrop?.replace("https://image.tmdb.org/t/p/w1280", "") || "",
        });
      }
    }, SAVE_INTERVAL);
    return () => clearInterval(saveTimerRef.current);
  }, [type, id, season, episode, meta]);

  // ── Watch progress: restore on mount ────────────────────────────────────
  const handleCanPlay = useCallback(() => {
    const saved = getProgress(type, id, season, episode);
    if (saved && saved.watched > 15 && playerRef.current) {
      playerRef.current.currentTime = saved.watched;
    }
  }, [type, id, season, episode]);

  // ── Track playback time ─────────────────────────────────────────────────
  const handleTimeUpdate = useCallback((detail) => {
    progressRef.current.time = detail.currentTime;
    progressRef.current.duration = detail.duration;
  }, []);

  // ── Handle playback errors → try next server ───────────────────────────
  const handleError = useCallback(() => {
    console.warn("[VidzenPlayer] Playback error on server:", currentServer);
    if (!currentServer) return;
    setFailedServers(prev => new Set([...prev, currentServer]));
    const remaining = availableServers.filter(
      s => s !== currentServer && !failedServers.has(s)
    );
    if (remaining.length > 0) {
      console.log("[VidzenPlayer] Falling back to:", remaining[0]);
      fetchSources(remaining[0]);
    }
  }, [currentServer, availableServers, failedServers, fetchSources]);

  // ── Switch server manually ──────────────────────────────────────────────
  const switchServer = useCallback((server) => {
    if (server === currentServer) return;
    setServerMenuOpen(false);
    fetchSources(server);
  }, [currentServer, fetchSources]);

  // ── Safely handle autoplay failures (browser policy) ────────────────────
  const handlePlay = useCallback(() => {
    if (!playerRef.current) return;
    playerRef.current.play().catch((err) => {
      if (err.name === "NotAllowedError") {
        // Browser blocked autoplay — retry muted
        playerRef.current.muted = true;
        playerRef.current.play().catch(() => {});
      }
    });
  }, []);

  // ── Build Vidstack src ──────────────────────────────────────────────────
  // CRITICAL: Never pass empty string "" to <MediaPlayer src=...>
  // That destroys Vidstack's internal state machine ($state) and causes
  // "this.$state[prop2] is not a function" crash.
  const hasSources = sources.length > 0;
  const playerSrc = hasSources ? sources[0].url : undefined;
  const playerType = hasSources
    ? (sources[0].type === "hls" || sources[0].url?.includes(".m3u8")
      ? "application/x-mpegurl"
      : "video/mp4")
    : "video/mp4";

  const displayTitle = type === "tv" && meta.title
    ? `${meta.title} S${season}E${episode}`
    : meta.title || "";

  // ── Only show error if ALL providers failed AND we have no sources ──────
  const showError = error && !hasSources;

  return (
    <div style={styles.wrapper}>
      {/* Always render the player — Vidstack shows poster + buffering natively */}
      <MediaPlayer
        ref={playerRef}
        src={hasSources ? { src: playerSrc, type: playerType } : ""}
        title={displayTitle}
        poster={meta.backdrop || meta.poster}
        crossOrigin="anonymous"
        playsInline
        autoPlay={hasSources}
        preload={hasSources ? "auto" : "none"}
        onCanPlay={() => {
          handleCanPlay();
          handlePlay();
        }}
        onTimeUpdate={handleTimeUpdate}
        onError={handleError}
        style={{ width: "100%", height: "100%" }}
      >
        <MediaProvider>
          {subtitles.map((sub, i) => (
            <track
              key={`${sub.url}-${i}`}
              kind="subtitles"
              src={sub.url?.startsWith("http") ? `/api/subs?url=${encodeURIComponent(sub.url)}` : sub.url}
              srcLang={sub.lang?.slice(0, 2)?.toLowerCase() || "en"}
              label={sub.lang || "Unknown"}
              default={i === 0}
            />
          ))}
        </MediaProvider>
        <DefaultVideoLayout icons={defaultLayoutIcons} />
      </MediaPlayer>

      {/* DevTools blocking overlay */}
      {devToolsBlocked && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 9999,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          background: "rgba(3,7,18,0.97)", backdropFilter: "blur(20px)",
        }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 16, opacity: 0.8 }}>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <h3 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 8, letterSpacing: "0.02em" }}>
            Streaming Blocked
          </h3>
          <p style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 13, color: "rgba(255,255,255,0.5)", maxWidth: 280, lineHeight: 1.5, textAlign: "center" }}>
            Developer Tools have been detected. Please close DevTools to resume playback.
          </p>
        </div>
      )}

      {/* Server switching overlay — shows over the player while loading */}
      {switching && (
        <div style={styles.switchOverlay}>
          <div style={styles.switchSpinner} />
          <p style={styles.switchText}>Switching to {SERVER_LABELS[switching]?.name || switching}...</p>
        </div>
      )}

      {/* Error overlay — only when no sources at all */}
      {showError && (
        <div style={styles.errorOverlay}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <p style={styles.errorText}>No sources available</p>
          <button style={styles.retryBtn} onClick={() => {
            setFailedServers(new Set());
            setError(null);
            fetchSources();
          }}>Retry</button>
        </div>
      )}

      {/* Toast notification (server switch failures, fallback warnings) */}
      {toast && (
        <div style={{
          ...styles.toast,
          borderColor: toast.type === 'warn' ? 'rgba(245,158,11,0.4)' : 'rgba(239,68,68,0.4)',
          color: toast.type === 'warn' ? '#fbbf24' : '#fca5a5',
        }}>
          <span style={styles.toastIcon}>{toast.type === 'warn' ? '⚠️' : '❌'}</span>
          <span style={styles.toastText}>{toast.message}</span>
        </div>
      )}

      {/* Server Picker */}
      <div style={styles.serverBtnContainer}>
        <button
          style={styles.serverBtn}
          onClick={() => setServerMenuOpen(!serverMenuOpen)}
          title="Switch Server"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2" /><rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
            <line x1="6" y1="6" x2="6.01" y2="6" /><line x1="6" y1="18" x2="6.01" y2="18" />
          </svg>
          <span style={styles.serverBtnLabel}>
            {currentServer ? (SERVER_LABELS[currentServer]?.name || currentServer) : "..."}
          </span>
        </button>

        {serverMenuOpen && (
          <div style={styles.serverMenu}>
            {availableServers.map(server => {
              const info = SERVER_LABELS[server] || { name: server, color: "#888" };
              const isActive = server === currentServer;
              const isFailed = failedServers.has(server);
              return (
                <button
                  key={server}
                  style={{
                    ...styles.serverMenuItem,
                    opacity: isFailed ? 0.4 : 1,
                    cursor: isFailed ? "not-allowed" : "pointer",
                    background: isActive ? "rgba(255,255,255,0.1)" : "transparent",
                  }}
                  onClick={() => !isFailed && switchServer(server)}
                  disabled={isFailed}
                >
                  <span style={{
                    ...styles.serverDot,
                    background: isActive ? info.color : isFailed ? "#555" : info.color + "80",
                    boxShadow: isActive ? `0 0 8px ${info.color}` : "none",
                  }} />
                  <span style={styles.serverName}>{info.name}</span>
                  {isActive && <span style={styles.serverActive}>●</span>}
                  {isFailed && <span style={styles.serverFailed}>✗</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  wrapper: {
    position: "relative",
    width: "100%",
    aspectRatio: "16/9",
    background: "#000",
    borderRadius: "8px",
    overflow: "hidden",
  },
  switchOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.6)",
    backdropFilter: "blur(4px)",
    zIndex: 35,
    gap: "12px",
    transition: "opacity 0.3s",
  },
  switchSpinner: {
    width: "32px",
    height: "32px",
    border: "3px solid rgba(255,255,255,0.15)",
    borderTopColor: "#8b5cf6",
    borderRadius: "50%",
    animation: "vidzen-spin 0.7s linear infinite",
  },
  switchText: {
    fontSize: "13px",
    color: "rgba(255,255,255,0.8)",
    fontFamily: "'Inter', -apple-system, sans-serif",
    margin: 0,
  },
  errorOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.85)",
    zIndex: 40,
    gap: "12px",
  },
  errorText: {
    fontSize: "16px",
    color: "#ef4444",
    fontFamily: "'Inter', -apple-system, sans-serif",
    margin: 0,
  },
  retryBtn: {
    padding: "8px 24px",
    background: "rgba(139, 92, 246, 0.2)",
    color: "#c4b5fd",
    border: "1px solid rgba(139, 92, 246, 0.4)",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "13px",
    fontFamily: "'Inter', -apple-system, sans-serif",
    transition: "all 0.2s",
  },
  serverBtnContainer: {
    position: "absolute",
    top: "12px",
    right: "12px",
    zIndex: 50,
  },
  serverBtn: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 12px",
    background: "rgba(0,0,0,0.7)",
    backdropFilter: "blur(8px)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "6px",
    color: "rgba(255,255,255,0.9)",
    cursor: "pointer",
    fontSize: "12px",
    fontFamily: "'Inter', -apple-system, sans-serif",
    transition: "all 0.2s",
  },
  serverBtnLabel: {
    fontWeight: 500,
  },
  serverMenu: {
    position: "absolute",
    top: "calc(100% + 6px)",
    right: 0,
    minWidth: "160px",
    background: "rgba(10,10,10,0.95)",
    backdropFilter: "blur(12px)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "8px",
    padding: "4px",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
  },
  serverMenuItem: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    border: "none",
    borderRadius: "6px",
    color: "rgba(255,255,255,0.85)",
    fontSize: "13px",
    fontFamily: "'Inter', -apple-system, sans-serif",
    transition: "all 0.15s",
    textAlign: "left",
    width: "100%",
  },
  serverDot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    flexShrink: 0,
  },
  serverName: {
    flex: 1,
    fontWeight: 500,
  },
  serverActive: {
    color: "#22c55e",
    fontSize: "10px",
  },
  serverFailed: {
    color: "#ef4444",
    fontSize: "12px",
    fontWeight: "bold",
  },
  toast: {
    position: "absolute",
    bottom: "60px",
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 18px",
    background: "rgba(10,10,10,0.9)",
    backdropFilter: "blur(12px)",
    border: "1px solid rgba(239,68,68,0.4)",
    borderRadius: "8px",
    zIndex: 45,
    maxWidth: "90%",
    animation: "vidzen-toast-in 0.3s ease-out",
    boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
  },
  toastIcon: {
    fontSize: "14px",
    flexShrink: 0,
  },
  toastText: {
    fontSize: "12px",
    fontFamily: "'Inter', -apple-system, sans-serif",
    fontWeight: 500,
    lineHeight: 1.4,
  },
};

// Inject keyframe animation for spinner
if (typeof document !== "undefined" && !document.getElementById("vidzen-keyframes")) {
  const style = document.createElement("style");
  style.id = "vidzen-keyframes";
  style.textContent = `
    @keyframes vidzen-spin { to { transform: rotate(360deg); } }
    @keyframes vidzen-toast-in {
      from { opacity: 0; transform: translateX(-50%) translateY(10px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
  `;
  document.head.appendChild(style);
}
