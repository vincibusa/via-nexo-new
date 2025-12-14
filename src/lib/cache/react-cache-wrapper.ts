/**
 * React Cache Wrapper  
 * PERFORMANCE: cache() wrapper per deduplicate requests nei React components
 */

import { cache } from 'react'
import { hybridApiCache } from './supabase-cache-manager'
import { cacheMetrics } from './cache-metrics'

interface ReactCacheOptions {
  enableHybridFallback?: boolean
  hybridTtl?: number
  tags?: string[]
}

/**
 * Enhanced React cache con hybrid fallback
 */
export function createCachedFunction<Args extends any[], Return>(
  fn: (...args: Args) => Promise<Return>,
  cacheKey: string,
  options: ReactCacheOptions = {}
) {
  const {
    enableHybridFallback = true,
    hybridTtl = 5 * 60 * 1000, // 5 minutes default
    tags = []
  } = options

  // Create React cached version with enhanced error handling
  const reactCached = cache(async (...args: Args): Promise<Return> => {
    const startTime = performance.now()
    const requestKey = `${cacheKey}:${JSON.stringify(args)}`

    try {
      const result = await fn(...args)
      
      // Record success metrics
      const duration = performance.now() - startTime
      cacheMetrics.recordHit(requestKey, 'react-cache', duration)
      
      // Store in hybrid cache as backup if enabled
      if (enableHybridFallback) {
        await hybridApiCache.set(requestKey, result, {
          ttl: hybridTtl,
          tags: ['react-cache', ...tags],
          metadata: {
            endpoint_path: cacheKey,
            query_params: { args },
            content_type: 'application/json'
          }
        }).catch(err => 
          console.warn(`[React Cache] Failed to store hybrid backup for ${cacheKey}:`, err)
        )
      }
      
      return result
    } catch (error) {
      // Record error and try hybrid fallback
      const duration = performance.now() - startTime
      cacheMetrics.recordMiss(requestKey, 'react-cache', 'error')
      
      if (enableHybridFallback) {
        try {
          const hybridResult = await hybridApiCache.get(requestKey)
          if (hybridResult) {
            console.log(`[React Cache] Using hybrid fallback for failed React cache: ${cacheKey}`)
            cacheMetrics.recordHit(requestKey, 'react-hybrid-fallback', duration)
            return hybridResult
          }
        } catch (hybridError) {
          console.warn(`[React Cache] Hybrid fallback also failed for ${cacheKey}:`, hybridError)
        }
      }
      
      throw error
    }
  })

  return reactCached
}

/**
 * Cached place metadata fetcher per components
 */
export const getCachedPlaceMetadata = createCachedFunction(
  async (placeId: string) => {
    const { getReadOnlyClient } = await import('@/lib/supabase/connection-pool')
    const supabase = await getReadOnlyClient()
    
    const { data, error } = await supabase
      .from('places')
      .select(`
        id,
        name,
        description,
        address,
        city,
        place_type,
        price_range,
        ambience_tags,
        music_genre,
        verification_status,
        opening_hours,
        lat,
        lon
      `)
      .eq('id', placeId)
      .single()
    
    if (error) throw error
    return data
  },
  'place-metadata',
  {
    hybridTtl: 10 * 60 * 1000, // 10 minutes - place data doesn't change often
    tags: ['places', 'metadata']
  }
)

/**
 * Cached user profile data per components
 */
export const getCachedUserProfile = createCachedFunction(
  async (userId: string) => {
    const { getReadOnlyClient } = await import('@/lib/supabase/connection-pool')
    const supabase = await getReadOnlyClient()
    
    const { data, error } = await supabase
      .from('users')
      .select(`
        id,
        username,
        full_name,
        avatar_url,
        bio,
        location,
        privacy_settings,
        created_at
      `)
      .eq('id', userId)
      .single()
    
    if (error) throw error
    return data
  },
  'user-profile',
  {
    hybridTtl: 3 * 60 * 1000, // 3 minutes - user data changes more frequently
    tags: ['users', 'profiles']
  }
)

/**
 * Cached event details con relationships
 */
export const getCachedEventMetadata = createCachedFunction(
  async (eventId: string) => {
    const { getReadOnlyClient } = await import('@/lib/supabase/connection-pool')
    const supabase = await getReadOnlyClient()
    
    const { data, error } = await supabase
      .from('events')
      .select(`
        id,
        title,
        description,
        event_type,
        start_datetime,
        end_datetime,
        genre,
        lineup,
        ticket_price_min,
        ticket_price_max,
        ticket_url,
        is_free,
        place:places!events_place_id_fkey(
          id,
          name,
          address,
          city,
          lat,
          lon
        )
      `)
      .eq('id', eventId)
      .single()
    
    if (error) throw error
    return data
  },
  'event-metadata',
  {
    hybridTtl: 2 * 60 * 1000, // 2 minutes - events can change frequently
    tags: ['events', 'metadata']
  }
)

/**
 * Cached followers count per user
 */
export const getCachedFollowersCount = createCachedFunction(
  async (userId: string) => {
    const { getReadOnlyClient } = await import('@/lib/supabase/connection-pool')
    const supabase = await getReadOnlyClient()
    
    const { count, error } = await supabase
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('following_id', userId)
    
    if (error) throw error
    return count || 0
  },
  'followers-count',
  {
    hybridTtl: 30 * 1000, // 30 seconds - social data changes frequently
    tags: ['social', 'counts']
  }
)

/**
 * Cached following count per user
 */
export const getCachedFollowingCount = createCachedFunction(
  async (userId: string) => {
    const { getReadOnlyClient } = await import('@/lib/supabase/connection-pool')
    const supabase = await getReadOnlyClient()
    
    const { count, error } = await supabase
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('follower_id', userId)
    
    if (error) throw error
    return count || 0
  },
  'following-count',
  {
    hybridTtl: 30 * 1000, // 30 seconds
    tags: ['social', 'counts']
  }
)

/**
 * Cached user preferences
 */
export const getCachedUserPreferences = createCachedFunction(
  async (userId: string) => {
    const { getReadOnlyClient } = await import('@/lib/supabase/connection-pool')
    const supabase = await getReadOnlyClient()
    
    const { data, error } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId)
      .single()
    
    if (error && error.code !== 'PGRST116') throw error // ignore "not found"
    
    return data || {
      user_id: userId,
      companionship: null,
      mood: null,
      budget: null,
      time_preference: null,
      music_genres: [],
      place_types: [],
      allow_messages_from: 'everyone',
      notification_settings: {}
    }
  },
  'user-preferences',
  {
    hybridTtl: 5 * 60 * 1000, // 5 minutes
    tags: ['users', 'preferences']
  }
)

/**
 * Cached place suggestions count (per popolarità)
 */
export const getCachedPlaceSuggestionsCount = createCachedFunction(
  async (placeId: string) => {
    const { getReadOnlyClient } = await import('@/lib/supabase/connection-pool')
    const supabase = await getReadOnlyClient()
    
    const { data, error } = await supabase
      .from('places')
      .select('suggestions_count')
      .eq('id', placeId)
      .single()
    
    if (error) throw error
    return data.suggestions_count || 0
  },
  'place-suggestions-count',
  {
    hybridTtl: 60 * 1000, // 1 minute - popularity changes
    tags: ['places', 'stats']
  }
)

/**
 * Batch loader per multiple places (evita N+1 queries)
 */
export const getCachedPlacesBatch = createCachedFunction(
  async (placeIds: string[]) => {
    const { getBatchClient } = await import('@/lib/supabase/connection-pool')
    const supabase = await getBatchClient()
    
    const { data, error } = await supabase
      .from('places')
      .select(`
        id,
        name,
        description,
        address,
        city,
        place_type,
        price_range,
        verification_status,
        lat,
        lon,
        suggestions_count
      `)
      .in('id', placeIds)
    
    if (error) throw error
    
    // Convert to map for easy access
    const placesMap = new Map()
    data.forEach(place => placesMap.set(place.id, place))
    
    return placesMap
  },
  'places-batch',
  {
    hybridTtl: 5 * 60 * 1000, // 5 minutes
    tags: ['places', 'batch']
  }
)

/**
 * Utility per invalidare React cache e hybrid fallback
 */
export async function invalidateReactCache(tags: string[]): Promise<void> {
  try {
    // Clear hybrid cache by tags
    await Promise.all(
      tags.map(tag => hybridApiCache.invalidate(`*${tag}*`))
    )
    
    console.log(`[React Cache] Invalidated hybrid cache for tags: ${tags.join(', ')}`)
    
    // Note: React cache() cannot be manually invalidated, it only clears between requests
    // But hybrid fallback will be invalidated
  } catch (error) {
    console.error('[React Cache] Failed to invalidate:', error)
  }
}

/**
 * Component-level cache statistics
 */
export function getReactCacheStats(): {
  totalHits: number
  totalMisses: number
  fallbackUsage: number
  averageResponseTime: number
} {
  const metrics = cacheMetrics.getCurrentMetrics()
  
  let totalHits = 0
  let totalMisses = 0
  let fallbackUsage = 0
  const totalResponseTime = 0
  
  for (const [cacheType, stats] of Object.entries(metrics.byType)) {
    if (cacheType.includes('react-cache')) {
      totalHits += (stats as any).hits || 0
      totalMisses += (stats as any).misses || 0
    }
    if (cacheType.includes('react-hybrid-fallback')) {
      fallbackUsage += (stats as any).hits || 0
    }
  }
  
  const averageResponseTime = metrics.overall.averageHitTime
  
  return {
    totalHits,
    totalMisses,
    fallbackUsage,
    averageResponseTime
  }
}

/**
 * Preload data per SSR/SSG optimization
 */
export async function preloadComponentData(keys: Array<{
  type: 'place' | 'user' | 'event' | 'preferences'
  id: string
}>): Promise<void> {
  const preloadPromises = keys.map(async ({ type, id }) => {
    try {
      switch (type) {
        case 'place':
          await getCachedPlaceMetadata(id)
          break
        case 'user':
          await getCachedUserProfile(id)
          break
        case 'event':
          await getCachedEventMetadata(id)
          break
        case 'preferences':
          await getCachedUserPreferences(id)
          break
      }
    } catch (error) {
      console.warn(`[React Cache] Preload failed for ${type}:${id}:`, error)
    }
  })
  
  await Promise.allSettled(preloadPromises)
  console.log(`[React Cache] Preloaded ${keys.length} component data entries`)
}