// app/api/subs/route.js
// Thin proxy → delegates to the Cloudflare Subs Worker (workers/subs-worker.js)
// Set SUBS_WORKER_URL=https://subs.vidzen.fun in .env.local after deploying the worker
export const runtime = "nodejs";

const WORKER_URL = process.env.SUBS_WORKER_URL || "https://subs.vidzen.fun";
const TIMEOUT_MS = 10_000;

async function safeFetch(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (_) {
    clearTimeout(timer);
    return null;
  }
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

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  // ── Subtitle file proxy (/api/subs?url=...) ────────────────────────────────
  // Used when the CF worker URL needs to pass through our origin for CORS
  // (the CF worker already handles CORS, so this is just a fallback path)
  const proxyUrl = searchParams.get("url");
  if (proxyUrl) {
    const target = decodeURIComponent(proxyUrl);
    const res = await safeFetch(target, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*" },
    });
    if (!res) return new Response("Upstream timed out", { status: 504, headers: corsHeaders() });
    if (!res.ok) return new Response(`Upstream error ${res.status}`, { status: res.status, headers: corsHeaders() });
    const text = await res.text();
    return new Response(text, {
      headers: {
        "Content-Type": "text/vtt; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
        ...corsHeaders(),
      },
    });
  }

  // ── Subtitle search (/api/subs?id=...) ────────────────────────────────────
  const id = searchParams.get("id");
  if (!id) {
    return new Response(JSON.stringify({ error: "Missing ?id=" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }

  const season  = searchParams.get("season")  || "";
  const episode = searchParams.get("episode") || "";

  const params = new URLSearchParams({ id });
  if (season)  params.set("season",  season);
  if (episode) params.set("episode", episode);

  const workerSearchUrl = `${WORKER_URL}/search?${params}`;

  const res = await safeFetch(workerSearchUrl, {
    headers: { Accept: "application/json" },
  });

  if (!res || !res.ok) {
    // Worker not yet deployed or unreachable — return empty gracefully
    return new Response("[]", {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }

  const data = await res.json().catch(() => []);

  return new Response(JSON.stringify(Array.isArray(data) ? data : []), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
      ...corsHeaders(),
    },
  });
}
