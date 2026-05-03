// app/lib/serverCrypto.js
// Server-side AES-256-GCM token encryption for hiding streaming CDN URLs.
// Key is derived from STREAM_SECRET env var — never exposed to the client.
// All provider routes encrypt CDN URLs into opaque tokens.
// Network tab shows /api/proxy?t=TOKEN, never the real CDN URL.

const ENC = "AES-GCM";
const TOKEN_TTL_S = 7200; // 2 hours (matches backend cache TTL)

let _key = null;

async function getKey() {
  if (_key) return _key;
  const secret = process.env.STREAM_SECRET;
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveKey"]);
  _key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("vz-stream-salt-v1"), iterations: 100_000, hash: "SHA-256" },
    km, { name: ENC, length: 256 }, false, ["encrypt", "decrypt"]
  );
  return _key;
}

/** Encrypt a stream payload → opaque base64url token */
export async function encryptToken(payload) {
  const key = await getKey();
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const data = JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_S });
  const ct   = await crypto.subtle.encrypt({ name: ENC, iv }, key, new TextEncoder().encode(data));
  const buf  = new Uint8Array(12 + ct.byteLength);
  buf.set(iv);
  buf.set(new Uint8Array(ct), 12);
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decrypt a token → original payload, or null if invalid/expired */
export async function decryptToken(token) {
  try {
    const key = await getKey();
    const raw = Uint8Array.from(atob(token.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    const pt  = await crypto.subtle.decrypt({ name: ENC, iv: raw.slice(0, 12) }, key, raw.slice(12));
    const payload = JSON.parse(new TextDecoder().decode(pt));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null; // expired
    return payload;
  } catch {
    return null;
  }
}

/** Build a proxied stream URL with an encrypted token */
export async function proxyToken(url, { origin = null, referer = null } = {}) {
  const token = await encryptToken({ url, origin, referer });
  return `/api/proxy?t=${token}`;
}
