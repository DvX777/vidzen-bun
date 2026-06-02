/**
 * Automated Link Suspender (ALS) — Blocklist
 *
 * Entries added from DMCA/DSA takedown notices.
 * Each entry is matched against the route params before the player loads.
 *
 * Format:
 *   movies → { type: "movie", id: "<tmdbId>" }
 *   tv     → { type: "tv",    id: "<tmdbId>" }  ← blocks the whole show
 *   tv ep  → { type: "tv",    id: "<tmdbId>", season: "<s>", episode: "<ep>" }
 *
 * "reason" is for internal notes only — never shown publicly.
 */

export const BLOCKLIST = [
  // ── Movies ──────────────────────────────────────────────────────────────
  { type: "movie", id: "1613798", reason: "MarkScan DMCA 2026-05-28" },
  { type: "movie", id: "1286185", reason: "ALS Block 2026-06-02" },

  // ── TV Shows (entire series blocked) ────────────────────────────────────
  // Shows: 290321, 299172, 275202, 259702, 230424, 248488, 137883, 279013,
  //        258842, 296243
  { type: "tv", id: "290321", reason: "MarkScan DMCA 2026-05-28" },
  { type: "tv", id: "299172", reason: "MarkScan DMCA 2026-05-28" },
  { type: "tv", id: "275202", reason: "MarkScan DMCA 2026-05-28" },
  { type: "tv", id: "259702", reason: "MarkScan DMCA 2026-05-28" },
  { type: "tv", id: "230424", reason: "MarkScan DMCA 2026-05-28" },
  { type: "tv", id: "248488", reason: "MarkScan DMCA 2026-05-28" },
  { type: "tv", id: "137883", reason: "MarkScan DMCA 2026-05-28" },
  { type: "tv", id: "279013", reason: "MarkScan DMCA 2026-05-28" },
  { type: "tv", id: "258842", reason: "MarkScan DMCA 2026-05-28" },
  { type: "tv", id: "296243", reason: "MarkScan DMCA 2026-05-28" },

  // ── TV Episodes ─────────────────────────────────────────────────────────
  { type: "tv", id: "115145", season: "1", episode: "1", reason: "ALS Block 2026-06-01" },
  { type: "tv", id: "115145", season: "1", episode: "10", reason: "ALS Block 2026-06-01" },
  { type: "tv", id: "115145", season: "1", episode: "11", reason: "ALS Block 2026-06-01" },
  { type: "tv", id: "115145", season: "1", episode: "12", reason: "ALS Block 2026-06-01" },
  { type: "tv", id: "115145", season: "1", episode: "2", reason: "ALS Block 2026-06-01" },
  { type: "tv", id: "115145", season: "1", episode: "3", reason: "ALS Block 2026-06-01" },
  { type: "tv", id: "115145", season: "1", episode: "4", reason: "ALS Block 2026-06-01" },
  { type: "tv", id: "115145", season: "1", episode: "5", reason: "ALS Block 2026-06-01" },
  { type: "tv", id: "115145", season: "1", episode: "6", reason: "ALS Block 2026-06-01" },
  { type: "tv", id: "115145", season: "1", episode: "7", reason: "ALS Block 2026-06-01" },
  { type: "tv", id: "115145", season: "1", episode: "8", reason: "ALS Block 2026-06-01" },
  { type: "tv", id: "115145", season: "1", episode: "9", reason: "ALS Block 2026-06-01" },
];

/**
 * Returns true if the given route params match a blocklist entry.
 * @param {{ type: string, id: string, season?: string, episode?: string }} params
 */
export function isBlocked(params) {
  const { type, id, season, episode } = params;
  return BLOCKLIST.some((entry) => {
    if (entry.type !== type) return false;
    if (entry.id !== String(id)) return false;
    // If the entry has season/episode, match those too
    if (entry.season && entry.season !== String(season)) return false;
    if (entry.episode && entry.episode !== String(episode)) return false;
    return true;
  });
}
