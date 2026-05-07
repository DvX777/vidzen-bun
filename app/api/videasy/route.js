// app/api/videasy/route.js
// Videasy provider — Yoru CDN (bold-cdn Cloudflare Worker)
// NOTE: Yoru's CF Worker blocks VPS datacenter IPs.
// URLs are returned RAW (no proxy token) so the browser's HLS.js fetches them directly.
// Browser residential/CF IPs are not blocked by Yoru.

export const runtime = "nodejs";

const TMDB_KEY    = process.env.TMDB_API_KEY || "5263089f83877823a641b104f4f8d041";
const YORU_ID     = "cdn";
const FETCH_UA    = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

const META_CACHE   = new Map();
const STREAM_CACHE = new Map();
const META_TTL     = 24 * 60 * 60 * 1000; // 24h
const STREAM_TTL   =  4 * 60 * 1000;       // 4 min (Yoru tokens are short-lived)

// ── TMDB meta ────────────────────────────────────────────────────────────────

async function getTmdbMeta(tmdbId, type) {
  const key = `${type}-${tmdbId}`;
  const cached = META_CACHE.get(key);
  if (cached && Date.now() - cached.ts < META_TTL) return cached.data;

  const url = type === "movie"
    ? `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_KEY}&language=en-US`
    : `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_KEY}&language=en-US`;

  const res = await fetch(url, {
    headers: { "User-Agent": FETCH_UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`TMDB_FAIL:${res.status}`);
  const data = await res.json();

  const meta = {
    title: data.title || data.name || "",
    year:  (data.release_date || data.first_air_date || "").slice(0, 4),
  };
  if (!meta.title) throw new Error("TMDB_NO_TITLE");

  META_CACHE.set(key, { data: meta, ts: Date.now() });
  return meta;
}

// ── Videasy fetch + decrypt → all quality sources ─────────────────────────────

async function fetchYoruStreams(tmdbId, type, meta, season, episode) {
  const cacheKey = type === "tv"
    ? `tv-${tmdbId}-${season}-${episode}`
    : `movie-${tmdbId}`;
  const cached = STREAM_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < STREAM_TTL) return cached.streams;

  // Step 1: Fetch encrypted data from Videasy
  let videasyUrl = `https://api.videasy.net/${YORU_ID}/sources-with-title?title=${encodeURIComponent(meta.title)}&mediaType=${type}&year=${meta.year}&tmdbId=${tmdbId}`;
  if (type === "tv") videasyUrl += `&seasonId=${season}&episodeId=${episode}`;

  const encRes = await fetch(videasyUrl, {
    headers: { "User-Agent": FETCH_UA, Connection: "keep-alive" },
    signal: AbortSignal.timeout(20000),
  });
  if (!encRes.ok) throw new Error(`VIDEASY_FAIL:${encRes.status}`);
  const encryptedText = (await encRes.text()).trim();
  if (!encryptedText) throw new Error("VIDEASY_EMPTY");

  // Step 2: Decrypt via enc-dec.app
  const decRes = await fetch("https://enc-dec.app/api/dec-videasy", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ text: encryptedText, id: String(tmdbId) }),
    signal: AbortSignal.timeout(20000),
  });
  if (!decRes.ok) throw new Error(`DECRYPT_FAIL:${decRes.status}`);
  const decrypted = await decRes.json();

  const result = decrypted?.result;
  if (!result) throw new Error("DECRYPT_NO_RESULT");

  // Step 3: Extract all quality sources
  let streams = [];

  if (Array.isArray(result?.sources) && result.sources.length > 0) {
    // New format: { sources: [{ quality, url }] }
    streams = result.sources
      .filter(s => s?.url?.includes("m3u8"))
      .map(s => ({ url: s.url, quality: s.quality || "HD" }));
  } else if (typeof result === "string" && result.includes("m3u8")) {
    streams = [{ url: result, quality: "HD" }];
  } else if (result?.url?.includes("m3u8")) {
    streams = [{ url: result.url, quality: "HD" }];
  } else if (result?.stream?.includes("m3u8")) {
    streams = [{ url: result.stream, quality: "HD" }];
  }

  // Sort: 1080P first
  streams.sort((a, b) => {
    const qa = parseInt(a.quality) || 0;
    const qb = parseInt(b.quality) || 0;
    return qb - qa;
  });

  if (!streams.length) throw new Error("NO_STREAM_URL");

  STREAM_CACHE.set(cacheKey, { streams, ts: Date.now() });
  return streams;
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const tmdbId = searchParams.get("id");
  const type   = searchParams.get("type") || "movie";
  const season = searchParams.get("season");
  const ep     = searchParams.get("ep");

  if (!tmdbId) return Response.json({ error: "Missing ?id=" }, { status: 400 });
  if (type === "tv" && (!season || !ep)) {
    return Response.json({ error: "Missing season/ep" }, { status: 400 });
  }

  try {
    const meta    = await getTmdbMeta(tmdbId, type);
    const streams = await fetchYoruStreams(tmdbId, type, meta, season, ep);

    // Return raw Yoru URLs — browser HLS.js fetches them directly (VPS IP is blocked by Yoru).
    // Yoru is a CF Worker that works fine from residential/browser IPs.
    const sources = streams.map(s => ({
      url:      s.url,
      type:     "hls",
      label:    `Hexa · ${s.quality}`,
      provider: "videasy",
    }));

    return Response.json({ sources }, {
      headers: { "Cache-Control": "no-store" },
    });

  } catch (err) {
    console.warn("[videasy]", err.message);
    return Response.json({ sources: [], error: err.message }, { status: 200 });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" },
  });
}
