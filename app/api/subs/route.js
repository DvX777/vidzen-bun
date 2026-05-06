// app/api/subs/route.js
// Self-hosted subtitle system using SubDL API (free, no key, VPS-friendly)
// Falls back to empty array gracefully — never hangs (all fetches have 8s timeout)
export const runtime = "edge";

const TMDB_KEY = process.env.NEXT_PUBLIC_TMDB_API_KEY || "5263089f83877823a641b104f4f8d041";
const TIMEOUT_MS = 8000;

// Abort-safe fetch wrapper — returns null on timeout/error instead of hanging
async function safeFetch(url, opts = {}) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (_) {
    return null;
  }
}

// Language code → country code (for flag URLs)
const LANG_TO_CC = {
  en:"GB",ar:"SA",es:"ES",fr:"FR",de:"DE",it:"IT",pt:"PT",ru:"RU",zh:"CN",
  ja:"JP",ko:"KR",nl:"NL",tr:"TR",pl:"PL",hi:"IN",fa:"IR",sv:"SE",nb:"NO",
  da:"DK",fi:"FI",el:"GR",cs:"CZ",ro:"RO",hu:"HU",uk:"UA",bg:"BG",hr:"HR",
  sr:"RS",sk:"SK",sl:"SI",he:"IL",vi:"VN",th:"TH",id:"ID",ms:"MY",tl:"PH",bn:"BD",
};

// ── TMDB → IMDB ──────────────────────────────────────────────────────────────
async function tmdbToImdb(id, mediaType) {
  const res = await safeFetch(
    `https://api.themoviedb.org/3/${mediaType}/${id}/external_ids?api_key=${TMDB_KEY}`,
    { headers: { Accept: "application/json" } }
  );
  if (!res?.ok) return null;
  const data = await res.json();
  return data.imdb_id || null;
}

// ── SubDL API (free, no key, works from VPS IPs) ─────────────────────────────
// Docs: https://subdl.com/api-doc
async function fetchSubDL(imdbId, season, episode) {
  const params = new URLSearchParams({ imdb_id: imdbId, subs_per_page: 30, sd_api: "sdApi" });
  if (season && episode) {
    params.set("season_number", season);
    params.set("episode_number", episode);
  }

  const res = await safeFetch(`https://api.subdl.com/api/v1/subtitles/?${params}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });
  if (!res?.ok) return [];
  try {
    const json = await res.json();
    return json.subtitles || [];
  } catch (_) {
    return [];
  }
}

// ── Subtitle file proxy (SRT/VTT download + SRT→VTT conversion) ───────────────
async function fetchAndConvert(url) {
  // SubDL paths are relative — prepend their CDN
  const fullUrl = url.startsWith("http") ? url : `https://dl.subdl.com${url}`;
  const res = await safeFetch(fullUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "*/*",
    },
  });
  if (!res) return new Response("Subtitle fetch timed out", { status: 504, headers: corsHeaders() });
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

  // Sub proxy pass-through (download + SRT→VTT)
  const subUrl = searchParams.get("url");
  if (subUrl) return fetchAndConvert(subUrl);

  const id = searchParams.get("id");
  if (!id) return jsonResponse({ error: "Missing ?id= param" }, 400);

  const season  = searchParams.get("season")  || undefined;
  const episode = searchParams.get("episode") || undefined;
  const mediaType = season && episode ? "tv" : "movie";

  // Resolve to IMDB ID
  let imdbId = id.startsWith("tt") ? id : null;
  if (!imdbId) {
    try { imdbId = await tmdbToImdb(id, mediaType); } catch (_) {}
    if (!imdbId) return jsonResponse([]);
  }

  try {
    const raw = await fetchSubDL(imdbId, season, episode);
    if (!raw.length) return jsonResponse([]);

    // Deduplicate: one track per language, prefer full-season releases and higher download counts
    const byLang = {};
    for (const sub of raw) {
      const lang = (sub.language || "unknown").toLowerCase().slice(0, 2);
      const existing = byLang[lang];
      if (!existing || (sub.downloads || 0) > (existing.downloads || 0)) {
        byLang[lang] = sub;
      }
    }

    const mapped = Object.values(byLang)
      .filter(sub => sub.url) // must have a downloadable path
      .map(sub => {
        const lang = (sub.language || "unknown").toLowerCase().slice(0, 2);
        const cc = LANG_TO_CC[lang] || lang.toUpperCase();
        return {
          file: `/api/subs?url=${encodeURIComponent(sub.url)}`,
          label: sub.language || "Unknown",
          kind: "subtitles",
          language: lang,
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
    return jsonResponse([]);
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
