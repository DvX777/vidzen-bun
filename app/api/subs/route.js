// app/api/subs/route.js — identical to VidMax
export const runtime = "edge";
const WYZIE_API = "https://sub.wyzie.ru";
const WYZIE_KEY = process.env.WYZIE_API_KEY || "wyzie-f65c5237cb2ce01f15317936d8721816";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const subUrl = searchParams.get("url");
  if (subUrl) return convertSubtitle(subUrl);

  const id = searchParams.get("id");
  if (!id) return jsonResponse({ error: "Missing ?id= param" }, 400);

  const params = new URLSearchParams({ id });
  const season = searchParams.get("season");
  const episode = searchParams.get("episode");
  if (season && episode) { params.set("season", season); params.set("episode", episode); }
  params.set("key", WYZIE_KEY);

  try {
    const res = await fetch(`${WYZIE_API}/search?${params}`, { headers: { Accept: "application/json" } });
    if (!res.ok) return jsonResponse({ error: `Wyzie API error: ${res.status}` }, res.status);
    const subs = await res.json();
    const byLang = {};
    for (const sub of subs) {
      const lang = sub.language || "unknown";
      if (!byLang[lang] || (!sub.isHearingImpaired && byLang[lang].isHearingImpaired) ||
        (sub.isHearingImpaired === byLang[lang].isHearingImpaired && (sub.downloadCount || 0) > (byLang[lang].downloadCount || 0))) {
        byLang[lang] = sub;
      }
    }
    const mapped = Object.values(byLang).map((sub) => ({
      file: `/api/subs?url=${encodeURIComponent(sub.url)}`,
      label: sub.display || sub.language || "Unknown",
      kind: "subtitles",
      language: sub.language,
    }));
    return jsonResponse(mapped);
  } catch (e) {
    return jsonResponse({ error: "Subtitle fetch failed", detail: e.message }, 502);
  }
}

async function convertSubtitle(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", Accept: "*/*" } });
    if (!res.ok) return new Response(`Subtitle fetch failed: ${res.status}`, { status: res.status, headers: corsHeaders() });
    let text = await res.text();
    if (!text.trim().startsWith("WEBVTT")) text = srtToVtt(text);
    return new Response(text, { status: 200, headers: { "Content-Type": "text/vtt; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=86400" } });
  } catch (e) {
    return new Response(`Subtitle conversion failed: ${e.message}`, { status: 502, headers: corsHeaders() });
  }
}

function srtToVtt(srt) {
  let vtt = "WEBVTT\n\n";
  vtt += srt.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")
    .replace(/^\d+\s*$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  return vtt;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...corsHeaders() } });
}

function corsHeaders() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "*" };
}

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders() });
}
