/**
 * VidZen Subs Worker — Cloudflare Worker
 * Based on Wyzie Subs v2 (OpenSubtitles only, no proxy needed)
 *
 * Deploy to Cloudflare Workers and set custom domain: subs.vidzen.fun
 * No environment variables needed for OpenSubtitles mode.
 *
 * Routes:
 *   GET /search?id={tmdb|imdb}&[season=N&episode=N]  → subtitle list JSON
 *   GET /c/:vrf/id/:fileId                            → subtitle file (as VTT)
 */

// ── Language maps ─────────────────────────────────────────────────────────────
const LANG_CC = {
  en:"GB",af:"ZA",sq:"AL",ar:"SA",hy:"AM",az:"AZ",eu:"ES",be:"BY",bn:"BD",
  bs:"BA",bg:"BG",ca:"ES",zh:"CN",hr:"HR",cs:"CZ",da:"DK",nl:"NL",et:"EE",
  fi:"FI",fr:"FR",gl:"ES",ka:"GE",de:"DE",el:"GR",gu:"IN",he:"IL",hi:"IN",
  hu:"HU",id:"ID",ga:"IE",it:"IT",ja:"JP",kn:"IN",kk:"KZ",ko:"KR",lv:"LV",
  lt:"LT",mk:"MK",ms:"MY",ml:"IN",mt:"MT",mr:"IN",mn:"MN",ne:"NP",nb:"NO",
  nn:"NO",fa:"IR",pl:"PL",pt:"PT",ro:"RO",ru:"RU",sr:"RS",si:"LK",sk:"SK",
  sl:"SI",es:"ES",sw:"KE",sv:"SE",tl:"PH",ta:"IN",te:"IN",th:"TH",tr:"TR",
  uk:"UA",ur:"PK",vi:"VN",cy:"GB",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };
}

function jsonErr(status, message, detail) {
  return new Response(JSON.stringify({ error: message, detail }), {
    status,
    headers: { "content-type": "application/json", ...cors() },
  });
}

// ── TMDB → IMDB ───────────────────────────────────────────────────────────────
async function tmdbToImdb(id, type) {
  const res = await fetch(
    `https://api.themoviedb.org/3/${type}/${id}/external_ids?api_key=9867f3f6a5e78a2639afb0e2ffc0a311`
  );
  if (!res.ok) return null;
  const d = await res.json();
  return d.imdb_id || null;
}

// ── OpenSubtitles search (direct — CF IPs are not blocked) ───────────────────
function parseOSResults(text) {
  const frags = text.split('{"MatchedBy":"imdbid"');
  const out = [];
  for (let i = 1; i < frags.length; i++) {
    const frag = '{"MatchedBy":"imdbid"' + frags[i];
    const m = frag.match(/,"Score":[^}]+}/);
    if (!m) continue;
    try {
      const obj = JSON.parse(frag.substring(0, m.index + m[0].length));
      if (obj.ISO639 && obj.IDSubtitleFile && obj.SubDownloadLink) out.push(obj);
    } catch (_) {}
  }
  return out;
}

async function searchOpenSubtitles(imdbId, season, episode) {
  const numId = imdbId.replace(/^tt/, "");
  let path = `https://rest.opensubtitles.org/search/`;
  if (season && episode) {
    path += `episode-${episode}/imdbid-${numId}/season-${season}`;
  } else {
    path += `imdbid-${numId}`;
  }
  const res = await fetch(path, {
    headers: {
      "X-User-Agent": "VLSub 0.10.3",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/json",
    },
  });
  if (!res.ok) return [];
  return parseOSResults(await res.text());
}

// ── SRT → VTT ─────────────────────────────────────────────────────────────────
function srtToVtt(text) {
  return "WEBVTT\n\n" + text
    .replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")
    .replace(/^\d+\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Main Worker ───────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const host = url.origin;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors() });
    }

    // ── GET /search ──────────────────────────────────────────────────────────
    if (path === "/search") {
      const rawId = url.searchParams.get("id");
      if (!rawId) return jsonErr(400, "Missing ?id=", "Provide TMDB or IMDB id");

      const season  = url.searchParams.get("season")  ? parseInt(url.searchParams.get("season"))  : undefined;
      const episode = url.searchParams.get("episode") ? parseInt(url.searchParams.get("episode")) : undefined;
      const type    = (season !== undefined && episode !== undefined) ? "tv" : "movie";

      // Cache
      const cache = caches.default;
      const cached = await cache.match(request.url);
      if (cached) return cached;

      // Resolve ID
      let imdbId = rawId.toLowerCase().startsWith("tt") ? rawId.toLowerCase() : null;
      if (!imdbId) {
        imdbId = await tmdbToImdb(rawId, type);
        if (!imdbId) return jsonErr(400, "Cannot resolve ID", `No IMDB id for ${rawId}`);
      }

      // Fetch
      const raw = await searchOpenSubtitles(imdbId, season, episode);
      if (!raw.length) return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json", ...cors() },
      });

      // Deduplicate: best per language
      const byLang = {};
      for (const sub of raw) {
        const lang = sub.ISO639 || "en";
        const existing = byLang[lang];
        if (
          !existing ||
          (sub.SubHearingImpaired !== "1" && existing.SubHearingImpaired === "1") ||
          (sub.SubHearingImpaired === existing.SubHearingImpaired &&
            Number(sub.SubDownloadsCnt || 0) > Number(existing.SubDownloadsCnt || 0))
        ) {
          byLang[lang] = sub;
        }
      }

      const results = Object.values(byLang).map(sub => {
        const lang = sub.ISO639 || "en";
        const cc = LANG_CC[lang] || lang.toUpperCase();
        // Extract vrf and fileId from download URL
        const vrf    = sub.SubDownloadLink.match(/vrf-([a-z0-9]+)/)?.[1];
        const fileId = sub.SubDownloadLink.match(/file\/(\d+)/)?.[1];
        const dlUrl  = vrf && fileId
          ? `${host}/c/${vrf}/id/${fileId}`
          : sub.SubDownloadLink.replace(".gz", "").replace("download/", "download/subencoding-utf8/");
        return {
          file:     dlUrl,
          label:    sub.LanguageName || lang,
          kind:     "subtitles",
          language: lang,
          flagUrl:  `https://flagcdn.com/20x15/${cc.toLowerCase()}.png`,
        };
      });

      // English first
      results.sort((a, b) => {
        if (a.language === "en") return -1;
        if (b.language === "en") return 1;
        return a.label.localeCompare(b.label);
      });

      const resp = new Response(JSON.stringify(results), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "Cache-Control": "public, max-age=604800",
          ...cors(),
        },
      });
      ctx.waitUntil(cache.put(request.url, resp.clone()));
      return resp;
    }

    // ── GET /c/:vrf/id/:fileId  (subtitle download → served as VTT) ──────────
    const dlMatch = path.match(/^\/c\/([^/]+)\/id\/(.+)$/);
    if (dlMatch) {
      const [, vrf, fileId] = dlMatch;

      const cache = caches.default;
      const cached = await cache.match(request.url);
      if (cached) return cached;

      const targetUrl = `https://dl.opensubtitles.org/en/download/subencoding-utf8/src-api/vrf-${vrf}/file/${fileId}`;
      try {
        const res = await fetch(targetUrl, {
          headers: { "X-User-Agent": "VLSub 0.10.3" },
        });
        if (!res.ok) return jsonErr(502, "Download failed", `Status ${res.status}`);

        let text = await res.text();
        if (!text.trim().startsWith("WEBVTT")) text = srtToVtt(text);

        const finalResp = new Response(text, {
          headers: {
            "Content-Type": "text/vtt; charset=utf-8",
            "Cache-Control": "public, max-age=31536000, immutable",
            "Access-Control-Allow-Origin": "*",
          },
        });
        ctx.waitUntil(cache.put(request.url, finalResp.clone()));
        return finalResp;
      } catch (e) {
        return jsonErr(500, "Worker error", String(e));
      }
    }

    return jsonErr(404, "Not found", path);
  },
};
