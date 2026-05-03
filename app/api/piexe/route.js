// app/api/piexe/route.js
// New approach: POST with X-CSRF-TOKEN (from server.js reference)
// The loffe414wil.com CDN requires POST + X-CSRF-TOKEN, not a plain GET.
// Plain GET always returns "11" regardless of headers.

export const runtime = "nodejs"; // needs full Node.js for cookies + POST body
import { proxyToken } from "@/lib/serverCrypto";

const IMDB_CACHE  = new Map(); // tmdb_id → imdb_id (permanent per process)
const STREAM_CACHE = new Map(); // imdb_id → {streams, ts}
const STREAM_TTL  = 2 * 60 * 1000; // 2 min — loffe URLs are short-lived, stay fresh

const TMDB_KEY = process.env.TMDB_API_KEY || "5263089f83877823a641b104f4f8d041";

const PAGE_HEADERS = {
  Accept: "*/*",
  Origin: "https://allmovieland.one",
  Referer: "https://allmovieland.one/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0",
  Cookie: "_ym_uid=177701307497837718; _ym_d=1777013074; _ym_isad=1",
};

const CDN_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  Referer: "https://piexe411qok.com/",
  Origin: "https://piexe411qok.com",
  Accept: "*/*",
  "Content-Type": "application/x-www-form-urlencoded",
};

// ── TMDB → IMDb ID ──────────────────────────────────────────────────────────

async function getImdbId(tmdbId, type) {
  const key = `${type}-${tmdbId}`;
  if (IMDB_CACHE.has(key)) return IMDB_CACHE.get(key);

  const url = type === "movie"
    ? `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_KEY}`
    : `https://api.themoviedb.org/3/tv/${tmdbId}/external_ids?api_key=${TMDB_KEY}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`TMDB_FAIL:${res.status}`);
  const data = await res.json();
  const imdbId = data?.imdb_id || null;
  if (imdbId) IMDB_CACHE.set(key, imdbId);
  return imdbId;
}

// ── Piexe scrape for movies ──────────────────────────────────────────────────

async function fetchPiexeMovie(imdbId) {
  const cached = STREAM_CACHE.get(imdbId);
  if (cached && Date.now() - cached.ts < STREAM_TTL) return cached.streams;

  // Step 1: Get the piexe play page → extract p3 config
  const pageRes = await fetch(`https://piexe411qok.com/play/${imdbId}`, {
    headers: PAGE_HEADERS,
    signal: AbortSignal.timeout(12000),
  });
  if (!pageRes.ok) throw new Error(`PAGE_FAIL:${pageRes.status}`);
  const html = await pageRes.text();

  const p3Match = html.match(/let\s+p3\s*=\s*(\{.*?\});/s);
  if (!p3Match) throw new Error("P3_NOT_FOUND");

  let p3;
  try { p3 = JSON.parse(p3Match[1]); } catch { throw new Error("P3_PARSE_FAIL"); }
  if (!p3?.file || !p3?.key) throw new Error("P3_INVALID");

  // Step 2: POST to p3.file with X-CSRF-TOKEN → JSON array of {file, title}
  const listRes = await fetch(p3.file, {
    method: "POST",
    headers: { ...CDN_HEADERS, "X-CSRF-TOKEN": p3.key },
    signal: AbortSignal.timeout(10000),
  });

  const ct = listRes.headers.get("content-type") || "";
  if (!ct.includes("application/json")) throw new Error("LIST_NOT_JSON");

  const listData = await listRes.json();
  const items = Array.isArray(listData) ? listData : [listData];

  // Step 3: For each item, POST to loffe → get real M3U8 URL
  const streams = [];
  await Promise.allSettled(
    items.filter(item => item?.file).map(async (item) => {
      try {
        const m3uRes = await fetch(`https://loffe414wil.com/playlist/${item.file}.txt`, {
          method: "POST",
          headers: { ...CDN_HEADERS, "X-CSRF-TOKEN": p3.key },
          signal: AbortSignal.timeout(8000),
        });
        const url = (await m3uRes.text()).trim();
        if (!url.includes(".m3u8")) return;
        streams.push({ title: item.title || "English", url });
      } catch { /* skip failed items */ }
    })
  );

  if (!streams.length) throw new Error("NO_STREAMS");

  // Return the master M3U8 URLs directly — the proxy rewrites quality levels
  // dynamically so HLS.js gets all renditions (360p/720p/1080p) in the quality switcher.
  // Pre-resolving to a single sub-playlist caused stale 404s and broke quality selection.
  STREAM_CACHE.set(imdbId, { streams, ts: Date.now() });
  return streams;
}

// ── TV — uses different p3 structure ────────────────────────────────────────

async function fetchPiexeTV(imdbId, season, episode) {
  const pageRes = await fetch(`https://piexe411qok.com/play/${imdbId}`, {
    headers: PAGE_HEADERS,
    signal: AbortSignal.timeout(12000),
  });
  if (!pageRes.ok) throw new Error(`PAGE_FAIL:${pageRes.status}`);
  const html = await pageRes.text();

  const fileMatch = html.match(/file":"(.*?)"/);
  const keyMatch  = html.match(/"key":"(.*?)"/);
  if (!fileMatch || !keyMatch) throw new Error("TV_CONFIG_NOT_FOUND");

  const key = keyMatch[1];
  let playlistUrl = fileMatch[1].replace(/\\\//g, "/");
  if (!playlistUrl.startsWith("http")) playlistUrl = `https://piexe411qok.com${playlistUrl}`;

  const headers = { ...CDN_HEADERS, "X-CSRF-TOKEN": key };
  const data = await fetch(playlistUrl, { method: "POST", headers, signal: AbortSignal.timeout(10000) })
    .then(r => r.json());

  const subs = data?.[parseInt(season) - 1]?.folder?.[parseInt(episode) - 1]?.folder;
  if (!Array.isArray(subs)) throw new Error("TV_INVALID_STRUCTURE");

  const streams = [];
  await Promise.allSettled(
    subs.filter(s => s?.file).map(async (sub) => {
      try {
        const m3u8 = await fetch(`https://piexe411qok.com/playlist/${sub.file}.txt`, {
          method: "POST",
          headers,
          signal: AbortSignal.timeout(8000),
        }).then(r => r.text());
        streams.push({ title: sub.title || "English", url: m3u8.trim() });
      } catch { /* skip */ }
    })
  );

  if (!streams.length) throw new Error("NO_TV_STREAMS");
  // Return master URLs directly — proxy handles M3U8 rewriting + quality levels
  return streams;
}

// ── Route Handler ────────────────────────────────────────────────────────────

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const tmdbId = searchParams.get("id");
  const type   = searchParams.get("type") || "movie";
  const season = searchParams.get("season");
  const ep     = searchParams.get("ep");

  if (!tmdbId) return Response.json({ error: "Missing ?id=" }, { status: 400 });

  try {
    const imdbId = await getImdbId(tmdbId, type);
    if (!imdbId) return Response.json({ error: "IMDB_NOT_FOUND" }, { status: 404 });

    let rawStreams;
    if (type === "tv") {
      if (!season || !ep) return Response.json({ error: "Missing season/ep" }, { status: 400 });
      rawStreams = await fetchPiexeTV(imdbId, season, ep);
    } else {
      rawStreams = await fetchPiexeMovie(imdbId);
    }

    // Encrypt each piexe URL into a server-side token.
    // Network tab shows /api/proxy?t=TOKEN — real loffe CDN URL is hidden.
    const sources = await Promise.all(rawStreams.map(async s => ({
      url: await proxyToken(s.url, {
        origin:  "https://piexe411qok.com",
        referer: "https://piexe411qok.com/",
      }),
      type: "hls",
      label: s.title,
      provider: "piexe",
    })));

    return Response.json({ sources }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.warn("[piexe]", err.message);
    return Response.json({ sources: [], error: err.message }, { status: 200 });
  }
}


export async function OPTIONS() {
  return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" } });
}
