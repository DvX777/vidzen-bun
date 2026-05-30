// app/lib/srpsProviders.js
// Centralized provider fetching, normalization, and caching helpers for Vidzen.

import { vaultUrl, resolveUrl } from "@/lib/streamVault";
import { isBlocked } from "@/lib/blocklist";

const NB_URL = process.env.NB_SYSTEM_URL || "http://localhost:3001";
const CF_STREAM_PROXY = process.env.CF_STREAM_PROXY || "https://vidzen-stream-proxy.xdbypass.workers.dev";

// ── Provider name obfuscation ─────────────────────────────────────────────
export const PROVIDER_ALIAS = {
  primesrc: "sv-c3d5",
  vidcore: "sv-a1f3",
  vidfast: "sv-b2e4",
  moviebox: "sv-d4c6",
  piexe: "sv-e5b7",
  vidlink: "sv-f6a8",
  yflix: "sv-g7b9",
  moviesdrive: "sv-m8d1",
  hdhub4u: "sv-h9u4",
  vidsrc: "sv-v1s3",
  vixsrc: "sv-v2x4",
};

export const ALIAS_REVERSE = Object.fromEntries(Object.entries(PROVIDER_ALIAS).map(([k, v]) => [v, k]));
export function maskName(name) { return PROVIDER_ALIAS[name] || name; }
export function unmaskName(alias) { return ALIAS_REVERSE[alias] || alias; }

export const SERVERS = Object.values(PROVIDER_ALIAS);
export const BETA_PROVIDERS = new Set(["primesrc", "vixsrc", "moviesdrive", "yflix"]);
export const RACE_EXCLUDED = new Set(["yflix", "vixsrc", "primesrc"]);

// Rate-limit primesrc error logging (max once per 60s)
let lastPrimesrcErrorTime = 0;
const PRIMESRC_ERROR_INTERVAL_MS = 60_000;

// ── Fetch with AbortController timeout ─────────────────────────────────────
export async function fetchJSON(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {};
    if (url.includes("backend.vidzen.fun") || url.startsWith(NB_URL)) {
      headers["X-API-Key"] = process.env.API_GATEWAY_KEY || "";
    }
    const res = await fetch(url, { signal: controller.signal, headers });
    clearTimeout(id);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      if (url.includes("primesrc")) {
        const now = Date.now();
        if (now - lastPrimesrcErrorTime > PRIMESRC_ERROR_INTERVAL_MS) {
          lastPrimesrcErrorTime = now;
          console.warn(`[fetchJSON] primesrc returned non-JSON (CF bypass likely failed). Status: ${res.status}`);
        }
      } else {
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

// ── Unwrap nb-system proxy URLs ────────────────────────────────────────────
export function unwrapProxyUrl(proxyPath) {
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

// ── Rewrite relative proxy URLs ─────────────────────────────────────────────
export function rewriteProxyUrl(url) {
  if (!url) return url;
  if (url.startsWith("/proxy/")) return `${NB_URL}${url}`;
  if (url.startsWith("/api/") || url.startsWith("/")) {
    const origin = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
    return `${origin}${url}`;
  }
  return url;
}

// ── Vault a source URL — returns /api/stream/{id} with media context ────────
export function obfuscateUrl(url, server, ctx = {}) {
  if (!url) return url;

  const unwrapped = unwrapProxyUrl(url);
  if (unwrapped) {
    return vaultUrl(unwrapped.url, {
      origin: unwrapped.origin,
      referer: unwrapped.referer,
      provider: server,
      mediaType: ctx.type || null,
      mediaId: ctx.id || null,
      season: ctx.season || null,
      episode: ctx.episode || null,
    });
  }

  const resolved = rewriteProxyUrl(url);
  return vaultUrl(resolved, {
    origin: server === "moviebox" ? null : NB_URL,
    referer: server === "moviebox" ? null : NB_URL,
    provider: server,
    mediaType: ctx.type || null,
    mediaId: ctx.id || null,
    season: ctx.season || null,
    episode: ctx.episode || null,
  });
}

// ── Normalizers with media context ─────────────────────────────────────────
export function normalizePrimeSrc(data, ctx) {
  if (!data?.success || !data?.data?.length) return null;
  const sources = [];
  const subtitles = [];
  for (const server of data.data) {
    if (server.sources) {
      for (const s of server.sources) {
        sources.push({
          url: obfuscateUrl(s.url, "primesrc", ctx),
          _probeUrl: s.url,
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

export function normalizeStream(data, ctx) {
  const payload = data?.data || data;
  if (data?.success === false || payload?.error) return null;
  if (!payload?.sources?.length) return null;

  const providerName = payload.providerName || "stream";
  const sources = payload.sources.map(s => ({
    url: obfuscateUrl(s.url, providerName, ctx),
    _probeUrl: s.url,
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

export function normalizeMoviebox(data, ctx) {
  if (!data?.sources?.length) return null;
  const sources = data.sources.map(s => ({
    url: obfuscateUrl(s.url, "moviebox", ctx),
    _probeUrl: s.url,
    type: s.type === "hls" || s.url?.includes(".m3u8") ? "hls" : "mp4",
    label: [s.quality && `${s.quality}p`, s.dub && s.dub !== "Original" ? s.dub : null].filter(Boolean).join(" ") || "Default",
    server: maskName("moviebox"),
  }));
  return { sources, subtitles: [] };
}

export function normalizePiexe(data, ctx) {
  if (!data?.sources?.length) return null;
  const sources = data.sources.map(s => ({
    url: obfuscateUrl(s.url, "piexe", ctx),
    _probeUrl: s.url,
    type: s.type === "hls" || s.url?.includes(".m3u8") ? "hls" : "mp4",
    label: s.label || "Default",
    server: maskName("piexe"),
  }));
  return { sources, subtitles: [] };
}

export function normalizeVidlink(data, ctx) {
  const payload = data?.data || data;
  if (data?.success === false || payload?.error) return null;
  if (!payload?.sources?.length) return null;
  const sources = payload.sources.map(s => {
    const decodedUrl = decodeURIComponent(s.url);
    return {
      url: vaultUrl(decodedUrl, {
        origin: "https://vidlink.pro",
        referer: "https://vidlink.pro/",
        redirect: true,
        provider: "vidlink",
        mediaType: ctx.type || null,
        mediaId: ctx.id || null,
        season: ctx.season || null,
        episode: ctx.episode || null,
      }),
      type: s.type === "hls" || s.url?.includes(".m3u8") ? "hls" : "mp4",
      label: s.quality || s.server || "Auto",
      server: maskName("vidlink"),
    };
  });
  return { sources, subtitles: [] };
}

export function normalizeYflix(data, ctx) {
  const payload = data?.data || data;
  if (data?.success === false || payload?.error) return null;
  if (!payload?.sources?.length) return null;
  const sources = payload.sources.map(s => ({
    url: obfuscateUrl(s.url, "yflix", ctx),
    _probeUrl: s.url,
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

export function normalizeMoviesdrive(data, ctx) {
  const payload = data?.data || data;
  if (data?.success === false || payload?.error) return null;
  const streams = payload?.sources || payload?.streams || (Array.isArray(payload) ? payload : []);
  if (!streams.length) return null;
  const sources = streams.map(s => {
    return {
      url: vaultUrl(s.url, {
        origin: "https://moviesdrive.design",
        referer: "https://moviesdrive.design/",
        cfProxy: CF_STREAM_PROXY || null,
        provider: "moviesdrive",
        mediaType: ctx.type || null,
        mediaId: ctx.id || null,
        season: ctx.season || null,
        episode: ctx.episode || null,
      }),
      _probeUrl: s.url,
      _probeOrigin: "https://moviesdrive.design",
      _probeReferer: "https://moviesdrive.design/",
      type: "mp4",
      label: s.quality || s.source || s.name || s.title || "Auto",
      server: maskName("moviesdrive"),
    };
  });
  return { sources, subtitles: [] };
}

export function normalizeHdhub4u(data, ctx) {
  const payload = data?.data || data;
  if (data?.success === false || payload?.error) return null;
  const streams = payload?.sources || payload?.streams || (Array.isArray(payload) ? payload : []);
  if (!streams.length) return null;
  const sources = streams
    .filter(s => s.url && s.url.includes('.m3u8'))
    .map(s => {
      return {
        url: vaultUrl(s.url, {
          origin: "https://hubstream.art",
          referer: "https://hubstream.art/",
          provider: "hdhub4u",
          mediaType: ctx.type || null,
          mediaId: ctx.id || null,
          season: ctx.season || null,
          episode: ctx.episode || null,
        }),
        _probeUrl: s.url,
        _probeOrigin: "https://hubstream.art",
        _probeReferer: "https://hubstream.art/",
        type: "hls",
        label: s.quality || s.source || s.name || s.title || "Auto",
        server: maskName("hdhub4u"),
      };
    });
  if (sources.length === 0) return null;
  return { sources, subtitles: [] };
}

// ── Provider fetch functions ───────────────────────────────────────────────
export function tryPrimeSrc(type, id, season, episode) {
  const path = type === "movie"
    ? `${NB_URL}/movie-tv/primesrc/movie/${id}`
    : `${NB_URL}/movie-tv/primesrc/tv/${id}/${season}/${episode}`;
  const ctx = { type, id, season, episode };
  return fetchJSON(path, 8000).then(data => normalizePrimeSrc(data, ctx));
}

export function tryVidcore(type, id, season, episode) {
  const path = type === "movie"
    ? `${NB_URL}/stream/vidcore/movie/${id}`
    : `${NB_URL}/stream/vidcore/tv/${id}/${season}/${episode}`;
  const ctx = { type, id, season, episode };
  return fetchJSON(path, 180000).then(data => normalizeStream(data, ctx));
}

export function tryVidfast(type, id, season, episode) {
  const path = type === "movie"
    ? `${NB_URL}/stream/vidfast/movie/${id}`
    : `${NB_URL}/stream/vidfast/tv/${id}/${season}/${episode}`;
  const ctx = { type, id, season, episode };
  return fetchJSON(path, 180000).then(data => normalizeStream(data, ctx));
}

export function tryMoviebox(type, id, season, episode) {
  const path = type === "movie"
    ? `/api/peach/moviebox/movie/${id}`
    : `/api/peach/moviebox/tv/${id}/season/${season}/episode/${episode}`;
  const origin = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const ctx = { type, id, season, episode };
  return fetchJSON(`${origin}${path}`, 15000).then(data => normalizeMoviebox(data, ctx));
}

export function tryPiexe(type, id, season, episode) {
  const origin = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const params = new URLSearchParams({ id, type });
  if (season) { params.set("season", season); params.set("ep", episode); }
  const ctx = { type, id, season, episode };
  return fetchJSON(`${origin}/api/piexe?${params}`, 15000).then(data => normalizePiexe(data, ctx));
}

export function tryVidlink(type, id, season, episode) {
  const path = type === "movie"
    ? `${NB_URL}/stream/vidlink/movie/${id}`
    : `${NB_URL}/stream/vidlink/tv/${id}/${season}/${episode}`;
  const ctx = { type, id, season, episode };
  return fetchJSON(path, 15000).then(data => normalizeVidlink(data, ctx));
}

export function tryYflix(type, id, season, episode) {
  const path = type === "movie"
    ? `${NB_URL}/stream/yflix/movie/${id}`
    : `${NB_URL}/stream/yflix/tv/${id}/${season}/${episode}`;
  const ctx = { type, id, season, episode };
  return fetchJSON(path, 8000).then(data => normalizeYflix(data, ctx));
}

export function tryMoviesdrive(type, id, season, episode) {
  const path = type === "movie"
    ? `${NB_URL}/stream/moviesdrive/movie/${id}`
    : `${NB_URL}/stream/moviesdrive/tv/${id}/${season}/${episode}`;
  const ctx = { type, id, season, episode };
  return fetchJSON(path, 8000).then(data => normalizeMoviesdrive(data, ctx));
}

export function tryHdhub4u(type, id, season, episode) {
  const path = type === "movie"
    ? `${NB_URL}/stream/hdhub4u/movie/${id}`
    : `${NB_URL}/stream/hdhub4u/tv/${id}/${season}/${episode}`;
  const ctx = { type, id, season, episode };
  return fetchJSON(path, 120000).then(data => normalizeHdhub4u(data, ctx));
}

export function tryVidsrc(type, id, season, episode) {
  const path = type === "movie"
    ? `${NB_URL}/stream/vidsrc/movie/${id}`
    : `${NB_URL}/stream/vidsrc/tv/${id}/${season}/${episode}`;
  const ctx = { type, id, season, episode };
  return fetchJSON(path, 30000).then(data => normalizeStream(data, ctx));
}

export function tryVixsrc(type, id, season, episode) {
  const path = type === "movie"
    ? `${NB_URL}/stream/vixsrc/movie/${id}`
    : `${NB_URL}/stream/vixsrc/tv/${id}/${season}/${episode}`;
  const ctx = { type, id, season, episode };
  return fetchJSON(path, 8000).then(data => normalizeStream(data, ctx));
}

export const PROVIDER_MAP = {
  primesrc: tryPrimeSrc,
  vidcore: tryVidcore,
  vidfast: tryVidfast,
  moviebox: tryMoviebox,
  piexe: tryPiexe,
  vidlink: tryVidlink,
  yflix: tryYflix,
  moviesdrive: tryMoviesdrive,
  hdhub4u: tryHdhub4u,
  vidsrc: tryVidsrc,
  vixsrc: tryVixsrc,
};

// ── Generic Dynamic Fetcher ────────────────────────────────────────────────
export async function fetchProvider(provider, type, id, season, episode) {
  const fetchFn = PROVIDER_MAP[provider];
  if (!fetchFn) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  return fetchFn(type, id, season, episode);
}

// ── Strip/Restore Vault cache helpers ──────────────────────────────────────
export function stripVaultForCache(result) {
  const sources = (result.sources || []).map(s => {
    const { _probeUrl, _probeOrigin, _probeReferer, ...clean } = s;
    if (clean.url?.startsWith("/api/stream/")) {
      const vaultId = clean.url.split("/").pop();
      const entry = resolveUrl(vaultId);
      if (entry) {
        return {
          ...clean,
          url: clean.url,
          _raw: entry.url,
          _origin: entry.origin,
          _referer: entry.referer,
          _cfProxy: entry.cfProxy || null,
          _redirect: entry.redirect || false,
        };
      }
    }
    return clean;
  });

  return {
    provider: result.provider,
    sources,
    subtitles: result.subtitles || [],
  };
}

export function refreshVaultUrls(cached, ctx = {}) {
  const sources = (cached.sources || []).map(s => {
    if (s._raw) {
      const freshVaultUrl = vaultUrl(s._raw, {
        origin: s._origin || null,
        referer: s._referer || null,
        cfProxy: s._cfProxy || null,
        redirect: s._redirect || false,
        provider: unmaskName(s.server),
        mediaType: ctx.type || null,
        mediaId: ctx.id || null,
        season: ctx.season || null,
        episode: ctx.episode || null,
      });
      const { _raw, _origin, _referer, _cfProxy, _redirect, ...rest } = s;
      return { ...rest, url: freshVaultUrl };
    }
    return s;
  });

  return {
    ...cached,
    sources,
  };
}
