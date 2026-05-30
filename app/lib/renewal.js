// app/lib/renewal.js
// SRPS Background Renewal Worker — refreshes provider sources reactively on SFBS failure.

import { cacheGet, cacheSet, cacheSetProvider } from "./redisCache";
import { validateSources } from "./sfb";

/**
 * Trigger a background renewal for a specific provider.
 * Debounced: only one renewal per provider+media per 60 seconds.
 */
export async function triggerRenewal(provider, type, id, season, episode) {
  const lockKey = `vz:renew:${provider}:${type}:${id}${season ? `:s${season}:e${episode}` : ""}`;
  
  // Check debounce lock
  const locked = await cacheGet(lockKey);
  if (locked) {
    console.log(`[SRPS] Renewal lock active for ${provider} on ${type}/${id}. Skipping duplicate.`);
    return;
  }
  
  // Set lock (60s)
  await cacheSet(lockKey, { t: Date.now() }, 60);
  console.log(`[SRPS] 🔄 Triggering background renewal for ${provider} on ${type}/${id}...`);
  
  try {
    // Dynamic import to avoid circular deps
    const { fetchProvider, stripVaultForCache } = await import("./srpsProviders");
    const result = await fetchProvider(provider, type, id, season, episode);
    
    if (result?.sources?.length) {
      const validated = await validateSources(result);
      if (validated?.sources?.length) {
        await cacheSetProvider(type, id, season, episode, provider, stripVaultForCache(validated));
        console.log(`[SRPS] ✓ Renewed ${provider} for ${type}/${id}`);
        return;
      }
    }
    console.warn(`[SRPS] ✗ Renewal returned no valid sources for ${provider}`);
  } catch (err) {
    console.warn(`[SRPS] ✗ Renewal failed for ${provider}: ${err.message}`);
    // Keep existing cached entries on failure — stale is better than dead
  }
}
