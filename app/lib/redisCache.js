// app/lib/redisCache.js
// Redis caching layer for VidZen — caches provider source responses.
// Supports: Upstash REST Redis (production) → ioredis (local) → in-memory fallback.

const REDIS_URL = process.env.REDIS_URL;
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// ── Default TTLs ────────────────────────────────────────────────────────
const DEFAULT_TTL = 3600;       // 1 hour for normal responses
const DEMO_TTL = 7200;          // 2 hours for landing page demo content
const NOT_FOUND_TTL = 300;      // 5 min for "no sources" results

// ── Redis Client (lazy singleton) ───────────────────────────────────────
let redis = null;
let redisAvailable = false;
let redisType = "none"; // "upstash" | "ioredis" | "none"

async function getRedis() {
  if (redis) return redis;

  // Priority 1: Upstash REST Redis (works everywhere, no TCP needed)
  if (UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN) {
    try {
      const { Redis } = await import("@upstash/redis");
      redis = new Redis({
        url: UPSTASH_REDIS_REST_URL,
        token: UPSTASH_REDIS_REST_TOKEN,
      });
      redisAvailable = true;
      redisType = "upstash";
      console.log("[Redis] Connected via Upstash REST");
      return redis;
    } catch (err) {
      console.warn("[Redis] Upstash init failed:", err.message);
    }
  }

  // Priority 2: ioredis (local Redis or custom REDIS_URL)
  if (REDIS_URL) {
    try {
      const Redis = (await import("ioredis")).default;
      redis = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 1,
        retryStrategy: (times) => {
          if (times > 3) {
            redisAvailable = false;
            console.warn("[Redis] Giving up after 3 retries. Using in-memory fallback.");
            return null;
          }
          return Math.min(times * 200, 2000);
        },
        lazyConnect: true,
        connectTimeout: 3000,
      });

      redis.on("error", (err) => {
        if (redisAvailable) {
          console.warn("[Redis] Connection error:", err.message, "— falling back to memory");
          redisAvailable = false;
        }
      });

      redis.on("connect", () => {
        redisAvailable = true;
        console.log("[Redis] Connected via ioredis");
      });

      await redis.connect().catch(() => {
        redisAvailable = false;
      });

      redisType = "ioredis";
      return redis;
    } catch {
      redisAvailable = false;
    }
  }

  // No Redis available
  console.log("[Redis] No Redis configured. Using in-memory fallback.");
  return null;
}

// ── In-memory fallback ──────────────────────────────────────────────────
const memCache = new Map();

function memGet(key) {
  const entry = memCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    memCache.delete(key);
    return null;
  }
  return entry.value;
}

function memSet(key, value, ttlSec) {
  memCache.set(key, {
    value,
    expiresAt: Date.now() + ttlSec * 1000,
  });
  // Cap memory cache at 500 entries
  if (memCache.size > 500) {
    const oldest = memCache.keys().next().value;
    memCache.delete(oldest);
  }
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Get a cached value by key.
 * @returns {any | null} parsed JSON value, or null if miss
 */
export async function cacheGet(key) {
  const prefixedKey = `vz:${key}`;
  try {
    const r = await getRedis();
    if (r && redisAvailable) {
      const raw = await r.get(prefixedKey);
      if (raw) {
        console.log(`[Redis] HIT: ${key}`);
        return typeof raw === "string" ? JSON.parse(raw) : raw;
      }
      return null;
    }
  } catch {}
  // Fallback
  return memGet(prefixedKey);
}

/**
 * Set a cached value with TTL.
 * @param {string} key
 * @param {any} value - will be JSON.stringify'd
 * @param {number} ttlSec - TTL in seconds (default: 1h)
 */
export async function cacheSet(key, value, ttlSec = DEFAULT_TTL) {
  const prefixedKey = `vz:${key}`;
  const json = JSON.stringify(value);
  try {
    const r = await getRedis();
    if (r && redisAvailable) {
      if (redisType === "upstash") {
        await r.set(prefixedKey, json, { ex: ttlSec });
      } else {
        await r.setex(prefixedKey, ttlSec, json);
      }
      console.log(`[Redis] SET: ${key} (TTL: ${ttlSec}s)`);
      return;
    }
  } catch {}
  // Fallback
  memSet(prefixedKey, value, ttlSec);
}

/**
 * Build a cache key for source lookups.
 */
export function sourceKey(type, id, server = null, season = null, episode = null) {
  let key = `src:${type}:${id}`;
  if (season) key += `:s${season}`;
  if (episode) key += `:e${episode}`;
  if (server) key += `:${server}`;
  return key;
}

export { DEFAULT_TTL, DEMO_TTL, NOT_FOUND_TTL };
