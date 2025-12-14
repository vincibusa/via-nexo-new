/**
 * Cache Dashboard & Monitoring
 * PERFORMANCE: Admin utilities per monitorare e gestire cache layers
 */

import { getAllCacheStats } from './enhanced-cache-manager'
import { hybridGeoCache, hybridApiCache, hybridEmbeddingCache } from './supabase-cache-manager'
import { cacheMetrics } from './cache-metrics'
import { getReadOnlyClient } from '@/lib/supabase/connection-pool'

export interface CacheDashboardData {
  timestamp: string
  performance: {
    memory: any
    hybrid: any
    metrics: any
  }
  health: {
    issues: Array<{
      layer: string
      severity: 'warning' | 'error'
      message: string
      recommendation: string
    }>
    score: number // 0-100
  }
  operations: {
    cleanup: {
      lastRun: string | null
      entriesRemoved: number
    }
    usage: {
      topKeys: Array<{ key: string, hits: number, layer: string }>
      patterns: Array<{ pattern: string, frequency: number }>
    }
  }
}

/**
 * Gather comprehensive cache dashboard data
 */
export async function getCacheDashboardData(): Promise<CacheDashboardData> {
  const timestamp = new Date().toISOString()

  try {
    // Collect performance data from all layers
    const [memoryStats, hybridGeoStats, hybridApiStats, hybridEmbeddingStats, metricsData] = await Promise.all([
      getAllCacheStats(),
      hybridGeoCache.getStats(),
      hybridApiCache.getStats(),
      hybridEmbeddingCache.getStats(),
      cacheMetrics.getCurrentMetrics()
    ])

    // Analyze health issues
    const health = analyzeHealthIssues({
      memory: memoryStats,
      hybrid: { geo: hybridGeoStats, api: hybridApiStats, embedding: hybridEmbeddingStats },
      metrics: metricsData
    })

    // Get usage patterns
    const usage = await getUsagePatterns()

    // Get last cleanup info
    const cleanup = await getCleanupInfo()

    return {
      timestamp,
      performance: {
        memory: memoryStats,
        hybrid: { geo: hybridGeoStats, api: hybridApiStats, embedding: hybridEmbeddingStats },
        metrics: metricsData
      },
      health,
      operations: {
        cleanup,
        usage
      }
    }
  } catch (error) {
    console.error('[Cache Dashboard] Error gathering data:', error)
    return {
      timestamp,
      performance: { memory: {}, hybrid: {}, metrics: {} },
      health: { issues: [{ layer: 'system', severity: 'error', message: 'Failed to load dashboard data', recommendation: 'Check logs' }], score: 0 },
      operations: { cleanup: { lastRun: null, entriesRemoved: 0 }, usage: { topKeys: [], patterns: [] } }
    }
  }
}

/**
 * Analyze cache health and identify issues
 */
function analyzeHealthIssues(data: any): CacheDashboardData['health'] {
  const issues: Array<{
    layer: string
    severity: 'warning' | 'error'
    message: string
    recommendation: string
  }> = []

  // Memory cache analysis
  for (const [cacheType, stats] of Object.entries(data.memory)) {
    const cacheStats = stats as any
    
    if (cacheStats.hitRate < 0.6) {
      issues.push({
        layer: `memory-${cacheType}`,
        severity: 'warning',
        message: `Low hit rate: ${(cacheStats.hitRate * 100).toFixed(1)}%`,
        recommendation: 'Consider increasing cache size or TTL values'
      })
    }

    if (cacheStats.memoryUsageMB > 80) {
      issues.push({
        layer: `memory-${cacheType}`,
        severity: 'error',
        message: `High memory usage: ${cacheStats.memoryUsageMB.toFixed(1)}MB`,
        recommendation: 'Reduce cache size or increase memory limits'
      })
    }

    if (cacheStats.evictions > 100) {
      issues.push({
        layer: `memory-${cacheType}`,
        severity: 'warning',
        message: `High eviction count: ${cacheStats.evictions}`,
        recommendation: 'Cache is too small for workload - consider increasing maxSize'
      })
    }
  }

  // Hybrid cache analysis
  for (const [cacheType, hybridStats] of Object.entries(data.hybrid)) {
    const stats = hybridStats as any
    
    if (stats.combined?.hit_rate < 0.7) {
      issues.push({
        layer: `hybrid-${cacheType}`,
        severity: 'warning',
        message: `Combined hit rate below 70%`,
        recommendation: 'Check if Supabase cache persistence is working properly'
      })
    }

    if (stats.combined?.layers?.memory_contribution < 0.3) {
      issues.push({
        layer: `hybrid-${cacheType}`,
        severity: 'warning',
        message: `Memory layer not contributing enough (${(stats.combined.layers.memory_contribution * 100).toFixed(1)}%)`,
        recommendation: 'Increase memory cache size or adjust TTL values'
      })
    }
  }

  // Metrics analysis
  const overallMetrics = data.metrics.overall
  if (overallMetrics.hitRate < 0.65) {
    issues.push({
      layer: 'metrics-overall',
      severity: 'error',
      message: `Overall system hit rate too low: ${(overallMetrics.hitRate * 100).toFixed(1)}%`,
      recommendation: 'Review cache strategy and consider increasing cache sizes'
    })
  }

  if (overallMetrics.averageHitTime > 10) {
    issues.push({
      layer: 'metrics-performance',
      severity: 'warning',
      message: `Slow cache access time: ${overallMetrics.averageHitTime.toFixed(2)}ms`,
      recommendation: 'Check for memory pressure or optimize cache structure'
    })
  }

  // Calculate health score (0-100)
  const errorCount = issues.filter(i => i.severity === 'error').length
  const warningCount = issues.filter(i => i.severity === 'warning').length
  const score = Math.max(0, 100 - (errorCount * 20) - (warningCount * 10))

  return { issues, score }
}

/**
 * Get usage patterns from metrics
 */
async function getUsagePatterns(): Promise<CacheDashboardData['operations']['usage']> {
  try {
    const insights = cacheMetrics.getPerformanceInsights()
    
    const topKeys = [
      ...insights.hottestKeys.map(k => ({ key: k.key, hits: k.hitCount, layer: 'memory' })),
      ...insights.slowestKeys.map(k => ({ key: k.key, hits: k.hitCount, layer: 'memory-slow' }))
    ].slice(0, 10)

    // Analyze patterns in cache keys
    const patterns: Array<{ pattern: string, frequency: number }> = []
    const patternCounts = new Map<string, number>()

    for (const key of topKeys) {
      // Extract patterns like "geo:*", "api:*", "embed:*"
      const pattern = key.key.split(':')[0] + ':*'
      patternCounts.set(pattern, (patternCounts.get(pattern) || 0) + 1)
    }

    for (const [pattern, frequency] of patternCounts.entries()) {
      patterns.push({ pattern, frequency })
    }

    patterns.sort((a, b) => b.frequency - a.frequency)

    return { topKeys, patterns: patterns.slice(0, 5) }
  } catch (error) {
    console.error('[Cache Dashboard] Error getting usage patterns:', error)
    return { topKeys: [], patterns: [] }
  }
}

/**
 * Get cleanup operation info
 */
async function getCleanupInfo(): Promise<CacheDashboardData['operations']['cleanup']> {
  try {
    // For now, return mock data - in production this would track actual cleanup runs
    return {
      lastRun: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 minutes ago
      entriesRemoved: 0
    }
  } catch (error) {
    console.error('[Cache Dashboard] Error getting cleanup info:', error)
    return { lastRun: null, entriesRemoved: 0 }
  }
}

/**
 * Perform manual cache cleanup across all layers
 */
export async function performCacheCleanup(): Promise<{
  success: boolean
  entriesRemoved: number
  layers: Record<string, number>
  error?: string
}> {
  try {
    console.log('[Cache Dashboard] Starting manual cleanup...')

    const results = await Promise.allSettled([
      hybridGeoCache.cleanup(),
      hybridApiCache.cleanup(), 
      hybridEmbeddingCache.cleanup(),
      cleanupSupabaseCache()
    ])

    let totalRemoved = 0
    const layers: Record<string, number> = {
      'hybrid-geo': 0,
      'hybrid-api': 0,
      'hybrid-embedding': 0,
      'supabase': 0
    }

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const removed = result.value || 0
        totalRemoved += removed
        
        const layerNames = ['hybrid-geo', 'hybrid-api', 'hybrid-embedding', 'supabase']
        layers[layerNames[index]] = removed
      } else {
        console.error(`[Cache Dashboard] Cleanup failed for layer ${index}:`, result.reason)
      }
    })

    console.log(`[Cache Dashboard] Cleanup completed. Removed ${totalRemoved} entries.`)

    return {
      success: true,
      entriesRemoved: totalRemoved,
      layers
    }
  } catch (error) {
    console.error('[Cache Dashboard] Cleanup failed:', error)
    return {
      success: false,
      entriesRemoved: 0,
      layers: {},
      error: error.message
    }
  }
}

/**
 * Cleanup Supabase cache tables directly
 */
async function cleanupSupabaseCache(): Promise<number> {
  try {
    const supabase = await getReadOnlyClient()
    const { data, error } = await supabase.rpc('cleanup_expired_cache')

    if (error) {
      console.error('[Cache Dashboard] Supabase cleanup error:', error)
      return 0
    }

    return data || 0
  } catch (error) {
    console.error('[Cache Dashboard] Supabase cleanup failed:', error)
    return 0
  }
}

/**
 * Invalidate cache by pattern across all layers
 */
export async function invalidateCachePattern(pattern: string): Promise<{
  success: boolean
  entriesInvalidated: number
  layers: Record<string, number>
  error?: string
}> {
  try {
    console.log(`[Cache Dashboard] Invalidating pattern: ${pattern}`)

    const results = await Promise.allSettled([
      hybridGeoCache.invalidate(pattern),
      hybridApiCache.invalidate(pattern),
      hybridEmbeddingCache.invalidate(pattern)
    ])

    let totalInvalidated = 0
    const layers: Record<string, number> = {
      'hybrid-geo': 0,
      'hybrid-api': 0,
      'hybrid-embedding': 0
    }

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const invalidated = result.value || 0
        totalInvalidated += invalidated
        
        const layerNames = ['hybrid-geo', 'hybrid-api', 'hybrid-embedding']
        layers[layerNames[index]] = invalidated
      }
    })

    console.log(`[Cache Dashboard] Invalidated ${totalInvalidated} entries matching "${pattern}"`)

    return {
      success: true,
      entriesInvalidated: totalInvalidated,
      layers
    }
  } catch (error) {
    console.error('[Cache Dashboard] Invalidation failed:', error)
    return {
      success: false,
      entriesInvalidated: 0,
      layers: {},
      error: error.message
    }
  }
}

/**
 * Get cache layer health status
 */
export function getCacheHealthStatus(healthScore: number): {
  status: 'excellent' | 'good' | 'warning' | 'critical'
  color: string
  message: string
} {
  if (healthScore >= 90) {
    return { status: 'excellent', color: 'green', message: 'Cache performance is excellent' }
  } else if (healthScore >= 75) {
    return { status: 'good', color: 'blue', message: 'Cache performance is good' }
  } else if (healthScore >= 50) {
    return { status: 'warning', color: 'yellow', message: 'Cache performance needs attention' }
  } else {
    return { status: 'critical', color: 'red', message: 'Cache performance is critical' }
  }
}