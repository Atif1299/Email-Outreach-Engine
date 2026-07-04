const CACHE_TTL_MS = 8000

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

let allCampaignStatsCache: CacheEntry<unknown> | null = null

export function getCachedAllCampaignStats<T>(): T | null {
  if (!allCampaignStatsCache) return null
  if (Date.now() > allCampaignStatsCache.expiresAt) {
    allCampaignStatsCache = null
    return null
  }
  return allCampaignStatsCache.data as T
}

export function setCachedAllCampaignStats<T>(data: T): void {
  allCampaignStatsCache = {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  }
}

export function invalidateAllCampaignStatsCache(): void {
  allCampaignStatsCache = null
}
