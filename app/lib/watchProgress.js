/* ══════════════════════════════════════════════════
   WATCH PROGRESS — VidZenProgress localStorage system
   Identical to VidMax version.
   ══════════════════════════════════════════════════ */

const STORAGE_KEY = 'VidZenProgress';
const MAX_ENTRIES = 100;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const MIN_PROGRESS_SEC = 15;
const NEAR_END_PCT = 0.95;

function _readStore() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function _writeStore(store) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch { }
}

// ── Hex encoding for secure postMessage broadcasts ──────────────────────
function _hexEncode(obj) {
  return Array.from(new TextEncoder().encode(JSON.stringify(obj)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

export function hexDecode(hex) {
  const bytes = new Uint8Array(hex.match(/.{2}/g).map(b => parseInt(b, 16)));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function _broadcast(store, currentKey) {
  if (typeof window === 'undefined') return;
  try {
    // Per-item update (frequent — every save tick)
    if (currentKey && store[currentKey]) {
      window.parent.postMessage({
        type: 'MEDIA_PROGRESS',
        data: _hexEncode({ [currentKey]: store[currentKey] }),
        encoding: 'hex',
      }, '*');
    }
    // Full store snapshot
    window.parent.postMessage({
      type: 'MEDIA_DATA',
      data: _hexEncode(store),
      encoding: 'hex',
    }, '*');
  } catch { }
}

function _enforceLimit(store) {
  const keys = Object.keys(store);
  if (keys.length <= MAX_ENTRIES) return store;
  const sorted = keys.sort((a, b) => (store[a].last_updated || 0) - (store[b].last_updated || 0));
  const toRemove = sorted.length - MAX_ENTRIES;
  for (let i = 0; i < toRemove; i++) delete store[sorted[i]];
  return store;
}

function _cleanExpired(store) {
  const now = Date.now();
  for (const key of Object.keys(store)) {
    if (store[key].last_updated && now - store[key].last_updated > MAX_AGE_MS) delete store[key];
  }
  return store;
}

export function saveProgress(data) {
  if (typeof window === 'undefined') return;
  const { type, id, season, episode, watched, duration, title, poster_path, backdrop_path } = data;
  if (!id || !type) return;
  if (!watched || watched < MIN_PROGRESS_SEC) return;
  if (duration && watched / duration > NEAR_END_PCT) { clearProgress(type, id, season, episode); return; }

  const store = _readStore();
  const key = String(id);
  const now = Date.now();

  if (type === 'tv' && season && episode) {
    const existing = store[key] || {};
    const epKey = `s${season}e${episode}`;
    store[key] = {
      id: Number(id), type: 'tv',
      title: title || existing.title || '',
      poster_path: poster_path || existing.poster_path || '',
      ...(backdrop_path && { backdrop_path }),
      progress: { watched: Math.round(watched * 1000) / 1000, duration: Math.round((duration || 0) * 1000) / 1000 },
      last_season_watched: String(season), last_episode_watched: String(episode),
      show_progress: {
        ...(existing.show_progress || {}),
        [epKey]: { season: String(season), episode: String(episode), progress: { watched: Math.round(watched * 1000) / 1000, duration: Math.round((duration || 0) * 1000) / 1000 } },
      },
      last_updated: now,
    };
  } else {
    store[key] = {
      id: Number(id), type: 'movie', title: title || '',
      poster_path: poster_path || '',
      ...(backdrop_path && { backdrop_path }),
      progress: { watched: Math.round(watched * 1000) / 1000, duration: Math.round((duration || 0) * 1000) / 1000 },
      last_updated: now,
    };
  }

  _enforceLimit(store);
  _writeStore(store);
  _broadcast(store, key);
}

export function getProgress(type, id, season, episode) {
  if (typeof window === 'undefined') return null;
  const store = _readStore();
  const entry = store[String(id)];
  if (!entry) return null;
  if (entry.last_updated && Date.now() - entry.last_updated > MAX_AGE_MS) {
    delete store[String(id)]; _writeStore(store); return null;
  }
  let progress;
  if (type === 'tv' && season && episode) {
    const epData = entry.show_progress?.[`s${season}e${episode}`];
    if (!epData) return null;
    progress = epData.progress;
  } else {
    progress = entry.progress;
  }
  if (!progress || !progress.watched || progress.watched < MIN_PROGRESS_SEC) return null;
  if (progress.duration && progress.watched / progress.duration > NEAR_END_PCT) return null;
  return {
    watched: progress.watched, duration: progress.duration,
    percentage: progress.duration ? Math.round((progress.watched / progress.duration) * 100) : 0,
  };
}

export function getAllProgress() {
  if (typeof window === 'undefined') return [];
  const store = _cleanExpired(_readStore());
  _writeStore(store);
  const entries = Object.values(store);
  entries.sort((a, b) => (b.last_updated || 0) - (a.last_updated || 0));
  return entries;
}

export function clearProgress(type, id, season, episode) {
  if (typeof window === 'undefined') return;
  const store = _readStore();
  const key = String(id);
  if (type === 'tv' && season && episode) {
    const entry = store[key];
    if (entry?.show_progress) {
      delete entry.show_progress[`s${season}e${episode}`];
      if (Object.keys(entry.show_progress).length === 0) delete store[key];
    }
  } else { delete store[key]; }
  _writeStore(store);
}

if (typeof window !== 'undefined') {
  try { const store = _cleanExpired(_readStore()); _writeStore(store); } catch { }
}
