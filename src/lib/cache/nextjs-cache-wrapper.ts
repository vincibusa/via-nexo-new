/**
 * Next.js Native Cache Wrapper
 * PERFORMANCE: Integrazione unstable_cache con sistema cache ibrido
 */

import { unstable_cache } from 'next/cache'
import { hybridApiCache } from './supabase-cache-manager'
import { cacheMetrics } from './cache-metrics'

interface CacheableOptions {
  tags?: string[]
  revalidate?: number | false
  keyPrefix?: string
  enableHybrid?: boolean
  fallbackToHybrid?: boolean
}

/**
 * Enhanced wrapper per unstable_cache con fallback ibrido
 */
export function cacheableFunction<Args extends any[], Return>(
  fn: (...args: Args) => Promise<Return>,
  keyParts: string[],
  options: CacheableOptions = {}
) {
  const {
    tags = [],
    revalidate = 300, // 5 minutes default
    keyPrefix = 'nextjs',
    enableHybrid = true,
    fallbackToHybrid = true
  } = options

  // Create Next.js cached version
  const nextjsCached = unstable_cache(
    async (...args: Args) => {
      const startTime = performance.now()
      
      try {
        const result = await fn(...args)
        
        // Record success metrics
        const duration = performance.now() - startTime
        cacheMetrics.recordHit(`${keyPrefix}:${keyParts.join(':')}`, 'nextjs-cache', duration)
        
        // Store in hybrid cache as backup if enabled
        if (enableHybrid) {
          const hybridKey = `${keyPrefix}:${keyParts.join(':')}:${JSON.stringify(args)}`
          await hybridApiCache.set(hybridKey, result, {
            ttl: typeof revalidate === 'number' ? revalidate * 1000 : 60 * 60 * 1000,
            tags,
            metadata: {
              endpoint_path: keyParts.join('/'),
              query_params: args.length > 0 ? { args } : {},
              content_type: 'application/json'
            }
          }).catch(err => 
            console.warn('[NextJS Cache] Failed to store hybrid backup:', err)
          )
        }
        
        return result
      } catch (error) {
        // Record error metrics
        const duration = performance.now() - startTime
        cacheMetrics.recordMiss(`${keyPrefix}:${keyParts.join(':')}`, 'nextjs-cache', 'error')
        
        // Try hybrid cache fallback if enabled
        if (fallbackToHybrid) {
          const hybridKey = `${keyPrefix}:${keyParts.join(':')}:${JSON.stringify(args)}`
          const hybridResult = await hybridApiCache.get(hybridKey)
          
          if (hybridResult) {
            console.log('[NextJS Cache] Using hybrid fallback for failed Next.js cache')
            cacheMetrics.recordHit(hybridKey, 'nextjs-hybrid-fallback', duration)
            return hybridResult
          }
        }
        
        throw error
      }
    },
    keyParts,
    {
      tags,
      revalidate
    }
  )

  return nextjsCached
}

/**
 * Wrapper specifico per API routes
 */
export function cacheableApiRoute<T>(
  routeHandler: () => Promise<T>,
  route: string,
  options: CacheableOptions = {}
) {
  const keyParts = ['api', ...route.split('/').filter(Boolean)]
  
  return cacheableFunction(
    routeHandler,
    keyParts,
    {
      keyPrefix: 'api',
      tags: [`api:${route}`, ...(options.tags || [])],
      ...options
    }
  )
}

/**
 * Wrapper per data fetching functions
 */
export function cacheableQuery<Args extends any[], Return>(
  queryFn: (...args: Args) => Promise<Return>,
  queryName: string,
  options: CacheableOptions = {}
) {
  return cacheableFunction(
    queryFn,
    ['query', queryName],
    {
      keyPrefix: 'query',
      tags: [`query:${queryName}`, ...(options.tags || [])],
      ...options
    }
  )
}

/**
 * Cache per place metadata fetching
 */
export const getCachedPlaceDetails = cacheableQuery(
  async (placeId: string) => {
    const { getReadOnlyClient } = await import('@/lib/supabase/connection-pool')
    const supabase = await getReadOnlyClient()
    
    const { data, error } = await supabase
      .from('places')
      .select('*')
      .eq('id', placeId)
      .single()
    
    if (error) throw error
    return data
  },
  'place-details',
  {
    revalidate: 600, // 10 minutes - place data changes rarely
    tags: ['places', 'metadata']
  }
)

/**
 * Cache per user preferences
 */
export const getCachedUserPreferences = cacheableQuery(
  async (userId: string) => {
    const { getReadOnlyClient } = await import('@/lib/supabase/connection-pool')
    const supabase = await getReadOnlyClient()
    
    const { data, error } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId)
      .single()
    
    if (error) throw error
    return data
  },
  'user-preferences',
  {
    revalidate: 300, // 5 minutes
    tags: ['users', 'preferences']
  }
)

/**
 * Cache per event details con join
 */
export const getCachedEventDetails = cacheableQuery(
  async (eventId: string) => {
    const { getReadOnlyClient } = await import('@/lib/supabase/connection-pool')
    const supabase = await getReadOnlyClient()
    
    const { data, error } = await supabase
      .from('events')
      .select(`
        *,
        place:places!events_place_id_fkey(
          id, name, address, city, lat, lon
        )
      `)
      .eq('id', eventId)
      .single()
    
    if (error) throw error
    return data
  },
  'event-details',
  {
    revalidate: 180, // 3 minutes - events change more frequently
    tags: ['events', 'metadata']
  }
)

/**
 * Utility per invalidare cache per tag
 */
export async function invalidateNextjsCacheByTag(tag: string): Promise<void> {
  try {
    const { revalidateTag } = await import('next/cache')
    revalidateTag(tag)
    
    // Also invalidate hybrid cache
    await hybridApiCache.invalidate(`*:${tag}:*`)
    
    console.log(`[NextJS Cache] Invalidated cache for tag: ${tag}`)
  } catch (error) {
    console.error('[NextJS Cache] Failed to invalidate by tag:', error)
  }
}

/**
 * Utility per invalidare cache per path
 */
export async function invalidateNextjsCacheByPath(path: string): Promise<void> {
  try {
    const { revalidatePath } = await import('next/cache')
    revalidatePath(path)
    
    // Also invalidate hybrid cache
    await hybridApiCache.invalidate(`api:${path.replace(/\//g, ':')}`)
    
    console.log(`[NextJS Cache] Invalidated cache for path: ${path}`)
  } catch (error) {
    console.error('[NextJS Cache] Failed to invalidate by path:', error)
  }
}

/**
 * Preload cache per componenti
 */
export async function preloadCache(keys: Array<{
  type: 'place' | 'event' | 'user-preferences'
  id: string
}>): Promise<void> {
  const preloadPromises = keys.map(async ({ type, id }) => {
    try {
      switch (type) {
        case 'place':
          await getCachedPlaceDetails(id)
          break
        case 'event':
          await getCachedEventDetails(id)
          break
        case 'user-preferences':
          await getCachedUserPreferences(id)
          break
      }
    } catch (error) {
      console.warn(`[NextJS Cache] Preload failed for ${type}:${id}:`, error)
    }
  })
  
  await Promise.allSettled(preloadPromises)
  console.log(`[NextJS Cache] Preloaded ${keys.length} cache entries`)
}

/**
 * Batch cache warming per zone geografica
 */
export async function warmCacheForZone(lat: number, lon: number, radius: number = 5): Promise<void> {
  try {
    console.log(`[NextJS Cache] Warming cache for zone: ${lat}, ${lon} (radius: ${radius}km)`)
    
    // Get popular places in zone
    const { getReadOnlyClient } = await import('@/lib/supabase/connection-pool')
    const supabase = await getReadOnlyClient()
    
    const { data: places } = await supabase.rpc('places_within_radius', {
      center_lat: lat,
      center_lon: lon,
      radius_meters: radius * 1000
    }).limit(20)
    
    if (places && places.length > 0) {
      // Preload place details
      await preloadCache(
        places.map((p: any) => ({ type: 'place' as const, id: p.id }))
      )
      
      console.log(`[NextJS Cache] Warmed ${places.length} places for zone`)
    }
  } catch (error) {
    console.error('[NextJS Cache] Zone warming failed:', error)
  }
}

/**
 * Cache statistics per Next.js layer
 */
export async function getNextjsCacheStats(): Promise<{
  hybridContribution: number
  fallbackUsage: number
  preloadEfficiency: number
}> {
  try {
    const metrics = cacheMetrics.getCurrentMetrics()
    
    const nextjsHits = Object.values(metrics.byType)
      .filter(type => type.toString().includes('nextjs'))
      .reduce((sum, type: any) => sum + (type.hits || 0), 0)
    
    const hybridFallbacks = Object.values(metrics.byType)
      .filter(type => type.toString().includes('nextjs-hybrid-fallback'))
      .reduce((sum, type: any) => sum + (type.hits || 0), 0)
    
    return {
      hybridContribution: nextjsHits > 0 ? (hybridFallbacks / nextjsHits) * 100 : 0,
      fallbackUsage: hybridFallbacks,
      preloadEfficiency: 0 // TODO: implement preload tracking
    }
  } catch (error) {
    console.error('[NextJS Cache] Stats calculation failed:', error)
    return { hybridContribution: 0, fallbackUsage: 0, preloadEfficiency: 0 }
  }
}