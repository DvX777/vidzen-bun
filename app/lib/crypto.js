// app/lib/crypto.js
// Strong, fast session encryption — Web Crypto API (AES-256-GCM + HMAC-SHA256)
// Works in both browser and Edge/Node runtime (no external deps, zero round-trips)
// Used for: watch progress storage, media session tokens, all sensitive local state

const ENC = "AES-GCM";
const HASH = "SHA-256";

// ── Key derivation ────────────────────────────────────────────────────────────
// Derives a deterministic AES-256 key from a passphrase + salt.
// Uses PBKDF2 → 256-bit key, 100k iterations (fast on modern hardware, ~10ms)

async function deriveKey(passphrase, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 100_000, hash: HASH },
    keyMaterial,
    { name: ENC, length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// ── App-level key (fixed passphrase, user-agent salt → unique per device) ────
// This is intentionally lightweight — it's client-side storage protection,
// not server-secret cryptography. The goal is to prevent raw data snooping.

function getAppSalt() {
  if (typeof navigator === "undefined") return "vidzen-server-salt-2026";
  return `vz-${navigator.userAgent.slice(0, 48)}-2026`;
}

const APP_PASS = "VidZen-AES256-2026-7f3a9c";

let _appKey = null;
async function getAppKey() {
  if (_appKey) return _appKey;
  _appKey = await deriveKey(APP_PASS, getAppSalt());
  return _appKey;
}

// ── Core AES-256-GCM encrypt/decrypt ─────────────────────────────────────────

/**
 * Encrypts a string → returns base64url-encoded ciphertext.
 * Format: base64url(iv[12] + ciphertext)
 */
export async function encrypt(plaintext) {
  const key = await getAppKey();
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ct  = await crypto.subtle.encrypt({ name: ENC, iv }, key, enc.encode(plaintext));
  const buf = new Uint8Array(iv.byteLength + ct.byteLength);
  buf.set(iv, 0);
  buf.set(new Uint8Array(ct), iv.byteLength);
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decrypts a base64url-encoded ciphertext → plaintext string.
 * Returns null if decryption fails (tampered/wrong key).
 */
export async function decrypt(cipherB64) {
  try {
    const key = await getAppKey();
    const raw = Uint8Array.from(atob(cipherB64.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    const iv  = raw.slice(0, 12);
    const ct  = raw.slice(12);
    const pt  = await crypto.subtle.decrypt({ name: ENC, iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

// ── HMAC-SHA256 signing (for request tokens) ─────────────────────────────────

const HMAC_KEY_PASS = "VidZen-HMAC-2026-a4e8d1";

let _hmacKey = null;
async function getHmacKey() {
  if (_hmacKey) return _hmacKey;
  const enc = new TextEncoder();
  _hmacKey = await crypto.subtle.importKey(
    "raw", enc.encode(HMAC_KEY_PASS),
    { name: "HMAC", hash: HASH }, false, ["sign", "verify"]
  );
  return _hmacKey;
}

/**
 * Signs a message with HMAC-SHA256 → compact hex string.
 */
export async function sign(message) {
  const key = await getHmacKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Verifies an HMAC-SHA256 signature.
 */
export async function verify(message, hexSig) {
  const expected = await sign(message);
  return expected === hexSig;
}

// ── Watch Progress (encrypted localStorage) ───────────────────────────────────

const PROGRESS_KEY = "vz_progress_v1";

/**
 * Saves watch progress data (encrypted) to localStorage.
 * Data structure: { [mediaId]: { type, title, watched, duration, season?, episode?, ts } }
 */
export async function saveProgress(data) {
  if (typeof localStorage === "undefined") return;
  const json = JSON.stringify(data);
  const ciphertext = await encrypt(json);
  localStorage.setItem(PROGRESS_KEY, ciphertext);
}

/**
 * Loads and decrypts watch progress from localStorage.
 * Returns {} if nothing stored or decryption fails.
 */
export async function loadProgress() {
  if (typeof localStorage === "undefined") return {};
  const raw = localStorage.getItem(PROGRESS_KEY);
  if (!raw) return {};
  const json = await decrypt(raw);
  if (!json) return {};
  try { return JSON.parse(json); } catch { return {}; }
}

/**
 * Updates a single media entry's progress (merge, not replace).
 */
export async function updateProgress(mediaId, entry) {
  const all = await loadProgress();
  all[mediaId] = { ...all[mediaId], ...entry, ts: Date.now() };
  await saveProgress(all);
}

/**
 * Gets progress for a single media item. Returns null if not found.
 */
export async function getProgress(mediaId) {
  const all = await loadProgress();
  return all[mediaId] || null;
}
