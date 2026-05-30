// app/lib/streamVault.js
// Server-side URL vault — stores real CDN URLs behind opaque hex IDs.
// Real URLs NEVER reach the client. Network tab only shows /api/stream/{id}.

import crypto from "crypto";

const VAULT_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours (was 2h — segments need longer life)
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 min

// ── In-memory store: id → { url, origin, referer, cfProxy, expiresAt } ──
// Use globalThis to survive Next.js dev-mode hot-module-reloads.
// Without this, every file save wipes the Map → instant 404s for all active streams.
const store = globalThis.__streamVault ??= new Map();
if (!globalThis.__streamVault) globalThis.__streamVault = store;

// ── Auto-cleanup expired entries ────────────────────────────────────────
function ensureCleanup() {
  if (globalThis.__streamVaultCleanup) return;
  globalThis.__streamVaultCleanup = true;
  setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, entry] of store) {
      if (entry.expiresAt < now) {
        store.delete(id);
        cleaned++;
      }
    }
    if (cleaned > 0) console.log(`[StreamVault] Cleaned ${cleaned} expired entries. Active: ${store.size}`);
  }, CLEANUP_INTERVAL_MS);
}

export function storeUrl(url, { origin = null, referer = null, cfProxy = null, redirect = false, provider = null, mediaType = null, mediaId = null, season = null, episode = null } = {}) {
  ensureCleanup();
  const id = crypto.randomBytes(4).toString("hex"); // 8-char hex
  store.set(id, {
    url,
    origin,
    referer,
    cfProxy,    // CF Worker URL for datacenter-blocked CDNs
    redirect,   // true = 302 redirect to CDN (browser fetches directly)
    provider,
    mediaType,
    mediaId,
    season,
    episode,
    expiresAt: Date.now() + VAULT_TTL_MS,
  });
  return id;
}

/**
 * Resolve an opaque ID → real URL + headers.
 * @returns {{ url, origin, referer, provider, mediaType, mediaId, season, episode } | null}
 */
export function resolveUrl(id) {
  const entry = store.get(id);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    store.delete(id);
    return null;
  }
  // Touch-on-read: extend TTL while stream is actively being used
  entry.expiresAt = Date.now() + VAULT_TTL_MS;
  return {
    url: entry.url,
    origin: entry.origin,
    referer: entry.referer,
    cfProxy: entry.cfProxy,
    redirect: entry.redirect,
    provider: entry.provider,
    mediaType: entry.mediaType,
    mediaId: entry.mediaId,
    season: entry.season,
    episode: entry.episode,
  };
}

/**
 * Build an opaque stream URL.
 * @returns {string} e.g. "/api/stream/7f3a9b2c"
 */
export function vaultUrl(url, meta = {}) {
  const id = storeUrl(url, meta);
  return `/api/stream/${id}`;
}

/** Get current vault size (for debugging). */
export function vaultSize() {
  return store.size;
}
