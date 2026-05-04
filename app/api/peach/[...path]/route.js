// app/api/peach/[...path]/route.js
// Server-side proxy to Peach API backend (avoids CORS, rewrites internal URLs).
// Moviebox MP4 sources are routed through CF Worker pool so the CDN URL is
// never fetched directly from the VPS — CF workers handle Range + CORS transparently.

import { nextWorkerHost } from "@/lib/cfPool";
import { proxyToken } from "@/lib/serverCrypto";

const PEACH_BASE = process.env.BACKEND_URL || "https://backend.vidzen.fun";
const API_KEY = process.env.API_GATEWAY_KEY || "";
const inflight = new Map();
const MAX_INFLIGHT = 200;
setInterval(() => { if (inflight.size > MAX_INFLIGHT) inflight.clear(); }, 30_000);

export async function GET(request, { params }) {
    const { path } = await params;
    const segments = Array.isArray(path) ? path.join("/") : path;
    if (!segments) {
        return new Response(JSON.stringify({ error: "API-CODE:PEACH-FAILED: Missing path" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    const reqUrl = new URL(request.url);
    const targetUrl = `${PEACH_BASE}/${segments}${reqUrl.search}`;
    if (inflight.has(targetUrl)) {
        try { const shared = await inflight.get(targetUrl); return new Response(shared.body, { status: shared.status, headers: shared.headers }); }
        catch { inflight.delete(targetUrl); }
    }
    const fetchPromise = doFetch(targetUrl, request);
    inflight.set(targetUrl, fetchPromise);
    try {
        const result = await fetchPromise;
        return new Response(result.body, { status: result.status, headers: result.headers });
    } catch (e) {
        const isAbort = e.name === 'AbortError';
        return new Response(JSON.stringify({ error: isAbort ? "API-CODE:PEACH-TIMEOUT" : "API-CODE:PEACH-FAILED", detail: e.message }), {
            status: isAbort ? 504 : 502, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
    } finally { setTimeout(() => inflight.delete(targetUrl), 500); }
}

async function doFetch(targetUrl, request) {
    const fetchHeaders = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", Accept: "*/*" };
    if (API_KEY) fetchHeaders["X-API-Key"] = API_KEY;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    let upstream;
    try { upstream = await fetch(targetUrl, { headers: fetchHeaders, signal: controller.signal }); } finally { clearTimeout(timeout); }
    const contentType = upstream.headers.get("content-type") || "";
    const isM3U8 = contentType.includes("mpegurl") || contentType.includes("x-mpegURL") || targetUrl.includes("m3u8-proxy");
    if (isM3U8) {
        let body = await upstream.text();
        body = body.replaceAll(PEACH_BASE + "/", "/api/peach/").replaceAll(encodeURIComponent(PEACH_BASE + "/"), encodeURIComponent("/api/peach/"));
        return { status: upstream.status, body, headers: { "Content-Type": "application/vnd.apple.mpegurl", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache" } };
    }
    const body = await upstream.text();
    const resHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Range", "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges, Content-Length", "Accept-Ranges": "bytes" };
    for (const h of ["content-type", "content-length", "content-range", "cache-control", "expires", "last-modified", "etag"]) {
        const v = upstream.headers.get(h); if (v) resHeaders[h] = v;
    }
    if (!resHeaders["cache-control"]) resHeaders["Cache-Control"] = "public, s-maxage=300, stale-while-revalidate=600";

    // ── Moviebox MP4: rewrite internal mp4-proxy URLs → CF Worker ───────────────
    // Backend returns: { url: "http://localhost:PORT/mp4-proxy?url=CDN&headers=JSON" }
    // We replace localhost:PORT with a CF worker host so the browser fetches
    // from Cloudflare's edge (handles Range, CORS, and CDN auth) — no VPS round-trip.
    const ct = (resHeaders["content-type"] || "").toLowerCase();
    if (ct.includes("application/json")) {
        try {
            const data = JSON.parse(body);
            if (data?.sources && Array.isArray(data.sources)) {
                let rewritten = false;
                const originalLength = data.sources.length;

                const validSources = (await Promise.all(data.sources.map(async src => {
                    if (!src.url || src.type !== "mp4") { delete src.headers; return src; }

                    // Validate MP4 Codec (Reject HEVC/Dolby Vision)
                    const isHevc = await isHevcMp4(src);
                    if (isHevc) {
                        console.log(`[peach] Rejected HEVC MP4 source: ${src.url.substring(0, 70)}...`);
                        return null; // Remove this source
                    }

                    // Case 1: Backend internal mp4-proxy URL → replace host with CF worker
                    const isInternalProxy = /^https?:\/\/(?:localhost|127\.0\.0\.1):\d+\//.test(src.url)
                                        || src.url.includes("/mp4-proxy?");
                    if (isInternalProxy) {
                        try {
                            const parsed = new URL(src.url);
                            const worker = nextWorkerHost();
                            
                            // Sanitize headers: remove IP forwarding headers that cause CDN drops
                            const hdrsStr = parsed.searchParams.get("headers");
                            let origin = null, referer = null;
                            if (hdrsStr) {
                                try {
                                    const hdrs = JSON.parse(hdrsStr);
                                    const cleanHdrs = {};
                                    for (const [k, v] of Object.entries(hdrs)) {
                                        const lowerK = k.toLowerCase();
                                        if (lowerK !== "x-forwarded-for" && lowerK !== "x-real-ip") {
                                            cleanHdrs[k] = v;
                                        }
                                        if (lowerK === "origin") origin = v;
                                        if (lowerK === "referer") referer = v;
                                    }
                                    parsed.searchParams.set("headers", JSON.stringify(cleanHdrs));
                                } catch (e) { /* ignore parse error */ }
                            }
                            
                            const workerUrl = `https://${worker}${parsed.pathname}${parsed.search}`;
                            src.url = await proxyToken(workerUrl);
                            rewritten = true;
                        } catch { /* malformed — leave url as-is */ }
                    }
                    // Case 2: Raw CDN URL — wrap in CF worker mp4-proxy format WITH headers
                    else {
                        const worker = nextWorkerHost();
                        let proxyUrl = `https://${worker}/mp4-proxy?url=${encodeURIComponent(src.url)}`;
                        // Pass origin/referer headers to CF worker if provided by backend
                        if (src.headers) {
                            const hdrs = typeof src.headers === 'string' ? JSON.parse(src.headers) : src.headers;
                            const cleanHdrs = {};
                            for (const [k, v] of Object.entries(hdrs)) {
                                const lowerK = k.toLowerCase();
                                if (lowerK !== "x-forwarded-for" && lowerK !== "x-real-ip") {
                                    cleanHdrs[k] = v;
                                }
                            }
                            if (cleanHdrs.origin || cleanHdrs.referer || cleanHdrs["user-agent"]) {
                                proxyUrl += `&headers=${encodeURIComponent(JSON.stringify(cleanHdrs))}`;
                            }
                        }
                        src.url = await proxyToken(proxyUrl);
                        rewritten = true;
                    }
                    delete src.headers; // never expose raw CDN credentials to client
                    return src;
                }))).filter(Boolean);

                // If we rejected ALL mp4 sources due to HEVC, return 404 to trigger fallback
                if (originalLength > 0 && validSources.length === 0) {
                    return { status: 404, body: JSON.stringify({ error: "MB_NO_SOURCES" }), headers: resHeaders };
                }

                data.sources = validSources;
                if (rewritten) resHeaders["Cache-Control"] = "no-store";
                return { status: upstream.status, body: JSON.stringify(data), headers: resHeaders };
            }
        } catch { /* not JSON / malformed — fall through */ }
    }

    return { status: upstream.status, body, headers: resHeaders };
}

export async function OPTIONS() {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "*" } });
}

async function isHevcMp4(src) {
    // We must fetch through the INTERNAL proxy (localhost) so CDN auth headers
    // (Origin, Referer) are applied correctly. DO NOT extract the raw CDN url.
    let probeUrl = src.url;
    let extraHeaders = {};

    // For raw CDN urls (Case 2 - not yet routed through proxy), pull the headers
    // the backend gave us so we can spoof the CDN auth.
    if (src.headers && !/^https?:\/\/(?:localhost|127\.0\.0\.1):\d+\//.test(probeUrl)) {
        try {
            extraHeaders = typeof src.headers === 'string' ? JSON.parse(src.headers) : src.headers;
        } catch { }
    }

    try {
        const fetchHeaders = {
            ...extraHeaders,
            "Range": "bytes=0-8191",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        };
        console.log(`[peach] codec-probe → ${probeUrl.substring(0, 90)}`);
        const res = await fetch(probeUrl, { headers: fetchHeaders, signal: AbortSignal.timeout(5000) });
        console.log(`[peach] codec-probe status: ${res.status} / ${res.headers.get("content-type")}`);

        if (!res.ok && res.status !== 206) {
            console.log(`[peach] codec-probe non-OK, failing open (assuming H.264)`);
            return false;
        }

        const buffer = await res.arrayBuffer();
        const text = new TextDecoder("ascii", { fatal: false }).decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 512)));
        const isHevc = text.includes("hvc1") || text.includes("hev1") || text.includes("dvhe") || text.includes("dvh1");
        console.log(`[peach] codec-probe result → isHEVC=${isHevc} (scanned ${buffer.byteLength} bytes)`);
        return isHevc;
    } catch (e) {
        console.log(`[peach] codec-probe EXCEPTION: ${e.message}`);
        return false;
    }
}
