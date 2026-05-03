// app/api/peachify/[...path]/route.js — identical to VidMax
const PEACHIFY_KEY_HEX = 'd8f2a1b5e9c470814f6b2c3a5d8e7f901a2b3c4d5e3f7a8b9c0d1e2f3a4b5c6d';
const PROVIDER_BASES = { moviebox: 'https://uwu.peachify.top', vixsrc: 'https://uwu.peachify.top', myflixerz: 'https://neon.peachify.top' };
const PEACHIFY_HEADERS = { 'Origin': 'https://peachify.top', 'Referer': 'https://peachify.top/', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', 'Accept': 'application/json, text/plain, */*' };
const cache = new Map();
const CACHE_TTL = 2 * 60 * 1000;
function getCached(key) { const e = cache.get(key); if (!e) return null; if (Date.now() - e.ts > CACHE_TTL) { cache.delete(key); return null; } return e.data; }
function setCached(key, data) { cache.set(key, { data, ts: Date.now() }); if (cache.size > 300) { const now = Date.now(); for (const [k, v] of cache) { if (now - v.ts > CACHE_TTL) cache.delete(k); } } }
function hexToBytes(hex) { const b = new Uint8Array(hex.length / 2); for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16); return b; }
function b64urlToBytes(b64url) { const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/'); const padded = b64 + '=='.slice((b64.length % 4) || 4); const binary = atob(padded); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); return bytes; }
async function decryptPeachify(encryptedData) {
    const keyBytes = hexToBytes(PEACHIFY_KEY_HEX);
    const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
    const parts = encryptedData.split('.');
    if (parts.length !== 3) throw new Error(`Invalid format`);
    const [ivPart, ctPart, tagPart] = parts;
    const ctBytes = b64urlToBytes(ctPart); const tagBytes = b64urlToBytes(tagPart);
    const ciphertextAndTag = new Uint8Array(ctBytes.length + tagBytes.length);
    ciphertextAndTag.set(ctBytes, 0); ciphertextAndTag.set(tagBytes, ctBytes.length);
    const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64urlToBytes(ivPart) }, cryptoKey, ciphertextAndTag);
    return JSON.parse(new TextDecoder().decode(plainBuffer));
}
function normalizeSources(data) {
    if (!data?.sources || !Array.isArray(data.sources)) return { sources: [] };
    const sources = data.sources.map(src => ({ url: src.url || src.link || '', type: src.type || (src.url?.includes('.m3u8') ? 'hls' : 'mp4'), quality: src.quality || src.resolution || 0, dub: src.dub || src.lang || 'English', ...(src.headers && { headers: src.headers }) })).filter(s => s.url);
    return { sources };
}
export async function GET(request, { params }) {
    const { path } = await params;
    const segments = Array.isArray(path) ? path : [path];
    if (segments.length < 3) return jsonError(400, 'Invalid path');
    const [provider, type, tmdbId, season, episode] = segments;
    const baseUrl = PROVIDER_BASES[provider];
    if (!baseUrl) return jsonError(404, `Unknown provider: ${provider}`);
    if (type !== 'movie' && type !== 'tv') return jsonError(400, `Invalid type: ${type}`);
    let upstreamPath = `/${provider}/${type}/${tmdbId}`;
    if (type === 'tv') { if (!season || !episode) return jsonError(400, 'TV requires season+episode'); upstreamPath += `/${season}/${episode}`; }
    const upstreamUrl = `${baseUrl}${upstreamPath}`;
    const cached = getCached(upstreamUrl);
    if (cached) return new Response(JSON.stringify(cached), { headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT', 'Access-Control-Allow-Origin': '*' } });
    const controller = new AbortController();
    const fetchTimer = setTimeout(() => controller.abort(), 30_000);
    let upstreamRes;
    try { upstreamRes = await fetch(upstreamUrl, { headers: PEACHIFY_HEADERS, signal: controller.signal }); }
    catch (e) { clearTimeout(fetchTimer); if (e.name === 'AbortError') return jsonError(504, 'Timeout'); return jsonError(502, e.message); }
    finally { clearTimeout(fetchTimer); }
    if (!upstreamRes.ok) return jsonError(upstreamRes.status, `HTTP ${upstreamRes.status}`);
    let rawJson;
    try { rawJson = await upstreamRes.json(); } catch { return jsonError(502, 'Non-JSON response'); }
    let data;
    if (rawJson?.isEncrypted && rawJson?.data) {
        try { data = await decryptPeachify(rawJson.data); } catch (e) { return jsonError(502, 'Decryption failed'); }
    } else { data = rawJson; }
    const normalized = normalizeSources(data);
    setCached(upstreamUrl, normalized);
    return new Response(JSON.stringify(normalized), { headers: { 'Content-Type': 'application/json', 'X-Cache': 'MISS', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=240' } });
}
export async function OPTIONS() { return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': '*' } }); }
function jsonError(status, message) { return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }); }
