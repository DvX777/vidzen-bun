// app/lib/sfb.js — Smart Fallback System (SFBS)
// 
// TWO LAYERS:
//
// 1. PRE-FLIGHT (server-side): Validates sources before they reach the player.
//    If ALL sources from a provider fail → returns null → next provider wins the race.
//
// 2. IN-FLIGHT (shared logic): Classifies errors so the player can make INSTANT
//    decisions. No timers, no counters — the system UNDERSTANDS the error and acts.
//
// Error Classification:
//   FATAL_SERVER   (502, 503, 500)  → CDN is down             → switch IMMEDIATELY
//   FATAL_BLOCKED  (403)            → IP/region blocked        → switch IMMEDIATELY
//   FATAL_GONE     (404, 410)       → content removed/expired  → switch IMMEDIATELY
//   FATAL_INVALID  (HTML body)      → wrong content type       → switch IMMEDIATELY
//   RECOVERABLE    (timeout, reset) → transient network issue  → retry ONCE, then switch

// ── Error Classes ──────────────────────────────────────────────────────────
export const ErrorClass = {
  FATAL_SERVER:  "FATAL_SERVER",   // 500, 502, 503 — server broken
  FATAL_BLOCKED: "FATAL_BLOCKED",  // 403 — blocked by CDN/firewall
  FATAL_GONE:    "FATAL_GONE",     // 404, 410 — content gone
  FATAL_INVALID: "FATAL_INVALID",  // HTML instead of video data
  RECOVERABLE:   "RECOVERABLE",    // timeout, connection reset — try once more
  OK:            "OK",             // no error
};

/**
 * Classify an HTTP status code into an error class.
 * Used by BOTH the stream route (server) and player (client).
 */
export function classifyHttpError(statusCode) {
  if (statusCode >= 200 && statusCode < 400) return ErrorClass.OK;
  if (statusCode === 403) return ErrorClass.FATAL_BLOCKED;
  if (statusCode === 404 || statusCode === 410) return ErrorClass.FATAL_GONE;
  if (statusCode === 502 || statusCode === 503 || statusCode === 500) return ErrorClass.FATAL_SERVER;
  if (statusCode === 408 || statusCode === 429) return ErrorClass.RECOVERABLE;
  // Unknown 4xx/5xx — treat as fatal
  return ErrorClass.FATAL_SERVER;
}

/**
 * Classify a network error (no HTTP response) into an error class.
 */
export function classifyNetworkError(errorMessage) {
  const msg = (errorMessage || "").toLowerCase();
  if (msg.includes("timeout") || msg.includes("abort")) return ErrorClass.RECOVERABLE;
  if (msg.includes("econnreset") || msg.includes("econnrefused")) return ErrorClass.FATAL_SERVER;
  if (msg.includes("fetch") && msg.includes("invalid")) return ErrorClass.FATAL_INVALID;
  return ErrorClass.RECOVERABLE; // Default: give it one more chance
}

/**
 * Check if an error class is FATAL (should switch immediately, no retry).
 */
export function isFatal(errorClass) {
  return errorClass !== ErrorClass.OK && errorClass !== ErrorClass.RECOVERABLE;
}


// ══════════════════════════════════════════════════════════════════════════
// PRE-FLIGHT VALIDATION (runs at source-selection time in /api/sources)
// ══════════════════════════════════════════════════════════════════════════

const PROBE_TIMEOUT_MS = 4000;
const HLS_SIGNATURES = ["#EXTM3U", "#EXT-X-"];
const VALID_HLS_CONTENT_TYPES = ["mpegurl", "apple", "octet-stream"];
const VALID_MP4_CONTENT_TYPES = ["video/", "octet-stream", "application/octet"];

// Providers whose URLs are internal proxies — can't probe externally
const SKIP_PROBE_SERVERS = new Set([
  "sv-a1f3",  // vidcore
  "sv-b2e4",  // vidfast
  "sv-v1s3",  // vidsrc
  "sv-f6a8",  // vidlink (redirect mode — browser fetches directly)
]);

/**
 * Validate all sources in a provider result.
 * @param {object} result - Normalized provider result { sources, subtitles, ... }
 * @returns {object|null} - Validated result (bad sources stripped), or null if ALL failed
 */
export async function validateSources(result) {
  if (!result?.sources?.length) return result;

  const server = result.sources[0]?.server;

  // Skip validation for trusted/internal providers
  if (SKIP_PROBE_SERVERS.has(server)) {
    return result;
  }

  console.log(`[SFBS] 🔍 Probing ${result.sources.length} source(s) from ${server}...`);

  const settled = await Promise.allSettled(
    result.sources.map(source => probeSource(source))
  );

  const passed = [];
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value !== null) {
      passed.push(r.value);
    }
  }

  if (passed.length === 0) {
    console.warn(`[SFBS] ❌ ALL ${result.sources.length} sources REJECTED for ${server}`);
    return null;
  }

  if (passed.length < result.sources.length) {
    console.log(`[SFBS] ⚠️ ${passed.length}/${result.sources.length} passed for ${server}`);
  } else {
    console.log(`[SFBS] ✅ ${passed.length}/${result.sources.length} passed for ${server}`);
  }

  return { ...result, sources: passed };
}

/**
 * Probe a single source URL to check if it returns valid HLS/MP4 content.
 * @returns {object|null} - The source if valid, null if rejected
 */
async function probeSource(source) {
  const url = source._probeUrl || source.url;

  // Already-vaulted URLs can't be probed
  if (!url || url.startsWith("/api/stream/")) return source;

  // Relative/proxy paths can't be probed externally
  if (!url.startsWith("http")) return stripProbeFields(source);

  const isHls = source.type === "hls" || url.includes(".m3u8");
  const label = `${source.server}/${(source.label || "?").slice(0, 20)}`;

  try {
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    };
    if (source._probeOrigin) headers["Origin"] = source._probeOrigin;
    if (source._probeReferer) headers["Referer"] = source._probeReferer;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      headers,
      redirect: "follow",
    });
    clearTimeout(timer);

    // Classify the response
    const errClass = classifyHttpError(res.status);
    if (isFatal(errClass)) {
      console.log(`[SFBS] ✗ ${label} — ${errClass} (HTTP ${res.status})`);
      return null;
    }

    const ct = (res.headers.get("content-type") || "").toLowerCase();

    if (isHls && VALID_HLS_CONTENT_TYPES.some(t => ct.includes(t))) {
      return stripProbeFields(source);
    }
    if (!isHls && VALID_MP4_CONTENT_TYPES.some(t => ct.includes(t))) {
      return stripProbeFields(source);
    }

    // Ambiguous CT → body sniff for HLS
    if (isHls) {
      const body = await fetchFirstBytes(url, headers, 512);
      if (body && HLS_SIGNATURES.some(sig => body.includes(sig))) {
        return stripProbeFields(source);
      }
      // Check if it's HTML (FATAL_INVALID)
      if (body && (body.includes("<html") || body.includes("<!DOCTYPE"))) {
        console.log(`[SFBS] ✗ ${label} — FATAL_INVALID (HTML body)`);
        return null;
      }
      console.log(`[SFBS] ✗ ${label} — not HLS (ct="${ct.slice(0, 40)}")`);
      return null;
    }

    return stripProbeFields(source);
  } catch (err) {
    const errClass = classifyNetworkError(err.message);
    console.log(`[SFBS] ✗ ${label} — ${errClass} (${err.name === "AbortError" ? "TIMEOUT" : err.message})`);
    // Only reject on fatal network errors; recoverable = let it through (might work for user)
    return isFatal(errClass) ? null : stripProbeFields(source);
  }
}

async function fetchFirstBytes(url, headers, bytes) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { ...headers, Range: `bytes=0-${bytes}` },
    });
    clearTimeout(timer);
    return await res.text();
  } catch {
    return null;
  }
}

function stripProbeFields(source) {
  const { _probeUrl, _probeOrigin, _probeReferer, ...clean } = source;
  return clean;
}
