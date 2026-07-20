const CACHE_TTL_MS = 5000
const QUEUE_STATUS_TTL_MS = 4000

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

let allCampaignStatsCache: CacheEntry<unknown> | null = null
let lastGoodAllCampaignStats: unknown | null = null
let queueStatusCache: CacheEntry<unknown> | null = null

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
  queueStatusCache = null
}

export function getCachedQueueStatus<T>(): T | null {
  if (!queueStatusCache) return null
  if (Date.now() > queueStatusCache.expiresAt) {
    queueStatusCache = null
    return null
  }
  return queueStatusCache.data as T
}

export function setCachedQueueStatus<T>(data: T): void {
  queueStatusCache = {
    data,
    expiresAt: Date.now() + QUEUE_STATUS_TTL_MS,
  }
}

export function invalidateQueueStatusCache(): void {
  queueStatusCache = null
}
