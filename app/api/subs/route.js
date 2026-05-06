// app/api/subs/route.js
// Self-hosted subtitle system using OpenSubtitles REST API (no proxy, no key, Edge-compatible)
// Ported from the internal Wyzie Subs v2 Worker implementation in subtitles.txt
export const runtime = "edge";

const TMDB_KEY = process.env.NEXT_PUBLIC_TMDB_API_KEY || "5263089f83877823a641b104f4f8d041";

// Language code → country code (for flag URLs)
const LANG_TO_CC = {
  en:"GB",ar:"SA",es:"ES",fr:"FR",de:"DE",it:"IT",pt:"PT",ru:"RU",zh:"CN",
  ja:"JP",ko:"KR",nl:"NL",tr:"TR",pl:"PL",hi:"IN",fa:"IR",sv:"SE",nb:"NO",
  da:"DK",fi:"FI",el:"GR",cs:"CZ",ro:"RO",hu:"HU",uk:"UA",bg:"BG",hr:"HR",
  sr:"RS",sk:"SK",sl:"SI",he:"IL",vi:"VN",th:"TH",id:"ID",ms:"MY",tl:"PH",bn:"BD",
};

// ── TMDB → IMDB ──────────────────────────────────────────────────────────────
async function tmdbToImdb(id, mediaType) {
  const res = await fetch(
    `https://api.themoviedb.org/3/${mediaType}/${id}/external_ids?api_key=${TMDB_KEY}`,
    { headers: { Accept: "application/json" } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.imdb_id || null;
}

// ── OpenSubtitles REST (free, no key, no proxy) ───────────────────────────────
// Endpoint: https://rest.opensubtitles.org/search/…
// Uses VLSub User-Agent (the only requirement for the legacy REST API)
function parseOpenSubtitlesResponse(text) {
  const frags = text.split('{"MatchedBy":"imdbid"');
  const results = [];
  for (let i = 1; i < frags.length; i++) {
    const frag = '{"MatchedBy":"imdbid"' + frags[i];
    const m = frag.match(/,"Score":[^}]+}/);
    if (!m) continue;
    try {
      const obj = JSON.parse(frag.substring(0, m.index + m[0].length));
      if (obj.ISO639 && obj.IDSubtitleFile && obj.SubDownloadLink) results.push(obj);
    } catch (_) {}
  }
  return results;
}

async function fetchOpenSubtitles(imdbId, season, episode) {
  // Build path: /search/episode-N/imdbid-NNNNNNN/season-N  (for TV)
  //             /search/imdbid-NNNNNNN  (for movies)
  const numericId = imdbId.replace(/^tt/, "");
  let path = `https://rest.opensubtitles.org/search/`;
  if (season && episode) {
    path += `episode-${episode}/imdbid-${numericId}/season-${season}`;
  } else {
    path += `imdbid-${numericId}`;
  }

  const res = await fetch(path, {
    headers: {
      "X-User-Agent": "VLSub 0.10.3",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "application/json",
    },
  });

  if (!res.ok) return [];
  const text = await res.text();
  return parseOpenSubtitlesResponse(text);
}

// ── Subtitle conversion proxy ──────────────────────────────────────────────────
async function convertSubtitle(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "*/*",
      },
    });
    if (!res.ok) return new Response(`Subtitle fetch failed: ${res.status}`, { status: res.status, headers: corsHeaders() });
    let text = await res.text();
    if (!text.trim().startsWith("WEBVTT")) text = srtToVtt(text);
    return new Response(text, {
      status: 200,
      headers: {
        "Content-Type": "text/vtt; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (e) {
    return new Response(`Subtitle conversion failed: ${e.message}`, { status: 502, headers: corsHeaders() });
  }
}

function srtToVtt(srt) {
  let vtt = "WEBVTT\n\n";
  vtt += srt
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")
    .replace(/^\d+\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return vtt;
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url);

  // Sub proxy pass-through (SRT → VTT conversion)
  const subUrl = searchParams.get("url");
  if (subUrl) return convertSubtitle(subUrl);

  const id = searchParams.get("id");
  if (!id) return jsonResponse({ error: "Missing ?id= param" }, 400);

  const season  = searchParams.get("season")  || undefined;
  const episode = searchParams.get("episode") || undefined;
  const mediaType = season && episode ? "tv" : "movie";

  // Resolve to IMDB ID (OpenSubtitles requires tt-format)
  let imdbId = id.startsWith("tt") ? id : null;
  if (!imdbId) {
    try { imdbId = await tmdbToImdb(id, mediaType); } catch (_) {}
    if (!imdbId) return jsonResponse({ error: "Could not resolve IMDB ID" }, 400);
  }

  try {
    const raw = await fetchOpenSubtitles(imdbId, season, episode);
    if (!raw.length) return jsonResponse([]);

    // Pick best subtitle per language (prefer non-HI, then highest download count)
    const byLang = {};
    for (const sub of raw) {
      const lang = sub.ISO639 || "unknown";
      const existing = byLang[lang];
      if (
        !existing ||
        // Prefer non-hearing-impaired
        (sub.SubHearingImpaired !== "1" && existing.SubHearingImpaired === "1") ||
        // Among same HI status, prefer higher download count
        (sub.SubHearingImpaired === existing.SubHearingImpaired &&
          Number(sub.SubDownloadsCnt || 0) > Number(existing.SubDownloadsCnt || 0))
      ) {
        byLang[lang] = sub;
      }
    }

    const mapped = Object.values(byLang).map((sub) => {
      // Rewrite download URL to strip .gz and force UTF-8 encoding
      const dlUrl = sub.SubDownloadLink
        .replace(".gz", "")
        .replace("download/", "download/subencoding-utf8/");
      const cc = LANG_TO_CC[sub.ISO639] || sub.ISO639?.toUpperCase() || "UN";
      return {
        file: `/api/subs?url=${encodeURIComponent(dlUrl)}`,
        label: sub.LanguageName || sub.ISO639 || "Unknown",
        kind: "subtitles",
        language: sub.ISO639,
        flagUrl: `https://flagcdn.com/20x15/${cc.toLowerCase()}.png`,
      };
    });

    // Sort: English first, then alphabetically
    mapped.sort((a, b) => {
      if (a.language === "en") return -1;
      if (b.language === "en") return 1;
      return (a.label || "").localeCompare(b.label || "");
    });

    return jsonResponse(mapped);
  } catch (e) {
    return jsonResponse({ error: "Subtitle fetch failed", detail: e.message }, 502);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };
}

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders() });
}
