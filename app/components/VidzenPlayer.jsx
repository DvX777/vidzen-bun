"use client";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { MediaPlayer, MediaProvider, Menu } from "@vidstack/react";
import {
  defaultLayoutIcons,
  DefaultVideoLayout,
  DefaultMenuButton,
  DefaultMenuSection,
  DefaultMenuRadioGroup,
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
  "sv-f6a8": { name: "Turbo", color: "#06b6d4" },
  "sv-g7b9": { name: "Flux",  color: "#ec4899" },
};

// ── Vidstack-native icons ─────────────────────────────────────────────────

// Provider/Server switch icon — matches Vidstack stroke style (settings-switch inspired)
function ProviderIcon(props) {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <path d="M7 10h18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M7 16h18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M7 22h18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
      <circle cx="12" cy="10" r="2.5" fill="currentColor"/>
      <circle cx="22" cy="16" r="2.5" fill="currentColor"/>
      <circle cx="15" cy="22" r="2.5" fill="currentColor"/>
    </svg>
  );
}


// Quality/resolution icon
function QualityMenuIcon(props) {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <rect x="4" y="6" width="24" height="16" rx="2" fill="currentColor"/>
      <path d="M11.5 18V12l3.5 3-3.5 3z" fill="var(--media-brand, #000)" opacity=".8"/>
      <text x="17" y="17" fontSize="7" fontWeight="700" fontFamily="sans-serif" fill="var(--media-brand, #000)" opacity=".8">HD</text>
      <path d="M12 25h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <path d="M16 22v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

// ── Parse source labels into quality + dub components ────────────────────
function parseSourceLabel(label) {
  if (!label || label === "Default") return { quality: "Auto", dub: "Original" };

  // Match patterns like "480p Original Audio", "1080p Arabic", "360p French"
  const qualityMatch = label.match(/(\d{3,4}p)/i);
  const quality = qualityMatch ? qualityMatch[1] : "Auto";

  // Extract dub/language — everything after the quality, or the whole label if no quality
  let dub = label;
  if (qualityMatch) {
    dub = label.replace(qualityMatch[0], "").trim();
  }
  // Clean up common patterns
  dub = dub.replace(/^[\s-]+|[\s-]+$/g, "");
  if (!dub || dub.toLowerCase() === "original audio") dub = "Original";

  return { quality, dub };
}


export default function VidzenPlayer({ type = "movie", id, season, episode }) {
  const playerRef = useRef(null);
  const [sources, setSources] = useState([]);
  const sourcesRef = useRef(sources);
  const [subtitles, setSubtitles] = useState([]);
  const [currentServer, setCurrentServer] = useState(null);
  const [currentSourceIndex, setCurrentSourceIndex] = useState(0);
  const [availableServers, setAvailableServers] = useState([]);
  const [error, setError] = useState(null);
  const [switching, setSwitching] = useState(null);
  const [failedServers, setFailedServers] = useState(new Set());
  const [meta, setMeta] = useState({ title: "", poster: "", backdrop: "" });
  const [devToolsBlocked, setDevToolsBlocked] = useState(false);
  const [toast, setToast] = useState(null);

  const progressRef = useRef({ time: 0, duration: 0 });
  const saveTimerRef = useRef(null);

  // ── Current provider's sources ────────────────────────────────────────
  const currentProviderSources = useMemo(() => {
    if (!currentServer) return [];
    return sources.filter(s => s.server === currentServer);
  }, [sources, currentServer]);

  // ── Helper: extract numeric quality for sorting ───────────────────────
  const numericQuality = (q) => {
    const m = q.match(/(\d+)/);
    return m ? parseInt(m[1]) : 0; // "Auto" → 0
  };

  // ── Parse & split: Quality menu vs Audio/Dub menu ─────────────────────
  const { qualityOptions, dubOptions, currentQuality, currentDub } = useMemo(() => {
    if (currentProviderSources.length === 0) {
      return { qualityOptions: [], dubOptions: [], currentQuality: "Auto", currentDub: "Original" };
    }

    // Parse all sources
    const parsed = currentProviderSources.map((src, idx) => {
      const { quality, dub } = parseSourceLabel(src.label);
      return { ...src, _idx: idx, _quality: quality, _dub: dub };
    });

    // Get unique qualities and dubs
    const qualitiesSet = new Map();
    const dubsSet = new Map();

    parsed.forEach(p => {
      if (!qualitiesSet.has(p._quality)) qualitiesSet.set(p._quality, p._idx);
      if (!dubsSet.has(p._dub)) dubsSet.set(p._dub, p._idx);
    });

    // For providers with "Server X" labels (vidcore/vidfast), treat them all as dubs
    const hasServerLabels = parsed.every(p => /^Server\s+\d+$/i.test(p.label || ""));

    let qualities = [];
    let dubs = [];

    if (hasServerLabels) {
      // vidcore/vidfast: No quality separation, all go to dubs/servers
      qualities = [{ label: "Auto", value: "Auto" }];
      dubs = parsed.map(p => ({
        label: p.label || `Server ${p._idx + 1}`,
        value: String(p._idx),
      }));
    } else {
      // moviebox/primesrc: Split by quality and dub
      qualities = Array.from(qualitiesSet.entries()).map(([q]) => ({
        label: q,
        value: q,
      }));
      dubs = Array.from(dubsSet.entries()).map(([d]) => ({
        label: d,
        value: d,
      }));
    }

    // Sort qualities numerically: 360p → 480p → 720p → 1080p (Auto last)
    qualities.sort((a, b) => {
      const na = numericQuality(a.label);
      const nb = numericQuality(b.label);
      if (na === 0 && nb === 0) return 0;
      if (na === 0) return 1;  // "Auto" goes last
      if (nb === 0) return -1;
      return na - nb;
    });

    // Current selection
    const activeParsed = parsed[currentSourceIndex] || parsed[0];
    const curQuality = activeParsed?._quality || "Auto";
    const curDub = activeParsed?._dub || "Original";

    return {
      qualityOptions: qualities,
      dubOptions: dubs.length > 1 ? dubs : [],
      currentQuality: curQuality,
      currentDub: curDub,
    };
  }, [currentProviderSources, currentSourceIndex]);

  // ── Quality/Dub switching — find matching source ──────────────────────
  const switchQuality = useCallback((newQuality) => {
    if (newQuality === currentQuality) return;
    // Find a source matching new quality + current dub (or first match)
    const match = currentProviderSources.findIndex(s => {
      const { quality } = parseSourceLabel(s.label);
      return quality === newQuality;
    });
    if (match >= 0) setCurrentSourceIndex(match);
  }, [currentQuality, currentProviderSources]);

  const switchDub = useCallback((newDub) => {
    if (newDub === currentDub) return;

    // For server-labeled sources, newDub is the index
    const asIdx = Number(newDub);
    if (!isNaN(asIdx) && asIdx >= 0 && asIdx < currentProviderSources.length) {
      setCurrentSourceIndex(asIdx);
      return;
    }

    // For quality+dub sources, find matching dub + current quality (or first match)
    const match = currentProviderSources.findIndex(s => {
      const { dub, quality } = parseSourceLabel(s.label);
      return dub === newDub && quality === currentQuality;
    });
    if (match >= 0) {
      setCurrentSourceIndex(match);
    } else {
      // Fallback: any source with this dub
      const fallback = currentProviderSources.findIndex(s => {
        const { dub } = parseSourceLabel(s.label);
        return dub === newDub;
      });
      if (fallback >= 0) setCurrentSourceIndex(fallback);
    }
  }, [currentDub, currentQuality, currentProviderSources]);

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
  const showToast = useCallback((message, toastType = 'error') => {
    setToast({ message, type: toastType });
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
        if (server && sourcesRef.current.length > 0) {
          const serverName = SERVER_LABELS[server]?.name || server;
          setFailedServers(prev => new Set([...prev, server]));
          const msg = `${serverName} is unavailable`;
          showToast(msg, 'error');
          setSwitching(null);
          return;
        }
        throw new Error(data.error || "No sources found");
      }

      if (data.fallback && data.error) {
        showToast(data.error, 'warn');
      }

      setSources(data.sources);
      sourcesRef.current = data.sources;
      setCurrentServer(data.provider);

      // Default to 480p (higher qualities like 720p/1080p get 429 rate-limited by upstream CDN)
      const provSources = data.sources.filter(s => s.server === data.provider);
      let bestIdx = 0;
      let bestDiff = Infinity;
      const TARGET_Q = 480;
      provSources.forEach((s, i) => {
        const m = (s.label || "").match(/(\d{3,4})p/i);
        const q = m ? parseInt(m[1]) : 0;
        const diff = Math.abs(q - TARGET_Q);
        if (q > 0 && diff < bestDiff) { bestDiff = diff; bestIdx = i; }
      });
      setCurrentSourceIndex(bestIdx);

      if (!data.subtitles?.length) {
        fetchSubtitles();
      } else {
        setSubtitles(data.subtitles);
      }
      setSwitching(null);
    } catch (err) {
      console.error("[VidzenPlayer] Source fetch failed:", err.message);
      if (!sourcesRef.current.length) {
        setError(err.message);
      } else {
        showToast(err.message, 'error');
      }
      setSwitching(null);
    }
  }, [type, id, season, episode, showToast]);

  // ── Fetch subtitles — FIX: was `tmdb_id`, API expects `id` ─────────────
  const fetchSubtitles = useCallback(async () => {
    try {
      const params = new URLSearchParams({ id, type });
      if (season) params.set("season", season);
      if (episode) params.set("episode", episode);
      const res = await fetch(`/api/subs?${params}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length) {
          setSubtitles(data.map(s => ({
            url: s.file || s.url,
            lang: s.label || s.language || "Unknown",
          })));
        } else if (data?.subtitles?.length) {
          setSubtitles(data.subtitles);
        }
      }
    } catch { /* non-critical */ }
  }, [id, type, season, episode]);

  useEffect(() => { fetchSources(); }, [fetchSources]);

  // ── Auto-clear failed servers after 2 minutes ───────────────────────────
  useEffect(() => {
    if (failedServers.size === 0) return;
    const timer = setTimeout(() => {
      setFailedServers(new Set());
    }, 2 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [failedServers]);

  // ── Watch progress ──────────────────────────────────────────────────────

  // Instant save helper — called before provider switch, on pause, tab close
  const saveNow = useCallback(() => {
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
  }, [type, id, season, episode, meta]);

  // Periodic save (every 5s)
  useEffect(() => {
    saveTimerRef.current = setInterval(saveNow, SAVE_INTERVAL);
    return () => clearInterval(saveTimerRef.current);
  }, [saveNow]);

  // Save on tab close / tab background — zero progress loss
  useEffect(() => {
    const onUnload = () => saveNow();
    const onVisChange = () => { if (document.hidden) saveNow(); };
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('visibilitychange', onVisChange);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      document.removeEventListener('visibilitychange', onVisChange);
    };
  }, [saveNow]);

  const handleCanPlay = useCallback(() => {
    const saved = getProgress(type, id, season, episode);
    if (saved && saved.watched > 15 && playerRef.current) {
      playerRef.current.currentTime = saved.watched;
    }
  }, [type, id, season, episode]);

  const handleTimeUpdate = useCallback((detail) => {
    progressRef.current.time = detail.currentTime;
    progressRef.current.duration = detail.duration;
  }, []);

  const handleError = useCallback(() => {
    if (!currentServer) return;
    setFailedServers(prev => new Set([...prev, currentServer]));
    const remaining = availableServers.filter(
      s => s !== currentServer && !failedServers.has(s)
    );
    if (remaining.length > 0) fetchSources(remaining[0]);
  }, [currentServer, availableServers, failedServers, fetchSources]);

  const switchServer = useCallback((server) => {
    if (server === currentServer) return;
    saveNow();  // Save progress BEFORE switching — no seconds lost
    fetchSources(server);
  }, [currentServer, fetchSources, saveNow]);

  const handlePlay = useCallback(() => {
    if (!playerRef.current) return;
    playerRef.current.play().catch((err) => {
      if (err.name === "NotAllowedError") {
        playerRef.current.muted = true;
        playerRef.current.play().catch(() => {});
      }
    });
  }, []);

  // ── Build Vidstack src ──────────────────────────────────────────────────
  const hasSources = currentProviderSources.length > 0;
  const activeSource = hasSources ? currentProviderSources[currentSourceIndex] || currentProviderSources[0] : null;
  const playerSrc = activeSource?.url;
  const playerType = activeSource
    ? (activeSource.type === "hls" || activeSource.url?.includes(".m3u8")
      ? "application/x-mpegurl"
      : "video/mp4")
    : "video/mp4";

  const displayTitle = type === "tv" && meta.title
    ? `${meta.title} S${season}E${episode}`
    : meta.title || "";

  const showError = error && !hasSources;

  // ── Build layout slots with proper drill-down submenus ────────────────

  // Provider popup — SEPARATE button in the control bar (via airPlayButton slot)
  // Uses Menu.Root + Menu.Button for a standalone popup, NOT inside settings
  const ProviderButton = useMemo(() => {
    if (availableServers.length === 0) return null;
    return (
      <Menu.Root className="vds-provider-menu vds-menu">
        <Menu.Button className="vds-button" aria-label="Switch Provider">
          <ProviderIcon className="vds-icon" style={{ width: 26, height: 26 }} />
        </Menu.Button>
        <Menu.Content className="vds-menu-items" placement="top end">
          <DefaultMenuRadioGroup
            value={currentServer || ""}
            options={availableServers.map(server => {
              const info = SERVER_LABELS[server] || { name: server };
              const isFailed = failedServers.has(server);
              return {
                label: isFailed ? `${info.name} (unavailable)` : info.name,
                value: server,
              };
            })}
            onChange={(newVal) => {
              if (!failedServers.has(newVal)) switchServer(newVal);
            }}
          />
        </Menu.Content>
      </Menu.Root>
    );
  }, [availableServers, currentServer, failedServers, switchServer]);

  // Quality submenu — ALWAYS shows, even with 1 option like "Auto"
  // Sorted: 360p → 480p → 720p → 1080p
  const QualitySubmenu = useMemo(() => {
    if (qualityOptions.length < 1) return null;
    return (
      <Menu.Root className="vds-quality-menu vds-menu">
        <DefaultMenuButton label="Quality" hint={currentQuality} Icon={QualityMenuIcon} />
        <Menu.Content className="vds-menu-items">
          <DefaultMenuRadioGroup
            value={currentQuality}
            options={qualityOptions}
            onChange={switchQuality}
          />
        </Menu.Content>
      </Menu.Root>
    );
  }, [qualityOptions, currentQuality, switchQuality]);

  // Dub/Server items for Audio menu (only language dubs, no quality info)
  const AudioDubSlot = useMemo(() => {
    if (dubOptions.length === 0) return null;
    return (
      <DefaultMenuSection label="Servers / Dubs">
        <DefaultMenuRadioGroup
          value={currentProviderSources.every(s => /^Server\s+\d+$/i.test(s.label || ""))
            ? String(currentSourceIndex)
            : currentDub
          }
          options={dubOptions}
          onChange={switchDub}
        />
      </DefaultMenuSection>
    );
  }, [dubOptions, currentDub, currentSourceIndex, currentProviderSources, switchDub]);

  // Combine all slots
  const layoutSlots = useMemo(() => ({
    // Quality goes inside settings menu as a drill-down submenu
    settingsMenuItemsStart: QualitySubmenu,
    // Dub/server items inside audio menu
    audioMenuItemsEnd: AudioDubSlot,
    // Provider button replaces the unused AirPlay button in the control bar
    airPlayButton: ProviderButton,
  }), [QualitySubmenu, AudioDubSlot, ProviderButton]);

  return (
    <div style={styles.wrapper}>
      <MediaPlayer
        key={currentServer || "init"}
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
        onPause={saveNow}
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
        <DefaultVideoLayout
          icons={defaultLayoutIcons}
          slots={layoutSlots}
        />
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

      {/* Server switching overlay */}
      {switching && (
        <div style={styles.switchOverlay}>
          <div style={styles.switchSpinner} />
          <p style={styles.switchText}>Switching to {SERVER_LABELS[switching]?.name || switching}...</p>
        </div>
      )}

      {/* Error overlay */}
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

      {/* Toast */}
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
