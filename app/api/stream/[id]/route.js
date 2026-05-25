// app/api/stream/[id]/route.js
// Opaque stream proxy — resolves vault IDs to real CDN URLs.
// Network tab shows: /api/stream/7f3a9b2c (meaningless to users)
// Real CDN URLs exist ONLY in server-side memory.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { resolveUrl, vaultUrl } from "@/lib/streamVault";

const NB_URL = process.env.NB_SYSTEM_URL || "http://localhost:3001";

// ── Unwrap VPS proxy URLs → direct CDN URL + headers ────────────────────
// Detects: https://backend.vidzen.fun/proxy/ts-segment?url=<cdn>&headers=<h>
// Returns: { url: cdnUrl, referer, origin } or null
function unwrapVpsProxyUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!parsed.pathname.startsWith("/proxy/")) return null;
    const cdnUrl = parsed.searchParams.get("url");
    if (!cdnUrl) return null;
    let referer = null, origin = null;
    const headersStr = parsed.searchParams.get("headers");
    if (headersStr) {
      try {
        const h = JSON.parse(decodeURIComponent(headersStr));
        referer = h.referer || h.Referer || null;
        origin = h.origin || h.Origin || null;
      } catch {}
    }
    return { url: cdnUrl, referer, origin };
  } catch {
    return null;
  }
}

// ── Vault a URL, unwrapping VPS proxy URLs first ────────────────────────
function smartVault(absUrl, fallbackOrigin, fallbackReferer, cfProxy = null) {
  const unwrapped = unwrapVpsProxyUrl(absUrl);
  if (unwrapped) {
    return vaultUrl(unwrapped.url, {
      origin: unwrapped.origin,
      referer: unwrapped.referer,
      cfProxy,
    });
  }
  return vaultUrl(absUrl, { origin: fallbackOrigin, referer: fallbackReferer, cfProxy });
}

// ── Rewrite M3U8 segment URLs into new vault IDs ────────────────────────
async function rewriteM3U8(body, baseUrl, origin, referer, cfProxy = null) {
  const base = new URL(baseUrl);
  const lines = body.split("\n");
  const result = [];

  // Detect and strip HEVC streams (Chrome MSE only supports H.264)
  let skipNext = false;

  for (const line of lines) {
    if (skipNext) { skipNext = false; continue; }

    // Skip HEVC variant streams
    if (line.includes("hvc1") || line.includes("hev1") || line.includes("HEVC")) {
      skipNext = true;
      continue;
    }

    const trimmed = line.trim();

    // Rewrite URI= attributes (keys, subtitles, etc.)
    if (trimmed.includes("URI=")) {
      const rewritten = trimmed.replace(/URI="([^"]+)"/g, (match, uri) => {
        let absUrl;
        try { absUrl = uri.startsWith("http") ? uri : new URL(uri, base).href; }
        catch { return match; }
        return `URI="${smartVault(absUrl, origin, referer, cfProxy)}"`;
      });
      result.push(rewritten);
      continue;
    }

    // Rewrite segment/playlist URLs (non-comment, non-empty lines)
    if (trimmed && !trimmed.startsWith("#")) {
      let absUrl;
      try { absUrl = trimmed.startsWith("http") ? trimmed : new URL(trimmed, base).href; }
      catch { result.push(line); continue; }
      result.push(smartVault(absUrl, origin, referer, cfProxy));
      continue;
    }

    result.push(line);
  }

  return result.join("\n");
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ── GET handler ─────────────────────────────────────────────────────────
export async function GET(request, { params }) {
  const { id } = await params;
  const entry = resolveUrl(id);

  if (!entry) {
    return new Response(JSON.stringify({ error: "Stream expired or invalid" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { url, origin, referer, cfProxy } = entry;

  // ── Route through CF Worker if cfProxy is set (datacenter-blocked CDNs) ──
  const fetchUrl = cfProxy
    ? `${cfProxy}/p?url=${encodeURIComponent(url)}`
    : url;

  // ── Build upstream headers ──────────────────────────────────────────
  const upstreamHeaders = { "User-Agent": UA };
  if (origin) upstreamHeaders["Origin"] = origin;
  if (referer) upstreamHeaders["Referer"] = referer;

  // Add API key for backend proxy requests (nginx auth)
  if (url.includes("backend.vidzen.fun")) {
    upstreamHeaders["X-API-Key"] = process.env.API_GATEWAY_KEY || "";
  }

  // ── Handle range requests (MP4 seeking) ─────────────────────────────
  const rangeHeader = request.headers.get("range");
  if (rangeHeader) upstreamHeaders["Range"] = rangeHeader;

  try {
    console.log(`[Stream] Fetching${cfProxy ? ' (via CF)' : ''}: ${url.substring(0, 120)}...`);
    const upstreamRes = await fetch(fetchUrl, {
      headers: cfProxy ? { "User-Agent": UA } : upstreamHeaders,  // CF Worker handles origin/referer
      redirect: "follow",
    });

    if (!upstreamRes.ok && upstreamRes.status !== 206) {
      console.error(`[Stream] Upstream ${upstreamRes.status} for ${id}: ${url.substring(0, 100)}`);
      return new Response(`Upstream error: ${upstreamRes.status}`, { status: 502 });
    }

    const contentType = upstreamRes.headers.get("content-type") || "";

    // ── M3U8: Rewrite all internal URLs into new vault IDs ──────────
    if (
      contentType.includes("mpegurl") ||
      contentType.includes("apple") ||
      url.includes(".m3u8")
    ) {
      const body = await upstreamRes.text();
      const rewritten = await rewriteM3U8(body, url, origin, referer, cfProxy);
      return new Response(rewritten, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        },
      });
    }

    // ── MP4 / TS / binary: Stream through directly ──────────────────
    const responseHeaders = new Headers();
    responseHeaders.set("Access-Control-Allow-Origin", "*");

    // Forward critical headers
    for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const val = upstreamRes.headers.get(h);
      if (val) responseHeaders.set(h, val);
    }

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error(`[Stream] Proxy error for ${id}:`, err.message);
    return new Response("Stream proxy error", { status: 502 });
  }
}
