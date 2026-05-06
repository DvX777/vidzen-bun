// app/api/subs/route.js
// Self-hosted subtitle system — SubDL REST API + ZIP extraction
// All fetches have 8s abort timeout to prevent 524s
export const runtime = "nodejs";

const TMDB_KEY = process.env.NEXT_PUBLIC_TMDB_API_KEY || "5263089f83877823a641b104f4f8d041";
const TIMEOUT_MS = 8000;

// ── Abort-safe fetch ──────────────────────────────────────────────────────────
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

// ── Language helpers ──────────────────────────────────────────────────────────
const LANG_TO_CC = {
  en:"GB",ar:"SA",es:"ES",fr:"FR",de:"DE",it:"IT",pt:"PT",ru:"RU",zh:"CN",
  ja:"JP",ko:"KR",nl:"NL",tr:"TR",pl:"PL",hi:"IN",fa:"IR",sv:"SE",nb:"NO",
  da:"DK",fi:"FI",el:"GR",cs:"CZ",ro:"RO",hu:"HU",uk:"UA",bg:"BG",hr:"HR",
  sr:"RS",sk:"SK",sl:"SI",he:"IL",vi:"VN",th:"TH",id:"ID",ms:"MY",tl:"PH",bn:"BD",
};

// SubDL returns full language names — map to ISO 639-1
const NAME_TO_CODE = {
  english:"en",arabic:"ar",spanish:"es",french:"fr",german:"de",italian:"it",
  portuguese:"pt",russian:"ru",chinese:"zh",japanese:"ja",korean:"ko",dutch:"nl",
  turkish:"tr",polish:"pl",hindi:"hi",persian:"fa",farsi:"fa",swedish:"sv",
  norwegian:"nb",danish:"da",finnish:"fi",greek:"el",czech:"cs",romanian:"ro",
  hungarian:"hu",ukrainian:"uk",bulgarian:"bg",croatian:"hr",serbian:"sr",
  slovak:"sk",slovenian:"sl",hebrew:"he",vietnamese:"vi",thai:"th",
  indonesian:"id",malay:"ms",filipino:"tl",bengali:"bn",
  "brazillian-portuguese":"pt","brazilian-portuguese":"pt",
  "brazilian portuguese":"pt","chinese simplified":"zh","chinese traditional":"zh",
  "farsi/persian":"fa","farsi_persian":"fa",
};

function langCode(name) {
  if (!name) return "en";
  const lower = name.toLowerCase().trim();
  return NAME_TO_CODE[lower] || lower.slice(0, 2);
}

// ── TMDB → IMDB ──────────────────────────────────────────────────────────────
async function tmdbToImdb(id, mediaType) {
  const res = await safeFetch(
    `https://api.themoviedb.org/3/${mediaType}/${id}/external_ids?api_key=${TMDB_KEY}`,
    { headers: { Accept: "application/json" } }
  );
  if (!res?.ok) return null;
  const data = await res.json().catch(() => null);
  return data?.imdb_id || null;
}

// ── SubDL REST API ────────────────────────────────────────────────────────────
// Docs: https://api.subdl.com — free, no key, works from VPS
async function fetchSubDL(imdbId, season, episode) {
  const params = new URLSearchParams({
    imdb_id: imdbId,           // must include "tt" prefix
    type: (season && episode) ? "tv" : "movie",
    subs_per_page: "30",
  });
  if (season)  params.set("season_number", String(season));
  if (episode) params.set("episode_number", String(episode));

  const res = await safeFetch(`https://api.subdl.com/api/v1/subtitles/?${params}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });
  if (!res?.ok) return [];
  const json = await res.json().catch(() => null);
  return json?.subtitles || [];
}

// ── ZIP extraction (Edge-native — no Node deps) ───────────────────────────────
const SUB_EXTS = ["srt","ass","ssa","vtt","sub","txt"];

function* parseZip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  while (offset < bytes.length - 30) {
    if (view.getUint32(offset, true) !== 0x04034b50) break;
    const compression = view.getUint16(offset + 8, true);
    const compSize = view.getUint32(offset + 18, true);
    const fnLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const filename = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + fnLen));
    const dataOffset = offset + 30 + fnLen + extraLen;
    const compData = bytes.slice(dataOffset, dataOffset + compSize);
    yield { filename, compression, compData };
    offset = dataOffset + compSize;
  }
}

async function inflateRaw(data) {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  writer.write(data); writer.close();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out.buffer;
}

async function extractSubFromZip(buffer) {
  const entries = [...parseZip(buffer)].filter(e => {
    const ext = e.filename.split(".").pop()?.toLowerCase();
    return SUB_EXTS.includes(ext) && !e.filename.startsWith("__MACOSX");
  });
  if (!entries.length) return null;
  const order = ["srt","vtt","ass","ssa","sub","txt"];
  entries.sort((a, b) => {
    const ea = a.filename.split(".").pop()?.toLowerCase();
    const eb = b.filename.split(".").pop()?.toLowerCase();
    return order.indexOf(ea) - order.indexOf(eb);
  });
  const entry = entries[0];
  let buf;
  if (entry.compression === 0) {
    buf = entry.compData.buffer.slice(entry.compData.byteOffset, entry.compData.byteOffset + entry.compData.byteLength);
  } else if (entry.compression === 8) {
    buf = await inflateRaw(entry.compData);
  } else {
    return null;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}

// ── SRT → VTT ─────────────────────────────────────────────────────────────────
function srtToVtt(srt) {
  return "WEBVTT\n\n" + srt
    .replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")
    .replace(/^\d+\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Subtitle proxy (downloads ZIP, extracts, converts to VTT) ────────────────
async function serveSubtitle(rawUrl) {
  const url = rawUrl.startsWith("http") ? rawUrl : `https://dl.subdl.com${rawUrl}`;
  const res = await safeFetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "*/*",
    },
  });
  if (!res) return new Response("Subtitle fetch timed out", { status: 504, headers: corsHeaders() });
  if (!res.ok) return new Response(`Fetch failed: ${res.status}`, { status: res.status, headers: corsHeaders() });

  const ct = res.headers.get("content-type") || "";
  let text;

  if (ct.includes("zip") || url.endsWith(".zip")) {
    // ZIP file — extract the subtitle inside
    const buf = await res.arrayBuffer();
    text = await extractSubFromZip(buf);
    if (!text) return new Response("No subtitle found in ZIP", { status: 500, headers: corsHeaders() });
  } else {
    text = await res.text();
  }

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

// ── Main handler ──────────────────────────────────────────────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url);

  // Proxy mode — download + extract + convert to VTT
  const subUrl = searchParams.get("url");
  if (subUrl) return serveSubtitle(decodeURIComponent(subUrl));

  const id = searchParams.get("id");
  if (!id) return jsonRes({ error: "Missing ?id= param" }, 400);

  const season  = searchParams.get("season")  || undefined;
  const episode = searchParams.get("episode") || undefined;
  const mediaType = (season && episode) ? "tv" : "movie";

  // Resolve TMDB → IMDB
  let imdbId = id.startsWith("tt") ? id : null;
  if (!imdbId) {
    try { imdbId = await tmdbToImdb(id, mediaType); } catch (_) {}
    if (!imdbId) return jsonRes([], 200); // graceful empty
  }

  try {
    const raw = await fetchSubDL(imdbId, season, episode);
    if (!raw.length) return jsonRes([]);

    // One track per language (prefer higher download count)
    const byLang = {};
    for (const sub of raw) {
      const code = langCode(sub.lang || sub.language || "en");
      const existing = byLang[code];
      if (!existing || (sub.downloads || 0) > (existing.downloads || 0)) {
        byLang[code] = sub;
      }
    }

    const mapped = Object.values(byLang)
      .filter(sub => sub.url)
      .map(sub => {
        const code = langCode(sub.lang || sub.language || "en");
        const cc = LANG_TO_CC[code] || code.toUpperCase();
        // sub.url is a relative path like /subtitle/xyz.zip
        const dlUrl = sub.url.startsWith("http") ? sub.url : `https://dl.subdl.com${sub.url}`;
        return {
          file: `/api/subs?url=${encodeURIComponent(dlUrl)}`,
          label: sub.lang || sub.language || "Unknown",
          kind: "subtitles",
          language: code,
          flagUrl: `https://flagcdn.com/20x15/${cc.toLowerCase()}.png`,
        };
      });

    // English first, then alphabetical
    mapped.sort((a, b) => {
      if (a.language === "en") return -1;
      if (b.language === "en") return 1;
      return (a.label || "").localeCompare(b.label || "");
    });

    return jsonRes(mapped);
  } catch (_) {
    return jsonRes([]);
  }
}

function jsonRes(data, status = 200) {
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
