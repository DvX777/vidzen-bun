// app/lib/tmdbToImdb.js
// Server-side utility: convert TMDB ID → IMDB ID using the /external_ids endpoint.
// Results are cached in an LRU cache so each TMDB ID is only looked up once per process lifetime.

import { LRUCache } from './lruCache';

const TMDB_KEY = process.env.NEXT_PUBLIC_TMDB_API_KEY || '5263089f83877823a641b104f4f8d041';
const _cache = new LRUCache(1000, 24 * 60 * 60_000); // 1000 entries, 24h TTL

/**
 * Convert a TMDB ID to an IMDB ID.
 * @param {'movie'|'tv'} type  - Media type
 * @param {string|number} tmdbId - TMDB numeric ID (e.g. 666243)
 * @returns {Promise<string|null>} IMDB ID string (e.g. "tt0816692") or null if not found
 */
export async function tmdbToImdb(type, tmdbId) {
  const cacheKey = `${type}:${tmdbId}`;
  const cached = _cache.get(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/${type}/${tmdbId}/external_ids?api_key=${TMDB_KEY}`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const imdbId = data.imdb_id || null;
    if (imdbId) _cache.set(cacheKey, imdbId);
    return imdbId;
  } catch {
    return null;
  }
}
