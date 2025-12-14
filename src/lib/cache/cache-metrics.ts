/**
 * Cache Metrics & Monitoring
 * PERFORMANCE: Analisi hit rate, TTL analytics e performance monitoring
 */

interface CacheHit {
  key: string
  timestamp: number
  hitTime: number
  cacheType: string
  size?: number
}

interface CacheMiss {
  key: string
  timestamp: number
  reason: 'expired' | 'not_found' | 'evicted'
  cacheType: string
}

interface CacheMetricsSnapshot {
  timestamp: number
  hits: number
  misses: number
  hitRate: number
  averageHitTime: number
  totalSize: number
  evictions: number
  cacheTypes: Record<string, {
    hits: number
    misses: number
    hitRate: number
  }>
}

/**
 * Cache Metrics Collector
 */
class CacheMetricsCollector {
  private hits: CacheHit[] = []
  private misses: CacheMiss[] = []
  private snapshots: CacheMetricsSnapshot[] = []
  private readonly maxHistorySize = 10000
  private readonly snapshotInterval = 60 * 1000 // 1 minute

  constructor() {
    // Automatic snapshots
    setInterval(() => {
      this.createSnapshot()
    }, this.snapshotInterval)
  }

  /**
   * Record cache hit
   */
  recordHit(key: string, cacheType: string, hitTime: number, size?: number): void {
    const hit: CacheHit = {
      key: this.sanitizeKey(key),
      timestamp: Date.now(),
      hitTime,
      cacheType,
      size
    }

    this.hits.push(hit)
    this.trimHistory()
  }

  /**
   * Record cache miss
   */
  recordMiss(key: string, cacheType: string, reason: 'expired' | 'not_found' | 'evicted'): void {
    const miss: CacheMiss = {
      key: this.sanitizeKey(key),
      timestamp: Date.now(),
      reason,
      cacheType
    }

    this.misses.push(miss)
    this.trimHistory()
  }

  /**
   * Get real-time metrics
   */
  getCurrentMetrics(): {
    overall: CacheMetricsSnapshot
    byType: Record<string, CacheMetricsSnapshot>
    trends: {
      hitRateTrend: number[]
      performanceTrend: number[]
      sizeTrend: number[]
    }
  } {
    const now = Date.now()
    const timeWindow = 5 * 60 * 1000 // 5 minutes

    const recentHits = this.hits.filter(h => now - h.timestamp < timeWindow)
    const recentMisses = this.misses.filter(m => now - m.timestamp < timeWindow)

    const overall = this.calculateMetrics(recentHits, recentMisses, now)
    
    // Per-type metrics
    const byType: Record<string, CacheMetricsSnapshot> = {}
    const cacheTypes = new Set([
      ...recentHits.map(h => h.cacheType),
      ...recentMisses.map(m => m.cacheType)
    ])

    for (const type of cacheTypes) {
      const typeHits = recentHits.filter(h => h.cacheType === type)
      const typeMisses = recentMisses.filter(m => m.cacheType === type)
      byType[type] = this.calculateMetrics(typeHits, typeMisses, now)
    }

    // Trend analysis
    const trends = this.calculateTrends()

    return { overall, byType, trends }
  }

  /**
   * Get performance insights
   */
  getPerformanceInsights(): {
    slowestKeys: Array<{key: string, avgHitTime: number, hitCount: number}>
    hottestKeys: Array<{key: string, hitCount: number, hitRate: number}>
    problemAreas: Array<{issue: string, description: string, recommendation: string}>
  } {
    const now = Date.now()
    const timeWindow = 15 * 60 * 1000 // 15 minutes
    
    const recentHits = this.hits.filter(h => now - h.timestamp < timeWindow)
    const recentMisses = this.misses.filter(m => now - m.timestamp < timeWindow)

    // Slowest keys
    const keyHitTimes = new Map<string, number[]>()
    for (const hit of recentHits) {
      if (!keyHitTimes.has(hit.key)) {
        keyHitTimes.set(hit.key, [])
      }
      keyHitTimes.get(hit.key)!.push(hit.hitTime)
    }

    const slowestKeys = Array.from(keyHitTimes.entries())
      .map(([key, times]) => ({
        key,
        avgHitTime: times.reduce((a, b) => a + b, 0) / times.length,
        hitCount: times.length
      }))
      .sort((a, b) => b.avgHitTime - a.avgHitTime)
      .slice(0, 10)

    // Hottest keys
    const keyHitCounts = new Map<string, number>()
    const keyMissCounts = new Map<string, number>()
    
    for (const hit of recentHits) {
      keyHitCounts.set(hit.key, (keyHitCounts.get(hit.key) || 0) + 1)
    }
    
    for (const miss of recentMisses) {
      keyMissCounts.set(miss.key, (keyMissCounts.get(miss.key) || 0) + 1)
    }

    const hottestKeys = Array.from(keyHitCounts.entries())
      .map(([key, hitCount]) => {
        const missCount = keyMissCounts.get(key) || 0
        const hitRate = hitCount / (hitCount + missCount)
        return { key, hitCount, hitRate }
      })
      .sort((a, b) => b.hitCount - a.hitCount)
      .slice(0, 10)

    // Problem areas
    const problemAreas: Array<{issue: string, description: string, recommendation: string}> = []
    
    const overallHitRate = recentHits.length / (recentHits.length + recentMisses.length)
    if (overallHitRate < 0.6) {
      problemAreas.push({
        issue: 'Low Hit Rate',
        description: `Overall hit rate is ${(overallHitRate * 100).toFixed(1)}%`,
        recommendation: 'Consider increasing cache size or TTL values'
      })
    }

    const avgHitTime = recentHits.reduce((sum, hit) => sum + hit.hitTime, 0) / recentHits.length
    if (avgHitTime > 5) {
      problemAreas.push({
        issue: 'Slow Cache Access',
        description: `Average hit time is ${avgHitTime.toFixed(2)}ms`,
        recommendation: 'Check cache size and consider memory optimization'
      })
    }

    const expiredMisses = recentMisses.filter(m => m.reason === 'expired').length
    if (expiredMisses > recentMisses.length * 0.3) {
      problemAreas.push({
        issue: 'High Expiration Rate',
        description: `${((expiredMisses / recentMisses.length) * 100).toFixed(1)}% of misses are due to expiration`,
        recommendation: 'Consider increasing TTL values for frequently accessed data'
      })
    }

    return { slowestKeys, hottestKeys, problemAreas }
  }

  /**
   * Export metrics for external monitoring
   */
  exportMetrics(): {
    prometheus: string
    json: any
  } {
    const metrics = this.getCurrentMetrics()
    
    // Prometheus format
    const prometheus = [
      `# HELP cache_hits_total Total number of cache hits`,
      `# TYPE cache_hits_total counter`,
      `cache_hits_total ${metrics.overall.hits}`,
      ``,
      `# HELP cache_misses_total Total number of cache misses`, 
      `# TYPE cache_misses_total counter`,
      `cache_misses_total ${metrics.overall.misses}`,
      ``,
      `# HELP cache_hit_rate Current hit rate`,
      `# TYPE cache_hit_rate gauge`, 
      `cache_hit_rate ${metrics.overall.hitRate}`,
      ``,
      `# HELP cache_average_hit_time_ms Average hit time in milliseconds`,
      `# TYPE cache_average_hit_time_ms gauge`,
      `cache_average_hit_time_ms ${metrics.overall.averageHitTime}`,
      ``
    ].join('\n')

    return {
      prometheus,
      json: {
        timestamp: Date.now(),
        metrics: metrics,
        insights: this.getPerformanceInsights()
      }
    }
  }

  /**
   * Reset metrics (for testing)
   */
  reset(): void {
    this.hits.length = 0
    this.misses.length = 0
    this.snapshots.length = 0
  }

  // Private methods

  private sanitizeKey(key: string): string {
    // Sanitize keys per privacy (rimuovi dati sensibili)
    if (key.includes('@')) {
      return key.replace(/([^@]+)@/, '***@')
    }
    if (key.length > 50) {
      return key.substring(0, 50) + '...'
    }
    return key
  }

  private trimHistory(): void {
    if (this.hits.length > this.maxHistorySize) {
      this.hits = this.hits.slice(-this.maxHistorySize * 0.8)
    }
    if (this.misses.length > this.maxHistorySize) {
      this.misses = this.misses.slice(-this.maxHistorySize * 0.8)
    }
  }

  private calculateMetrics(hits: CacheHit[], misses: CacheMiss[], timestamp: number): CacheMetricsSnapshot {
    const totalOps = hits.length + misses.length
    const hitRate = totalOps > 0 ? hits.length / totalOps : 0
    const averageHitTime = hits.length > 0 ? 
      hits.reduce((sum, hit) => sum + hit.hitTime, 0) / hits.length : 0
    const totalSize = hits.reduce((sum, hit) => sum + (hit.size || 0), 0)

    const cacheTypes: Record<string, any> = {}
    const typeStats = new Map<string, {hits: number, misses: number}>()

    for (const hit of hits) {
      const current = typeStats.get(hit.cacheType) || {hits: 0, misses: 0}
      current.hits++
      typeStats.set(hit.cacheType, current)
    }

    for (const miss of misses) {
      const current = typeStats.get(miss.cacheType) || {hits: 0, misses: 0}
      current.misses++
      typeStats.set(miss.cacheType, current)
    }

    for (const [type, stats] of typeStats.entries()) {
      const typeTotal = stats.hits + stats.misses
      cacheTypes[type] = {
        hits: stats.hits,
        misses: stats.misses,
        hitRate: typeTotal > 0 ? stats.hits / typeTotal : 0
      }
    }

    return {
      timestamp,
      hits: hits.length,
      misses: misses.length,
      hitRate,
      averageHitTime,
      totalSize,
      evictions: misses.filter(m => m.reason === 'evicted').length,
      cacheTypes
    }
  }

  private calculateTrends(): {
    hitRateTrend: number[]
    performanceTrend: number[]
    sizeTrend: number[]
  } {
    const recent10 = this.snapshots.slice(-10)
    
    return {
      hitRateTrend: recent10.map(s => s.hitRate),
      performanceTrend: recent10.map(s => s.averageHitTime),
      sizeTrend: recent10.map(s => s.totalSize)
    }
  }

  private createSnapshot(): void {
    const now = Date.now()
    const timeWindow = this.snapshotInterval
    
    const windowHits = this.hits.filter(h => now - h.timestamp < timeWindow)
    const windowMisses = this.misses.filter(m => now - m.timestamp < timeWindow)
    
    const snapshot = this.calculateMetrics(windowHits, windowMisses, now)
    this.snapshots.push(snapshot)
    
    // Keep only recent snapshots
    if (this.snapshots.length > 1440) { // 24 hours of minutes
      this.snapshots = this.snapshots.slice(-1000)
    }
  }
}

/**
 * Global metrics collector
 */
export const cacheMetrics = new CacheMetricsCollector()

/**
 * Decorators per automatic metrics
 */
export function withCacheMetrics<T>(
  cacheType: string,
  operation: () => Promise<{data: T | null, hit: boolean}>
): Promise<T | null> {
  return new Promise(async (resolve) => {
    const startTime = performance.now()
    
    try {
      const result = await operation()
      const hitTime = performance.now() - startTime
      
      if (result.hit && result.data !== null) {
        cacheMetrics.recordHit('key', cacheType, hitTime)
        resolve(result.data)
      } else {
        cacheMetrics.recordMiss('key', cacheType, 'not_found')
        resolve(null)
      }
    } catch (error) {
      const hitTime = performance.now() - startTime
      cacheMetrics.recordMiss('key', cacheType, 'not_found')
      resolve(null)
    }
  })
}

/**
 * Cache performance profiler
 */
export class CacheProfiler {
  private operations: Array<{
    key: string
    operation: 'get' | 'set' | 'delete'
    duration: number
    timestamp: number
    cacheType: string
  }> = []

  profile<T>(
    key: string,
    cacheType: string,
    operation: 'get' | 'set' | 'delete',
    fn: () => Promise<T>
  ): Promise<T> {
    const startTime = performance.now()
    
    return fn().then(result => {
      const duration = performance.now() - startTime
      
      this.operations.push({
        key: this.sanitizeKey(key),
        operation,
        duration,
        timestamp: Date.now(),
        cacheType
      })

      // Keep only recent operations
      if (this.operations.length > 1000) {
        this.operations = this.operations.slice(-800)
      }

      return result
    })
  }

  getReport(): {
    averageGetTime: number
    averageSetTime: number
    averageDeleteTime: number
    slowestOperations: Array<{operation: string, duration: number, key: string}>
  } {
    const gets = this.operations.filter(op => op.operation === 'get')
    const sets = this.operations.filter(op => op.operation === 'set')
    const deletes = this.operations.filter(op => op.operation === 'delete')

    const averageGetTime = gets.length > 0 ? 
      gets.reduce((sum, op) => sum + op.duration, 0) / gets.length : 0
    const averageSetTime = sets.length > 0 ?
      sets.reduce((sum, op) => sum + op.duration, 0) / sets.length : 0
    const averageDeleteTime = deletes.length > 0 ?
      deletes.reduce((sum, op) => sum + op.duration, 0) / deletes.length : 0

    const slowestOperations = [...this.operations]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10)
      .map(op => ({
        operation: op.operation,
        duration: op.duration,
        key: op.key
      }))

    return {
      averageGetTime,
      averageSetTime,
      averageDeleteTime,
      slowestOperations
    }
  }

  private sanitizeKey(key: string): string {
    if (key.length > 50) {
      return key.substring(0, 50) + '...'
    }
    return key
  }
}

export const cacheProfiler = new CacheProfiler()