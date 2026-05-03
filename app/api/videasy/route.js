// app/api/videasy/route.js
// Videasy provider — Yoru server only (CDN id: "cdn")
// Only Yoru (bold-cdn Cloudflare Worker) is reliably working.

export const runtime = "nodejs";
import { proxyToken } from "@/lib/serverCrypto";

const TMDB_KEY  = process.env.TMDB_API_KEY || "5263089f83877823a641b104f4f8d041";
const YORU_ID   = "cdn"; // Yoru server id in videasy

const FETCH_UA  = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

const META_CACHE   = new Map(); // `${type}-${id}` → {title, year}
const STREAM_CACHE = new Map(); // `${type}-${id}[-s-e]` → {url, ts}
const META_TTL   = 24 * 60 * 60 * 1000; // 24h (TMDB metadata is stable)
const STREAM_TTL =  5 * 60 * 1000;       // 5 min (signed CDN URLs)

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

// ── Videasy Yoru fetch + decrypt ─────────────────────────────────────────────

async function fetchYoruStream(tmdbId, type, meta, season, episode) {
  const cacheKey = type === "tv" ? `tv-${tmdbId}-${season}-${episode}` : `movie-${tmdbId}`;
  const cached = STREAM_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < STREAM_TTL) return cached.url;

  // Build the Videasy API URL for Yoru (server id = "cdn")
  const encodedTitle = encodeURIComponent(meta.title);
  let videasyUrl = `https://api.videasy.net/${YORU_ID}/sources-with-title?title=${encodedTitle}&mediaType=${type}&year=${meta.year}&tmdbId=${tmdbId}`;
  if (type === "tv") videasyUrl += `&seasonId=${season}&episodeId=${episode}`;

  // Step 1: Fetch encrypted stream data from Videasy
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

  // Extract stream URL from result (can be string or object)
  let streamUrl = null;
  if (typeof result === "string") {
    streamUrl = result;
  } else {
    streamUrl = result.stream || result.file || result.url
      || result.sources?.[0]?.url || result.sources?.[0]?.file
      || null;
  }

  if (!streamUrl || !streamUrl.includes("m3u8")) throw new Error("NO_STREAM_URL");

  STREAM_CACHE.set(cacheKey, { url: streamUrl, ts: Date.now() });
  return streamUrl;
}

// ── Route Handler ────────────────────────────────────────────────────────────

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
    const meta = await getTmdbMeta(tmdbId, type);
    const streamUrl = await fetchYoruStream(tmdbId, type, meta, season, ep);

    // Encrypt the Yoru CF worker URL into a server token.
    // Network tab shows /api/proxy?t=TOKEN — Yoru URL hidden.
    const proxied = await proxyToken(streamUrl);
    return Response.json({
      sources: [{
        url: proxied,
        type: "hls",
        label: "Videasy · Yoru",
        provider: "videasy",
      }],
    }, { headers: { "Cache-Control": "no-store" } });

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
