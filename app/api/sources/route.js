// app/api/sources/route.js
// Unified provider bridge — races providers in parallel.
// Now integrates: StreamVault (URL obfuscation) + Redis (response caching).

export const runtime = "nodejs";

import { vaultUrl, resolveUrl } from "@/lib/streamVault";
import { cacheGet, cacheSet, sourceKey, DEFAULT_TTL, DEMO_TTL, NOT_FOUND_TTL } from "@/lib/redisCache";

const NB_URL = process.env.NB_SYSTEM_URL || "http://localhost:3001";
const CF_STREAM_PROXY = process.env.CF_STREAM_PROXY || "https://vidzen-stream-proxy.xdbypass.workers.dev";

// ── Provider name obfuscation ─────────────────────────────────────────────
// Internal names → hex IDs (network tab won't reveal provider names)
const PROVIDER_ALIAS = {
  primesrc: "sv-c3d5",
  vidcore: "sv-a1f3",
  vidfast: "sv-b2e4",
  moviebox: "sv-d4c6",
  piexe: "sv-e5b7",
  vidlink: "sv-f6a8",
  yflix: "sv-g7b9",
};
const ALIAS_REVERSE = Object.fromEntries(Object.entries(PROVIDER_ALIAS).map(([k, v]) => [v, k]));
function maskName(name) { return PROVIDER_ALIAS[name] || name; }
function unmaskName(alias) { return ALIAS_REVERSE[alias] || alias; }

const SERVERS = Object.values(PROVIDER_ALIAS);

// The default demo movie ID shown on the landing page
const DEMO_MOVIE_ID = "786892";

// Rate-limit primesrc error logging (max once per 60s)
let lastPrimesrcErrorTime = 0;
const PRIMESRC_ERROR_INTERVAL_MS = 60_000;

// ── Fetch with AbortController timeout ─────────────────────────────────────
async function fetchJSON(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {};
    // Add API key for backend.vidzen.fun requests (nginx auth)
    if (url.includes("backend.vidzen.fun") || url.startsWith(NB_URL)) {
      headers["X-API-Key"] = process.env.API_GATEWAY_KEY || "";
    }
    const res = await fetch(url, { signal: controller.signal, headers });
    clearTimeout(id);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      // Rate-limit primesrc error logging (once per 60s instead of full suppression)
      if (url.includes("primesrc")) {
        const now = Date.now();
        if (now - lastPrimesrcErrorTime > PRIMESRC_ERROR_INTERVAL_MS) {
          lastPrimesrcErrorTime = now;
          console.warn(`[fetchJSON] primesrc returned non-JSON (CF bypass likely failed). Status: ${res.status}`);
        }
      } else {
        // For vidcore/vidfast 502s, include status code for debugging
        const statusHint = res.status >= 500 ? ` [HTTP ${res.status}]` : '';
        console.error(`[fetchJSON]${statusHint} Non-JSON response from ${url.substring(0, 80)}: ${text.substring(0, 100)}`);
      }
      return null;
    }
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// ── Unwrap nb-system proxy URLs → extract real CDN URL + headers ────────────
// /proxy/m3u8-proxy?url=<encoded_cdn>&headers=<encoded_headers>
// → { url: "https://cdn.example.com/stream.m3u8", referer: "...", origin: "..." }
function unwrapProxyUrl(proxyPath) {
  if (!proxyPath || !proxyPath.startsWith("/proxy/")) return null;
  const qIdx = proxyPath.indexOf("?");
  if (qIdx === -1) return null;
  try {
    const params = new URLSearchParams(proxyPath.substring(qIdx + 1));
    const cdnUrl = params.get("url");
    if (!cdnUrl) return null;
    let referer = null, origin = null;
    const headersStr = params.get("headers");
    if (headersStr) {
      try {
        const h = JSON.parse(decodeURIComponent(headersStr));
        referer = h.referer || h.Referer || null;
        origin = h.origin || h.Origin || null;
      } catch { }
    }
    return { url: cdnUrl, referer, origin };
  } catch {
    return null;
  }
}

// ── Rewrite relative proxy URLs to absolute URLs (fallback) ─────────────────
function rewriteProxyUrl(url) {
  if (!url) return url;
  if (url.startsWith("/proxy/")) return `${NB_URL}${url}`;
  if (url.startsWith("/api/") || url.startsWith("/")) {
    const origin = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
    return `${origin}${url}`;
  }
  return url;
}

// ── Vault a source URL — returns /api/stream/{id} ──────────────────────────
function obfuscateUrl(url, server) {
  if (!url) return url;

  // Direct CDN extraction from nb-system proxy paths
  // Skip the VPS proxy entirely — fetch from CDN directly
  const unwrapped = unwrapProxyUrl(url);
  if (unwrapped) {
    return vaultUrl(unwrapped.url, {
      origin: unwrapped.origin,
      referer: unwrapped.referer,
    });
  }

  // Normal URL — resolve and vault
  const resolved = rewriteProxyUrl(url);
  return vaultUrl(resolved, {
    origin: server === "moviebox" ? null : NB_URL,
    referer: server === "moviebox" ? null : NB_URL,
  });
}

// ── Normalize each provider's response ─────────────────────────────────────
function normalizePrimeSrc(data) {
  if (!data?.success || !data?.data?.length) return null;
  const sources = [];
  const subtitles = [];
  for (const server of data.data) {
    if (server.sources) {
      for (const s of server.sources) {
        sources.push({
          url: obfuscateUrl(s.url, "primesrc"),
          type: s.type === "hls" || s.url?.includes(".m3u8") ? "hls" : "mp4",
          label: server.name || "Default",
          server: maskName("primesrc"),
        });
      }
    }
    if (server.subtitles) {
      for (const sub of server.subtitles) {
        subtitles.push({ url: sub.url, lang: sub.label || sub.lang || "Unknown" });
      }
    }
  }
  if (!sources.length) return null;
  return { sources, subtitles };
}

function normalizeStream(data) {
  const payload = data?.data || data;
  if (data?.success === false || payload?.error) return null;
  if (!payload?.sources?.length) return null;

  const providerName = payload.providerName || "stream";
  const sources = payload.sources.map(s => ({
    url: obfuscateUrl(s.url, providerName),
    type: s.type === "hls" || s.url?.includes(".m3u8") ? "hls" : "mp4",
    label: s.server || s.quality || "Default",
    server: maskName(providerName),
  }));
  const subtitles = (payload.subtitles || []).map(s => ({
    url: s.url,
    lang: s.label || s.lang || "Unknown",
  }));
  return { sources, subtitles };
}

function normalizeMoviebox(data) {
  if (!data?.sources?.length) return null;
  const sources = data.sources.map(s => ({
    url: obfuscateUrl(s.url, "moviebox"),
    type: s.type === "hls" || s.url?.includes(".m3u8") ? "hls" : "mp4",
    label: [s.quality && `${s.quality}p`, s.dub && s.dub !== "Original" ? s.dub : null].filter(Boolean).join(" ") || "Default",
    server: maskName("moviebox"),
  }));
  return { sources, subtitles: [] };
}

function normalizePiexe(data) {
  if (!data?.sources?.length) return null;
  const sources = data.sources.map(s => ({
    url: obfuscateUrl(s.url, "piexe"),
    type: s.type === "hls" || s.url?.includes(".m3u8") ? "hls" : "mp4",
    label: s.label || "Default",
    server: maskName("piexe"),
  }));
  return { sources, subtitles: [] };
}

function normalizeVidlink(data) {
  // Unwrap backend envelope: { status, success, data: { sources, subtitles } }
  const payload = data?.data || data;
  if (data?.success === false || payload?.error) return null;
  if (!payload?.sources?.length) return null;
  const sources = payload.sources.map(s => {
    // storm.vodvidl.site is VidLink's own CORS proxy.
    // It only checks Origin header (must be vidlink.pro), NOT the client IP.
    // Strategy: keep the storm URL as-is, route through our CF Worker.
    // CF Worker sets Origin: vidlink.pro → storm accepts → fetches from real CDN.
    // This works from any IP (VPS, Vercel, consumer) because storm doesn't block IPs.
    const decodedUrl = decodeURIComponent(s.url);

    return {
      url: vaultUrl(decodedUrl, {
        origin: "https://vidlink.pro",
        referer: "https://vidlink.pro/",
        cfProxy: CF_STREAM_PROXY || null,  // CF Worker handles Origin header
      }),
      type: s.type === "hls" || s.url?.includes(".m3u8") ? "hls" : "mp4",
      label: s.quality || s.server || "Auto",
      server: maskName("vidlink"),
    };
  });
  // Drop VidLink's own subtitles (megafiles.store — dead/timeout)
  // Vidzen's /api/subs system handles subtitles independently
  return { sources, subtitles: [] };
}

function normalizeYflix(data) {
  // Unwrap backend envelope: { status, success, data: { sources, subtitles } }
  const payload = data?.data || data;
  if (data?.success === false || payload?.error) return null;
  if (!payload?.sources?.length) return null;
  const sources = payload.sources.map(s => ({
    url: obfuscateUrl(s.url, "yflix"),
    type: s.type === "hls" || s.url?.includes(".m3u8") ? "hls" : "mp4",
    label: s.quality || s.server || "Auto",
    server: maskName("yflix"),
  }));
  const subtitles = (payload.subtitles || []).map(s => ({
    url: s.url,
    lang: s.label || s.lang || "Unknown",
  }));
  return { sources, subtitles };
}

// ── Provider fetch functions ───────────────────────────────────────────────
function tryPrimeSrc(type, id, season, episode) {
  const path = type === "movie"
    ? `${NB_URL}/movie-tv/primesrc/movie/${id}`
    : `${NB_URL}/movie-tv/primesrc/tv/${id}/${season}/${episode}`;
  return fetchJSON(path, 90000).then(normalizePrimeSrc);
}

function tryVidcore(type, id, season, episode) {
  const path = type === "movie"
    ? `${NB_URL}/stream/vidcore/movie/${id}`
    : `${NB_URL}/stream/vidcore/tv/${id}/${season}/${episode}`;
  return fetchJSON(path, 180000).then(normalizeStream);
}

function tryVidfast(type, id, season, episode) {
  const path = type === "movie"
    ? `${NB_URL}/stream/vidfast/movie/${id}`
    : `${NB_URL}/stream/vidfast/tv/${id}/${season}/${episode}`;
  return fetchJSON(path, 180000).then(normalizeStream);
}

function tryMoviebox(type, id, season, episode) {
  const path = type === "movie"
    ? `/api/peach/moviebox/movie/${id}`
    : `/api/peach/moviebox/tv/${id}/season/${season}/episode/${episode}`;
  const origin = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  return fetchJSON(`${origin}${path}`, 15000).then(normalizeMoviebox);
}

function tryPiexe(type, id, season, episode) {
  const origin = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const params = new URLSearchParams({ id, type });
  if (season) { params.set("season", season); params.set("ep", episode); }
  return fetchJSON(`${origin}/api/piexe?${params}`, 15000).then(normalizePiexe);
}

function tryVidlink(type, id, season, episode) {
  const path = type === "movie"
    ? `${NB_URL}/stream/vidlink/movie/${id}`
    : `${NB_URL}/stream/vidlink/tv/${id}/${season}/${episode}`;
  return fetchJSON(path, 15000).then(normalizeVidlink);
}

function tryYflix(type, id, season, episode) {
  const path = type === "movie"
    ? `${NB_URL}/stream/yflix/movie/${id}`
    : `${NB_URL}/stream/yflix/tv/${id}/${season}/${episode}`;
  return fetchJSON(path, 25000).then(normalizeYflix);
}

const PROVIDER_MAP = {
  primesrc: tryPrimeSrc,
  vidcore: tryVidcore,
  vidfast: tryVidfast,
  moviebox: tryMoviebox,
  piexe: tryPiexe,
  vidlink: tryVidlink,
  yflix: tryYflix,
};

// Providers excluded from the automatic race (but still available via forced server switch).
// VidLink: storm.vodvidl.site blocks datacenter + CF Worker IPs (only residential works).
// Including it in the race poisons the cache with 403-producing sources.
const RACE_EXCLUDED = new Set(["vidlink", "yflix"]);

// ── Parallel Race: fire all, return the FIRST with sources ────────────────
async function raceProviders(type, id, season, episode) {
  const entries = Object.entries(PROVIDER_MAP).filter(([name]) => !RACE_EXCLUDED.has(name));

  const racers = entries.map(([name, fn]) => {
    return fn(type, id, season, episode)
      .then(result => {
        if (result && result.sources?.length > 0) {
          console.log(`[sources] ✓ ${name} — ${result.sources.length} sources`);
          return { provider: maskName(name), ...result };
        }
        console.log(`[sources] ✗ ${name} — no sources`);
        return null;
      })
      .catch(err => {
        console.log(`[sources] ✗ ${name} — ${err.message}`);
        return null;
      });
  });

  return new Promise((resolve) => {
    let remaining = racers.length;
    let resolved = false;

    racers.forEach(p => {
      p.then(result => {
        if (resolved) return;
        if (result) {
          resolved = true;
          resolve(result);
          return;
        }
        remaining--;
        if (remaining <= 0) {
          resolve(null);
        }
      });
    });
  });
}

// ── Route Handler ──────────────────────────────────────────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "movie";
  const id = searchParams.get("id");
  const season = searchParams.get("season");
  const episode = searchParams.get("episode");
  const rawServer = searchParams.get("server");
  const forcedServer = rawServer ? unmaskName(rawServer) : null;

  if (!id) {
    return Response.json({ error: "Missing ?id= parameter" }, { status: 400 });
  }
  if (type === "tv" && (!season || !episode)) {
    return Response.json({ error: "Missing ?season= and ?episode= for TV" }, { status: 400 });
  }

  // ── Check Redis cache first ─────────────────────────────────────────────
  const cacheKey = sourceKey(type, id, forcedServer, season, episode);
  const cached = await cacheGet(cacheKey);
  if (cached) {
    // Re-vault cached URLs (creates fresh in-memory vault entries from stored raw URLs)
    const refreshed = refreshVaultUrls(cached);

    // Check if re-vaulting worked (old cache without _raw data can't be refreshed)
    const firstUrl = refreshed.sources?.[0]?.url;
    if (firstUrl && firstUrl.startsWith("/api/stream/")) {
      const vaultId = firstUrl.split("/").pop();
      if (!resolveUrl(vaultId)) {
        // Cache has old-format data (no _raw) with dead vault IDs — skip, refetch
        console.log(`[sources] CACHE STALE (no raw URLs): ${cacheKey} — refetching`);
        // Fall through to fresh fetch below
      } else {
        console.log(`[sources] CACHE HIT: ${cacheKey}`);
        return Response.json({
          ...refreshed,
          provider: refreshed.provider || refreshed.sources?.[0]?.server || null,
          servers: SERVERS,
          cached: true,
        }, { headers: { "Cache-Control": "no-store" } });
      }
    } else {
      // Non-vault URLs (shouldn't happen normally) — return as-is
      console.log(`[sources] CACHE HIT: ${cacheKey}`);
      return Response.json({
        ...refreshed,
        provider: refreshed.provider || refreshed.sources?.[0]?.server || null,
        servers: SERVERS,
        cached: true,
      }, { headers: { "Cache-Control": "no-store" } });
    }
  }

  // ── Forced server (with retry + stale cache fallback) ─────────────────
  if (forcedServer && PROVIDER_MAP[forcedServer]) {
    // Attempt 1
    let result = null;
    let lastError = null;
    try {
      console.log(`[sources] Forced server: ${forcedServer} for ${type}/${id}`);
      result = await PROVIDER_MAP[forcedServer](type, id, season, episode);
    } catch (err) {
      lastError = err.message;
      console.warn(`[sources] ${forcedServer} attempt 1 failed:`, err.message);
    }

    // Retry once after 2s if first attempt returned nothing
    if (!result?.sources?.length && !lastError?.includes("aborted")) {
      try {
        console.log(`[sources] Retrying ${forcedServer} after 2s...`);
        await new Promise(r => setTimeout(r, 2000));
        result = await PROVIDER_MAP[forcedServer](type, id, season, episode);
      } catch (err) {
        lastError = err.message;
        console.warn(`[sources] ${forcedServer} attempt 2 failed:`, err.message);
      }
    }

    if (result?.sources?.length) {
      await cacheSet(cacheKey, stripVaultForCache(result), DEFAULT_TTL);
      return Response.json({
        ...result,
        provider: maskName(forcedServer),
        servers: SERVERS,
      }, { headers: { "Cache-Control": "no-store" } });
    }

    // Stale cache fallback: check if we have cached race results (without server suffix)
    const raceCacheKey = sourceKey(type, id, null, season, episode);
    const staleFallback = await cacheGet(raceCacheKey);
    if (staleFallback?.sources?.length) {
      const refreshed = refreshVaultUrls(staleFallback);
      // Only use fallback if vault URLs are alive (refreshed successfully)
      const firstRefreshedUrl = refreshed.sources?.[0]?.url;
      if (firstRefreshedUrl?.startsWith("/api/stream/")) {
        const testId = firstRefreshedUrl.split("/").pop();
        if (resolveUrl(testId)) {
          console.log(`[sources] ${forcedServer} failed but found live stale cache — using fallback`);
          return Response.json({
            ...refreshed,
            provider: refreshed.provider || refreshed.sources?.[0]?.server || null,
            servers: SERVERS,
            cached: true,
            fallback: true,
          }, { headers: { "Cache-Control": "no-store" } });
        }
      }
      console.log(`[sources] Stale fallback has dead vault URLs — skipping`);
    }

    // Distinguish error type for the client
    const errorMsg = lastError?.includes("502") || lastError?.includes("timed out")
      ? `${maskName(forcedServer)} is temporarily unreachable (server issue)`
      : `${maskName(forcedServer)} returned no sources`;

    await cacheSet(cacheKey, { sources: [], subtitles: [], provider: null, error: errorMsg }, NOT_FOUND_TTL);
    return Response.json({
      sources: [], subtitles: [], provider: null, servers: SERVERS,
      error: errorMsg,
    }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }

  // ── Race ALL providers ──────────────────────────────────────────────────
  console.log(`[sources] Racing all providers for ${type}/${id}...`);
  const winner = await raceProviders(type, id, season, episode);

  if (winner) {
    // Use longer TTL for the demo movie
    const ttl = id === DEMO_MOVIE_ID ? DEMO_TTL : DEFAULT_TTL;
    await cacheSet(cacheKey, stripVaultForCache(winner), ttl);
    return Response.json({
      ...winner,
      servers: SERVERS,
    }, { headers: { "Cache-Control": "no-store" } });
  }

  await cacheSet(cacheKey, { sources: [], subtitles: [], provider: null, error: "All providers failed" }, NOT_FOUND_TTL);
  return Response.json({
    sources: [], subtitles: [], provider: null, servers: SERVERS,
    error: "All providers failed to return sources",
  }, { status: 200, headers: { "Cache-Control": "no-store" } });
}

// ── Helpers for cache ─────────────────────────────────────────────────────
// Vault URLs are ephemeral (in-memory, die on restart).
// Redis is persistent (survives restarts).
// Fix: cache RAW CDN URLs + metadata → re-vault on cache hit.

function stripVaultForCache(result) {
  const sources = (result.sources || []).map(s => {
    // Resolve vault URL back to raw CDN URL + metadata
    if (s.url?.startsWith("/api/stream/")) {
      const vaultId = s.url.split("/").pop();
      const entry = resolveUrl(vaultId);
      if (entry) {
        return {
          ...s,
          url: s.url,            // Keep vault URL for immediate use
          _raw: entry.url,       // Store raw CDN URL for cache
          _origin: entry.origin,
          _referer: entry.referer,
          _cfProxy: entry.cfProxy || null,
        };
      }
    }
    return s;
  });

  return {
    provider: result.provider,
    sources,
    subtitles: result.subtitles || [],
  };
}

function refreshVaultUrls(cached) {
  const sources = (cached.sources || []).map(s => {
    // If raw URL is stored, re-vault it (creates fresh in-memory entry)
    if (s._raw) {
      const freshVaultUrl = vaultUrl(s._raw, {
        origin: s._origin || null,
        referer: s._referer || null,
        cfProxy: s._cfProxy || null,
      });
      // Return source with fresh vault URL, strip raw metadata
      const { _raw, _origin, _referer, _cfProxy, ...rest } = s;
      return { ...rest, url: freshVaultUrl };
    }
    return s;
  });

  return {
    ...cached,
    sources,
  };
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}
