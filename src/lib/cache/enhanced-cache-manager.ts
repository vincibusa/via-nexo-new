/**
 * Enhanced Cache Manager
 * PERFORMANCE: LRU cache avanzata con metriche e gestione intelligente
 */

interface CacheEntry<T = any> {
  data: T
  timestamp: number
  lastAccessed: number
  hitCount: number
  ttl: number
  size?: number // Per memory management
  tags?: string[] // Per invalidazione tag-based
}

interface CacheMetrics {
  hits: number
  misses: number
  sets: number
  deletes: number
  evictions: number
  totalSize: number
  averageAccessTime: number
  hitRate: number
}

interface CacheConfig {
  maxSize: number
  defaultTTL: number
  maxMemoryMB?: number
  cleanupInterval?: number
  enableMetrics?: boolean
}

/**
 * Enhanced LRU Cache con metriche avanzate
 */
export class EnhancedCacheManager<T = any> {
  private cache = new Map<string, CacheEntry<T>>()
  private accessOrder: string[] = []
  private metrics: CacheMetrics = {
    hits: 0,
    misses: 0, 
    sets: 0,
    deletes: 0,
    evictions: 0,
    totalSize: 0,
    averageAccessTime: 0,
    hitRate: 0
  }
  private config: CacheConfig
  private cleanupTimer?: NodeJS.Timeout
  private tagIndex = new Map<string, Set<string>>() // tag -> Set<keys>

  constructor(config: CacheConfig) {
    this.config = {
      cleanupInterval: 5 * 60 * 1000, // 5 minutes default
      enableMetrics: true,
      ...config
    }

    // Auto-cleanup timer
    if (this.config.cleanupInterval) {
      this.cleanupTimer = setInterval(() => {
        this.cleanup()
      }, this.config.cleanupInterval)
    }
  }

  /**
   * Get with advanced tracking
   */
  get(key: string): T | null {
    const startTime = performance.now()
    const entry = this.cache.get(key)

    if (!entry) {
      this.metrics.misses++
      this.updateHitRate()
      return null
    }

    // Check TTL
    const now = Date.now()
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key)
      this.removeFromAccessOrder(key)
      this.removeFromTags(key)
      this.metrics.misses++
      this.updateHitRate()
      return null
    }

    // Update access pattern
    entry.lastAccessed = now
    entry.hitCount++
    this.updateAccessOrder(key)
    
    // Metrics
    this.metrics.hits++
    const accessTime = performance.now() - startTime
    this.updateAverageAccessTime(accessTime)
    this.updateHitRate()

    return entry.data
  }

  /**
   * Set with size tracking and eviction
   */
  set(key: string, data: T, options: {
    ttl?: number
    tags?: string[]
    priority?: 'high' | 'medium' | 'low'
  } = {}): void {
    const now = Date.now()
    const ttl = options.ttl || this.config.defaultTTL
    const size = this.estimateSize(data)

    // Check memory limits
    if (this.config.maxMemoryMB && size > this.config.maxMemoryMB * 1024 * 1024) {
      console.warn(`[Cache] Entry too large (${(size / 1024 / 1024).toFixed(1)}MB), skipping`)
      return
    }

    // Evict if needed
    this.evictIfNecessary(size)

    // Remove old entry if exists
    if (this.cache.has(key)) {
      this.removeFromTags(key)
    }

    const entry: CacheEntry<T> = {
      data,
      timestamp: now,
      lastAccessed: now,
      hitCount: 0,
      ttl,
      size,
      tags: options.tags
    }

    this.cache.set(key, entry)
    this.updateAccessOrder(key, options.priority)
    
    // Tag indexing
    if (options.tags) {
      for (const tag of options.tags) {
        if (!this.tagIndex.has(tag)) {
          this.tagIndex.set(tag, new Set())
        }
        this.tagIndex.get(tag)!.add(key)
      }
    }

    this.metrics.sets++
    this.metrics.totalSize += size || 0
  }

  /**
   * Smart batch get - ottimizzato per performance
   */
  mget(keys: string[]): Record<string, T | null> {
    const result: Record<string, T | null> = {}
    const startTime = performance.now()

    for (const key of keys) {
      result[key] = this.get(key)
    }

    // Batch metrics
    const batchTime = performance.now() - startTime
    console.log(`[Cache] Batch get ${keys.length} keys in ${batchTime.toFixed(2)}ms`)

    return result
  }

  /**
   * Smart batch set
   */
  mset(entries: Array<{key: string, data: T, options?: any}>): void {
    const startTime = performance.now()
    
    for (const { key, data, options } of entries) {
      this.set(key, data, options)
    }

    const batchTime = performance.now() - startTime
    console.log(`[Cache] Batch set ${entries.length} keys in ${batchTime.toFixed(2)}ms`)
  }

  /**
   * Delete by key
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false

    this.cache.delete(key)
    this.removeFromAccessOrder(key)
    this.removeFromTags(key)
    
    this.metrics.deletes++
    this.metrics.totalSize -= entry.size || 0

    return true
  }

  /**
   * Invalidate by tags
   */
  invalidateByTags(tags: string[]): number {
    let deleted = 0
    const keysToDelete = new Set<string>()

    for (const tag of tags) {
      const tagKeys = this.tagIndex.get(tag)
      if (tagKeys) {
        for (const key of tagKeys) {
          keysToDelete.add(key)
        }
        this.tagIndex.delete(tag)
      }
    }

    for (const key of keysToDelete) {
      if (this.delete(key)) {
        deleted++
      }
    }

    console.log(`[Cache] Invalidated ${deleted} entries by tags: ${tags.join(', ')}`)
    return deleted
  }

  /**
   * Clear cache with optional pattern
   */
  clear(pattern?: RegExp): void {
    if (!pattern) {
      this.cache.clear()
      this.accessOrder.length = 0
      this.tagIndex.clear()
      this.resetMetrics()
      return
    }

    const keysToDelete: string[] = []
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        keysToDelete.push(key)
      }
    }

    for (const key of keysToDelete) {
      this.delete(key)
    }

    console.log(`[Cache] Cleared ${keysToDelete.length} entries matching pattern`)
  }

  /**
   * Cleanup expired entries
   */
  cleanup(): void {
    const startTime = performance.now()
    const now = Date.now()
    const keysToDelete: string[] = []

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        keysToDelete.push(key)
      }
    }

    for (const key of keysToDelete) {
      this.delete(key)
    }

    const cleanupTime = performance.now() - startTime
    console.log(`[Cache] Cleanup removed ${keysToDelete.length} expired entries in ${cleanupTime.toFixed(2)}ms`)
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheMetrics & {
    size: number
    memoryUsageMB: number
    topKeys: Array<{key: string, hits: number, lastAccessed: Date}>
  } {
    const topKeys = Array.from(this.cache.entries())
      .sort(([,a], [,b]) => b.hitCount - a.hitCount)
      .slice(0, 10)
      .map(([key, entry]) => ({
        key,
        hits: entry.hitCount,
        lastAccessed: new Date(entry.lastAccessed)
      }))

    return {
      ...this.metrics,
      size: this.cache.size,
      memoryUsageMB: this.metrics.totalSize / 1024 / 1024,
      topKeys
    }
  }

  /**
   * Export cache state per debugging
   */
  export(): Record<string, any> {
    const entries: Record<string, any> = {}
    for (const [key, entry] of this.cache.entries()) {
      entries[key] = {
        timestamp: new Date(entry.timestamp),
        lastAccessed: new Date(entry.lastAccessed),
        hitCount: entry.hitCount,
        ttl: entry.ttl,
        size: entry.size,
        tags: entry.tags
      }
    }
    return entries
  }

  /**
   * Destroy cache manager
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
    }
    this.cache.clear()
    this.accessOrder.length = 0
    this.tagIndex.clear()
    this.resetMetrics()
  }

  // Private methods

  private estimateSize(data: any): number {
    if (data === null || data === undefined) return 0
    if (typeof data === 'string') return data.length * 2
    if (typeof data === 'number') return 8
    if (typeof data === 'boolean') return 4
    
    try {
      return JSON.stringify(data).length * 2
    } catch {
      return 1024 // Fallback for circular refs
    }
  }

  private evictIfNecessary(newEntrySize: number): void {
    // Size-based eviction
    while (this.cache.size >= this.config.maxSize) {
      this.evictLRU()
    }

    // Memory-based eviction
    if (this.config.maxMemoryMB) {
      const maxBytes = this.config.maxMemoryMB * 1024 * 1024
      while (this.metrics.totalSize + newEntrySize > maxBytes && this.cache.size > 0) {
        this.evictLRU()
      }
    }
  }

  private evictLRU(): void {
    if (this.accessOrder.length === 0) return

    const keyToEvict = this.accessOrder.shift()!
    const entry = this.cache.get(keyToEvict)
    
    if (entry) {
      this.cache.delete(keyToEvict)
      this.removeFromTags(keyToEvict)
      this.metrics.evictions++
      this.metrics.totalSize -= entry.size || 0
    }
  }

  private updateAccessOrder(key: string, priority?: 'high' | 'medium' | 'low'): void {
    this.removeFromAccessOrder(key)
    
    if (priority === 'high') {
      // High priority goes to end (most recently used)
      this.accessOrder.push(key)
    } else if (priority === 'low') {
      // Low priority goes near front
      this.accessOrder.splice(1, 0, key)
    } else {
      // Default: add to end
      this.accessOrder.push(key)
    }
  }

  private removeFromAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key)
    if (index !== -1) {
      this.accessOrder.splice(index, 1)
    }
  }

  private removeFromTags(key: string): void {
    for (const [tag, keys] of this.tagIndex.entries()) {
      keys.delete(key)
      if (keys.size === 0) {
        this.tagIndex.delete(tag)
      }
    }
  }

  private updateHitRate(): void {
    const total = this.metrics.hits + this.metrics.misses
    this.metrics.hitRate = total > 0 ? this.metrics.hits / total : 0
  }

  private updateAverageAccessTime(newTime: number): void {
    const total = this.metrics.hits + this.metrics.misses
    this.metrics.averageAccessTime = 
      (this.metrics.averageAccessTime * (total - 1) + newTime) / total
  }

  private resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      totalSize: 0,
      averageAccessTime: 0,
      hitRate: 0
    }
  }
}

/**
 * Global cache instances per use case
 */
export const geoCache = new EnhancedCacheManager({
  maxSize: 1000,
  defaultTTL: 10 * 60 * 1000, // 10 minutes
  maxMemoryMB: 50,
  cleanupInterval: 5 * 60 * 1000
})

export const embedCache = new EnhancedCacheManager({
  maxSize: 500,
  defaultTTL: 60 * 60 * 1000, // 1 hour
  maxMemoryMB: 100,
  cleanupInterval: 10 * 60 * 1000
})

export const apiCache = new EnhancedCacheManager({
  maxSize: 2000,
  defaultTTL: 5 * 60 * 1000, // 5 minutes
  maxMemoryMB: 30,
  cleanupInterval: 2 * 60 * 1000
})

/**
 * Utility per stats globali
 */
export function getAllCacheStats() {
  return {
    geo: geoCache.getStats(),
    embeddings: embedCache.getStats(),
    api: apiCache.getStats()
  }
}