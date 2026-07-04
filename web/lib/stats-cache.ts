const CACHE_TTL_MS = 12000

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

let allCampaignStatsCache: CacheEntry<unknown> | null = null
let lastGoodAllCampaignStats: unknown | null = null

export function getCachedAllCampaignStats<T>(): T | null {
  if (!allCampaignStatsCache) return null
  if (Date.now() > allCampaignStatsCache.expiresAt) {
    allCampaignStatsCache = null
    return null
  }
  return allCampaignStatsCache.data as T
}

export function getStaleAllCampaignStats<T>(): T | null {
  if (allCampaignStatsCache) return allCampaignStatsCache.data as T
  return lastGoodAllCampaignStats as T | null
}

export function setCachedAllCampaignStats<T>(data: T): void {
  allCampaignStatsCache = {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  }
  lastGoodAllCampaignStats = data
}

export function invalidateAllCampaignStatsCache(): void {
  allCampaignStatsCache = null
}
