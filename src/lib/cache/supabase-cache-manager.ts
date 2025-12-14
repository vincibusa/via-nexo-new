/**
 * Supabase Cache Manager
 * PERFORMANCE: Integrazione cache in-memory con persistenza Supabase
 */

import { getReadOnlyClient, getBatchClient } from '@/lib/supabase/connection-pool'
import { EnhancedCacheManager } from './enhanced-cache-manager'
import { cacheMetrics } from './cache-metrics'

interface SupabaseCacheEntry {
  id: string
  cache_key: string
  data: any
  created_at: string
  expires_at: string
  hit_count: number
  last_accessed: string
}

interface GeoCacheEntry extends SupabaseCacheEntry {
  lat: number
  lon: number
  radius_km: number
  result_type: 'places' | 'events'
  result_ids: string[]
}

interface ApiCacheEntry extends SupabaseCacheEntry {
  endpoint_path: string
  query_params: any
  response_data: any
  content_type: string
  size_bytes: number
  tags: string[]
}

interface EmbeddingCacheEntry extends SupabaseCacheEntry {
  query_text: string
  query_hash: string
  embedding_vector: number[]
  model_name: string
}

/**
 * Cache ibrido: combina cache in-memory (veloce) con Supabase (persistente)
 */
export class SupabaseCacheManager<T = any> {
  private memoryCache: EnhancedCacheManager<T>
  private tableName: string
  private cacheType: string

  constructor(
    tableName: 'geo_cache' | 'api_response_cache' | 'embedding_vectors_cache',
    memoryCache: EnhancedCacheManager<T>
  ) {
    this.tableName = tableName
    this.memoryCache = memoryCache
    this.cacheType = tableName.replace('_cache', '')
  }

  /**
   * Get with fallback: memory -> Supabase -> null
   */
  async get(key: string): Promise<T | null> {
    const startTime = performance.now()

    // 1. Try memory cache first (fastest)
    const memoryResult = this.memoryCache.get(key)
    if (memoryResult) {
      const accessTime = performance.now() - startTime
      cacheMetrics.recordHit(key, this.cacheType + '-memory', accessTime)
      return memoryResult
    }

    // 2. Try Supabase cache (persistent fallback)
    try {
      const supabase = await getReadOnlyClient()
      const { data, error } = await supabase
        .from(this.tableName)
        .select('*')
        .eq('cache_key', key)
        .gt('expires_at', new Date().toISOString())
        .single()

      if (error || !data) {
        cacheMetrics.recordMiss(key, this.cacheType, 'not_found')
        return null
      }

      // Extract data based on table type
      let result: T
      if (this.tableName === 'geo_cache') {
        result = (data as GeoCacheEntry).result_ids as T
      } else if (this.tableName === 'api_response_cache') {
        result = (data as ApiCacheEntry).response_data as T
      } else {
        result = (data as EmbeddingCacheEntry).embedding_vector as T
      }

      // Update hit count and last accessed in Supabase
      this.updateHitCount(data.id, data.hit_count + 1).catch(err => 
        console.warn(`[Supabase Cache] Failed to update hit count:`, err)
      )

      // Populate memory cache for next time (async)
      const ttl = new Date(data.expires_at).getTime() - Date.now()
      if (ttl > 0) {
        this.memoryCache.set(key, result, { ttl, tags: ['supabase-sync'] })
      }

      const accessTime = performance.now() - startTime
      cacheMetrics.recordHit(key, this.cacheType + '-supabase', accessTime)
      
      console.log(`[Supabase Cache] HIT for ${key} from ${this.tableName}`)
      return result
    } catch (error) {
      console.error(`[Supabase Cache] Error getting ${key}:`, error)
      cacheMetrics.recordMiss(key, this.cacheType, 'not_found')
      return null
    }
  }

  /**
   * Set in both memory and Supabase
   */
  async set(key: string, data: T, options: {
    ttl?: number
    tags?: string[]
    metadata?: any
  } = {}): Promise<void> {
    const startTime = performance.now()
    const ttl = options.ttl || 10 * 60 * 1000 // 10 minutes default
    const expiresAt = new Date(Date.now() + ttl)

    try {
      // 1. Set in memory cache immediately
      this.memoryCache.set(key, data, { ttl, tags: options.tags })

      // 2. Set in Supabase (async, fire-and-forget)
      this.setInSupabase(key, data, expiresAt, options).catch(err =>
        console.warn(`[Supabase Cache] Failed to persist ${key}:`, err)
      )

      const setTime = performance.now() - startTime
      console.log(`[Supabase Cache] SET ${key} in ${setTime.toFixed(2)}ms`)
    } catch (error) {
      console.error(`[Supabase Cache] Error setting ${key}:`, error)
    }
  }

  /**
   * Invalidate by pattern in both memory and Supabase
   */
  async invalidate(pattern: string | string[]): Promise<number> {
    let deletedCount = 0

    try {
      const patterns = Array.isArray(pattern) ? pattern : [pattern]
      
      // 1. Invalidate from memory cache
      for (const p of patterns) {
        this.memoryCache.clear(new RegExp(p))
      }

      // 2. Invalidate from Supabase
      const supabase = await getBatchClient()
      for (const p of patterns) {
        const { data, error } = await supabase
          .from(this.tableName)
          .delete()
          .ilike('cache_key', `%${p}%`)

        if (!error && data) {
          deletedCount += data.length
        }
      }

      console.log(`[Supabase Cache] Invalidated ${deletedCount} entries matching patterns: ${patterns.join(', ')}`)
      return deletedCount
    } catch (error) {
      console.error(`[Supabase Cache] Error invalidating pattern:`, error)
      return 0
    }
  }

  /**
   * Cleanup expired entries (housekeeping)
   */
  async cleanup(): Promise<number> {
    try {
      const supabase = await getBatchClient()
      const { data, error } = await supabase
        .from(this.tableName)
        .delete()
        .lt('expires_at', new Date().toISOString())

      if (error) {
        console.error(`[Supabase Cache] Cleanup error:`, error)
        return 0
      }

      const deletedCount = data?.length || 0
      console.log(`[Supabase Cache] Cleanup removed ${deletedCount} expired entries from ${this.tableName}`)
      return deletedCount
    } catch (error) {
      console.error(`[Supabase Cache] Cleanup failed:`, error)
      return 0
    }
  }

  /**
   * Get cache statistics from both layers
   */
  async getStats(): Promise<{
    memory: any
    supabase: any
    combined: any
  }> {
    const memoryStats = this.memoryCache.getStats()

    try {
      const supabase = await getReadOnlyClient()
      const { data } = await supabase.rpc('get_cache_stats')

      const supabaseStats = data?.[this.cacheType + '_cache'] || {
        total_entries: 0,
        expired_entries: 0,
        total_hits: 0
      }

      return {
        memory: memoryStats,
        supabase: supabaseStats,
        combined: {
          total_hits: memoryStats.hits + (supabaseStats.total_hits || 0),
          total_entries: memoryStats.size + (supabaseStats.total_entries || 0),
          hit_rate: memoryStats.hitRate,
          layers: {
            memory_contribution: memoryStats.hits / (memoryStats.hits + (supabaseStats.total_hits || 0)),
            supabase_contribution: (supabaseStats.total_hits || 0) / (memoryStats.hits + (supabaseStats.total_hits || 0))
          }
        }
      }
    } catch (error) {
      console.error(`[Supabase Cache] Stats error:`, error)
      return {
        memory: memoryStats,
        supabase: { error: error.message },
        combined: { error: 'Failed to get combined stats' }
      }
    }
  }

  // Private methods

  private async setInSupabase(
    key: string, 
    data: T, 
    expiresAt: Date, 
    options: any
  ): Promise<void> {
    const supabase = await getBatchClient()
    
    let insertData: any = {
      cache_key: key,
      created_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
      hit_count: 0,
      last_accessed: new Date().toISOString()
    }

    // Table-specific data
    if (this.tableName === 'geo_cache' && options.metadata) {
      insertData = {
        ...insertData,
        lat: options.metadata.lat,
        lon: options.metadata.lon,
        radius_km: options.metadata.radius_km,
        result_type: options.metadata.result_type,
        result_ids: data as string[]
      }
    } else if (this.tableName === 'api_response_cache') {
      insertData = {
        ...insertData,
        endpoint_path: options.metadata?.endpoint_path || '/unknown',
        query_params: options.metadata?.query_params || {},
        response_data: data,
        content_type: options.metadata?.content_type || 'application/json',
        size_bytes: JSON.stringify(data).length,
        tags: options.tags || []
      }
    } else if (this.tableName === 'embedding_vectors_cache' && options.metadata) {
      insertData = {
        ...insertData,
        query_text: options.metadata.query_text,
        query_hash: options.metadata.query_hash,
        embedding_vector: data as number[],
        model_name: options.metadata.model_name || 'text-embedding-ada-002'
      }
    }

    // Upsert (insert or update)
    const { error } = await supabase
      .from(this.tableName)
      .upsert(insertData, { onConflict: 'cache_key' })

    if (error) {
      throw new Error(`Failed to persist to ${this.tableName}: ${error.message}`)
    }
  }

  private async updateHitCount(id: string, newHitCount: number): Promise<void> {
    const supabase = await getBatchClient()
    await supabase
      .from(this.tableName)
      .update({ 
        hit_count: newHitCount,
        last_accessed: new Date().toISOString()
      })
      .eq('id', id)
  }
}

/**
 * Factory per creare cache ibridi specifici
 */
export function createGeoCacheManager(memoryCache: EnhancedCacheManager<string[]>) {
  return new SupabaseCacheManager('geo_cache', memoryCache)
}

export function createApiCacheManager(memoryCache: EnhancedCacheManager<any>) {
  return new SupabaseCacheManager('api_response_cache', memoryCache)
}

export function createEmbeddingCacheManager(memoryCache: EnhancedCacheManager<number[]>) {
  return new SupabaseCacheManager('embedding_vectors_cache', memoryCache)
}

// Export global hybrid cache instances
export const hybridGeoCache = createGeoCacheManager(
  new EnhancedCacheManager({
    maxSize: 500,
    defaultTTL: 10 * 60 * 1000, // 10 minutes
    maxMemoryMB: 25
  })
)

export const hybridApiCache = createApiCacheManager(
  new EnhancedCacheManager({
    maxSize: 1000,
    defaultTTL: 5 * 60 * 1000, // 5 minutes  
    maxMemoryMB: 20
  })
)

export const hybridEmbeddingCache = createEmbeddingCacheManager(
  new EnhancedCacheManager({
    maxSize: 200,
    defaultTTL: 60 * 60 * 1000, // 1 hour
    maxMemoryMB: 30
  })
)