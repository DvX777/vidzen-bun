// app/api/sources/route.js
// Unified provider bridge for Vidzen using the Smart Racing Provider System (SRPS).

export const runtime = "nodejs";

import { vaultUrl, resolveUrl } from "@/lib/streamVault";
import { 
  cacheGet, 
  cacheSet, 
  sourceKey, 
  cacheGetProvider, 
  cacheSetProvider, 
  cacheGetMeta, 
  cacheSetMeta, 
  cacheGetAllProviders,
  isProviderHealthy,
  DEFAULT_TTL, 
  DEMO_TTL, 
  NOT_FOUND_TTL 
} from "@/lib/redisCache";
import { isBlocked } from "@/lib/blocklist";
import { validateSources } from "@/lib/sfb";
import {
  PROVIDER_MAP,
  SERVERS,
  BETA_PROVIDERS,
  RACE_EXCLUDED,
  maskName,
  unmaskName,
  stripVaultForCache,
  refreshVaultUrls
} from "@/lib/srpsProviders";

const NB_URL = process.env.NB_SYSTEM_URL || "http://localhost:3001";
const DEMO_MOVIE_ID = "786892";

// Helper to incrementally update/create racing metadata in Redis cache
async function appendProviderToMeta(type, id, season, episode, providerName, isFirstWinner = false) {
  try {
    const meta = await cacheGetMeta(type, id, season, episode);
    if (meta) {
      if (!meta.providers.includes(providerName)) {
        meta.providers.push(providerName);
        await cacheSetMeta(type, id, season, episode, meta);
        console.log(`[sources] Appended ${providerName} to cached meta for ${type}/${id}`);
      }
    } else if (isFirstWinner) {
      const newMeta = {
        providers: [providerName],
        racedAt: Date.now(),
        firstWinner: maskName(providerName),
      };
      await cacheSetMeta(type, id, season, episode, newMeta);
      console.log(`[sources] Initial Meta created for ${type}/${id} with firstWinner: ${providerName}`);
    }
  } catch (err) {
    console.warn(`[sources] Failed to update meta for ${providerName}:`, err.message);
  }
}

// ── Parallel Race with 15s Timeout Cap and Background caching ───────────────
async function raceAndCacheAll(type, id, season, episode) {
  const entries = Object.entries(PROVIDER_MAP).filter(([name]) => !RACE_EXCLUDED.has(name));
  
  // Filter unhealthy providers
  const healthyEntries = [];
  for (const [name, fn] of entries) {
    const healthy = await isProviderHealthy(name);
    if (healthy) {
      healthyEntries.push([name, fn]);
    } else {
      console.log(`[sources] 🚫 Skipping unhealthy provider ${maskName(name)} from race`);
    }
  }

  if (healthyEntries.length === 0) {
    console.warn("[sources] ⚠️ No healthy providers. Using all as fallback.");
    healthyEntries.push(...entries);
  }

  let firstWinner = null;
  let firstWinnerResolve = null;
  
  const firstWinnerPromise = new Promise((resolve) => {
    firstWinnerResolve = resolve;
  });

  let completedCount = 0;
  const totalCount = healthyEntries.length;

  healthyEntries.forEach(([name, fn]) => {
    fn(type, id, season, episode)
      .then(async (result) => {
        if (result && result.sources?.length > 0) {
          const validated = await validateSources(result);
          if (validated && validated.sources?.length > 0) {
            console.log(`[sources] ✓ ${maskName(name)} — ${validated.sources.length} sources`);
            
            // Cache individual provider sources immediately
            const cleanCached = stripVaultForCache(validated);
            await cacheSetProvider(type, id, season, episode, name, cleanCached);
            
            let isFirst = false;
            if (!firstWinner) {
              firstWinner = { provider: maskName(name), ...validated };
              isFirst = true;
              firstWinnerResolve(firstWinner);
            }
            
            // Incrementally append to metadata immediately
            appendProviderToMeta(type, id, season, episode, name, isFirst).catch(() => {});
            return;
          }
        }
        console.log(`[sources] ✗ ${maskName(name)} — no sources`);
      })
      .catch((err) => {
        console.log(`[sources] ✗ ${maskName(name)} — error: ${err.message}`);
      })
      .finally(() => {
        completedCount++;
        if (completedCount >= totalCount) {
          firstWinnerResolve(null); // Resolve if all finish and none won
        }
      });
  });

  // 15-second racing timeout cap
  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => {
      console.log("[sources] ⏱️ Race 15s timeout cap reached. Returning best effort pool.");
      resolve(null);
    }, 15000);
  });

  const winner = await Promise.race([firstWinnerPromise, timeoutPromise]);
  return winner || firstWinner;
}

// ── GET Route Handler ───────────────────────────────────────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "movie";
  const id = searchParams.get("id");
  const season = searchParams.get("season");
  const episode = searchParams.get("episode");
  const rawServer = searchParams.get("server");
  const forcedServer = rawServer ? unmaskName(rawServer) : null;
  const renew = searchParams.get("renew") === "true";

  if (!id) {
    return Response.json({ error: "Missing ?id= parameter" }, { status: 400 });
  }
  if (type === "tv" && (!season || !episode)) {
    return Response.json({ error: "Missing ?season= and ?episode= for TV" }, { status: 400 });
  }

  // Blocklist check
  if (isBlocked({ type, id, season, episode })) {
    console.log(`[sources] 🚫 BLOCKED (DSA): ${type}/${id}${season ? `/${season}/${episode}` : ""}`);
    return Response.json(
      { error: "This content has been removed due to a copyright compliance request.", blocked: true },
      { status: 451, headers: { "Cache-Control": "no-store" } }
    );
  }

  const mediaCtx = { type, id, season, episode };

  // ── Path 2: Server Switch / Direct Server Query ────────────────────────────
  if (forcedServer) {
    if (!PROVIDER_MAP[forcedServer]) {
      return Response.json({ error: `Unknown server alias: ${rawServer}` }, { status: 400 });
    }

    // 1. Check Redis cache first (if not forcing renewal)
    if (!renew) {
      const cached = await cacheGetProvider(type, id, season, episode, forcedServer);
      if (cached?.sources?.length) {
        const refreshed = refreshVaultUrls(cached, mediaCtx);
        console.log(`[sources] DIRECT CACHE HIT: ${rawServer} for ${type}/${id}`);
        return Response.json({
          ...refreshed,
          provider: maskName(forcedServer),
          servers: SERVERS,
          cached: true,
        }, { headers: { "Cache-Control": "no-store" } });
      }
    }

    // 2. Cache MISS (or renew=true) -> Query single provider
    let result = null;
    let lastError = null;
    try {
      console.log(`[sources] Forced query: ${maskName(forcedServer)} for ${type}/${id}`);
      result = await PROVIDER_MAP[forcedServer](type, id, season, episode);
    } catch (err) {
      lastError = err.message;
      console.warn(`[sources] ${forcedServer} query failed:`, err.message);
    }

    // SFB validate sources
    if (result?.sources?.length) {
      result = await validateSources(result);
    }

    if (result?.sources?.length) {
      const cleanData = stripVaultForCache(result);
      await cacheSetProvider(type, id, season, episode, forcedServer, cleanData);
      return Response.json({
        ...result,
        provider: maskName(forcedServer),
        servers: SERVERS,
      }, { headers: { "Cache-Control": "no-store" } });
    }

    // Return direct query error response
    const errorMsg = lastError?.includes("502") || lastError?.includes("timed out")
      ? `${maskName(forcedServer)} is temporarily unreachable`
      : `${maskName(forcedServer)} returned no sources`;

    return Response.json({
      sources: [], subtitles: [], provider: null, servers: SERVERS,
      error: errorMsg,
    }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }

  // ── Path 1: Initial Load (aggregate pool) ──────────────────────────────────
  if (!renew) {
    const meta = await cacheGetMeta(type, id, season, episode);
    if (meta?.providers?.length) {
      console.log(`[sources] META HIT: Loading pool for ${type}/${id}: ${meta.providers.join(", ")}`);
      
      const poolRaw = await cacheGetAllProviders(type, id, season, episode, meta.providers);
      const sourcePool = {};
      let activeProvider = null;
      let activeSources = [];
      let activeSubtitles = [];

      for (const providerName of meta.providers) {
        const cachedProviderData = poolRaw[providerName];
        if (cachedProviderData?.sources?.length) {
          const refreshed = refreshVaultUrls(cachedProviderData, mediaCtx);
          const alias = maskName(providerName);
          sourcePool[alias] = refreshed;
          
          // Select initial active provider (prefer firstWinner)
          if (providerName === meta.firstWinner || !activeProvider) {
            activeProvider = alias;
            activeSources = refreshed.sources;
            activeSubtitles = refreshed.subtitles;
          }
        }
      }

      if (activeSources.length > 0) {
        return Response.json({
          sources: activeSources,
          subtitles: activeSubtitles,
          provider: activeProvider,
          servers: SERVERS,
          sourcePool,
          cached: true,
        }, { headers: { "Cache-Control": "no-store" } });
      }
    }
  }

  // Cache MISS -> Run Race
  console.log(`[sources] Pool Cache MISS. Racing all providers for ${type}/${id}...`);
  const winner = await raceAndCacheAll(type, id, season, episode);

  if (winner) {
    // Generate pool of what finished so far
    const sourcePool = {};
    const meta = await cacheGetMeta(type, id, season, episode);
    const providersList = meta?.providers || [unmaskName(winner.provider)];
    
    const poolRaw = await cacheGetAllProviders(type, id, season, episode, providersList);
    for (const providerName of providersList) {
      const cachedData = poolRaw[providerName];
      if (cachedData?.sources?.length) {
        sourcePool[maskName(providerName)] = refreshVaultUrls(cachedData, mediaCtx);
      }
    }

    return Response.json({
      ...winner,
      servers: SERVERS,
      sourcePool,
    }, { headers: { "Cache-Control": "no-store" } });
  }

  // Absolute fallback if all race items fail
  return Response.json({
    sources: [], subtitles: [], provider: null, servers: SERVERS, sourcePool: {},
    error: "All providers failed to return sources",
  }, { status: 200, headers: { "Cache-Control": "no-store" } });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}
