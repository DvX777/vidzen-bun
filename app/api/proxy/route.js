// app/api/proxy/route.js
// Node.js runtime — needed for proper MP4 range-streaming without Edge buffering.
// Supports:
//   ?t=TOKEN  — server-encrypted token (from provider routes). CDN URL hidden.
//   ?url=URL  — DEPRECATED internal form, still supported for backward compat.
//              (Segment rewrites now use ?t= tokens to hide all CDN URLs.)

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { decryptToken, encryptToken } from "@/lib/serverCrypto";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Async: every segment/key URL is also encrypted into a token.
// No CDN URL ever appears in the browser network tab.
async function rewriteM3U8(body, baseUrl, origin, referer) {
  const base = new URL(baseUrl);

  async function proxyUrl(rawUrl) {
    let absUrl;
    try { absUrl = rawUrl.startsWith("http") ? rawUrl : new URL(rawUrl, base).href; }
    catch { return rawUrl; }
    const token = await encryptToken({ url: absUrl, origin, referer });
    return `/api/proxy?t=${token}`;
  }

  // ── Strip HEVC variant streams from master playlists ─────────────────────────
  // Chrome's MSE (via HLS.js) only supports H.264/AVC. Yoru CDN sometimes serves
  // HEVC (hvc1/hev1) variants which cause bufferAddCodecError.
  // Remove them here before HLS.js parses the manifest.
  let processedBody = body;
  if (body.includes("#EXT-X-STREAM-INF")) {
    const rawLines = body.split("\n");
    const kept = [];
    for (let i = 0; i < rawLines.length; i++) {
      const t = rawLines[i].trim();
      if (t.startsWith("#EXT-X-STREAM-INF")) {
        const codecMatch = t.match(/CODECS="([^"]+)"/);
        const codecs = codecMatch ? codecMatch[1] : "";
        const isHevc = /\b(hvc1|hev1|dvh1|dvhe)\b/i.test(codecs);
        if (isHevc) { i++; continue; } // skip EXT-X-STREAM-INF line + its URL line
      }
      kept.push(rawLines[i]);
    }
    // Only use filtered version if at least one H.264 variant remains
    const hasVariant = kept.some(l => l.trim().startsWith("#EXT-X-STREAM-INF"));
    processedBody = hasVariant ? kept.join("\n") : body;
  }

  const lines = await Promise.all(
    processedBody.split("\n").map(async line => {
      const t = line.trim();
      if (!t) return line;
      // Rewrite URI="..." inside #EXT-X-KEY, #EXT-X-MAP, etc.
      if (t.startsWith("#") && t.includes('URI="')) {
        const matches = [...t.matchAll(/URI="([^"]+)"/g)];
        let result = t;
        for (const [full, uri] of matches) {
          const proxied = await proxyUrl(uri);
          result = result.replace(full, `URI="${proxied}"`);
        }
        return result;
      }
      if (t.startsWith("#")) return line;
      return proxyUrl(t);
    })
  );

  return lines.join("\n");
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  let target, origin, referer, extraHeaders = {};

  const token = searchParams.get("t");
  if (token) {
    // ── Token mode: decrypt server-encrypted token ────────────────────────────
    const payload = await decryptToken(token);
    if (!payload) {
      return new Response(JSON.stringify({ error: "Invalid or expired stream token" }), {
        status: 403, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    target  = payload.url;
    origin  = payload.origin  || null;
    referer = payload.referer || null;
  } else {
    // ── Legacy ?url= mode (backward compat) ────────────────────────────────
    target  = searchParams.get("url");
    origin  = searchParams.get("origin")  || null;
    referer = searchParams.get("referer") || null;

    // Also support ?headers= JSON string from peach route for moviebox MP4
    const headersParam = searchParams.get("headers");
    if (headersParam && !origin && !referer) {
      try {
        const hdrs = JSON.parse(decodeURIComponent(headersParam));
        origin = hdrs.origin || null;
        referer = hdrs.referer || null;
        // Store extra headers to add later
        if (hdrs["user-agent"]) extraHeaders["user-agent"] = hdrs["user-agent"];
        if (hdrs["x-forwarded-for"]) extraHeaders["x-forwarded-for"] = hdrs["x-forwarded-for"];
      } catch { /* ignore malformed headers */ }
    }

    if (!target) {
      return new Response(JSON.stringify({ error: "Missing url or t parameter" }), {
        status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
  }

  const ext = target.split("?")[0].split(".").pop().toLowerCase();

  const fetchHeaders = {
    "User-Agent": extraHeaders["user-agent"] || UA,
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
  };
  if (extraHeaders["x-forwarded-for"]) fetchHeaders["X-Forwarded-For"] = extraHeaders["x-forwarded-for"];
  if (origin)  fetchHeaders["Origin"]  = origin;
  if (referer) fetchHeaders["Referer"] = referer;

  const rangeHeader = request.headers.get("range");
  if (rangeHeader) fetchHeaders["Range"] = rangeHeader;

  const connectMs = ext === "mp4" ? 15000 : 12000;
  const controller = new AbortController();
  const connectTimer = setTimeout(() => controller.abort(new Error("connect timeout")), connectMs);

  let upstream;
  try {
    upstream = await fetch(target, { headers: fetchHeaders, signal: controller.signal });
    clearTimeout(connectTimer); // Connected — let body stream without a deadline
  } catch (err) {
    clearTimeout(connectTimer);
    const msg = controller.signal.aborted
      ? `Connect timeout (${connectMs/1000}s) — ${target.slice(0,60)}`
      : `Upstream fetch failed: ${err.message}`;
    console.error("[proxy]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 504, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  // Log non-2xx from upstream to help diagnose CDN issues
  if (!upstream.ok) {
    console.warn(`[proxy] upstream ${upstream.status} for ${target.slice(0, 100)}`);
  }

  const ct = upstream.headers.get("content-type") || "";
  const isM3U8 = ct.includes("mpegurl") || ct.includes("x-mpegURL") || ext === "m3u8";

  const isMp4 = ct.includes("mp4") || ext === "mp4";
  
  const resHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Range",
    "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges, Content-Length",
    "Accept-Ranges": "bytes"
  };

  if (isMp4) {
    // MP4 native playback REQUIRES browser caching to seek the moov/mdat atoms.
    // s-maxage=0 ensures Cloudflare edge cache ignores it, preventing 524 timeouts.
    resHeaders["Cache-Control"] = "public, max-age=7200, s-maxage=0";
  } else {
    // Aggressive no-cache for M3U8 and HLS .ts segments (HLS.js handles memory buffer)
    resHeaders["Cache-Control"] = "no-store, no-cache, must-revalidate, proxy-revalidate";
    resHeaders["Pragma"] = "no-cache";
    resHeaders["Expires"] = "0";
  }

  for (const h of ["content-type","content-length","content-range"]) {
    const v = upstream.headers.get(h); if (v) resHeaders[h] = v;
  }

  if (isM3U8) {
    const body = await upstream.text();
    const rewritten = await rewriteM3U8(body, target, origin, referer);
    return new Response(rewritten, {
      status: upstream.status,
      headers: { ...resHeaders, "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-cache" }
    });
  }

  return new Response(upstream.body, { status: upstream.status, headers: resHeaders });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "*" }
  });
}