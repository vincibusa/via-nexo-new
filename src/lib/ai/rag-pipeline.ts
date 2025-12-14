import { getBatchClient, getReadOnlyClient } from '@/lib/supabase/connection-pool'
import { generateEmbedding, getCachedResults, cacheResults } from './embedding'
import { hashText } from './chunking'
import { generateObject } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { geoCache, apiCache } from '@/lib/cache/enhanced-cache-manager'
import { geoClusterCache, apiClusterCache } from '@/lib/cache/cluster-memory-manager'
import { cacheMetrics, cacheProfiler } from '@/lib/cache/cache-metrics'
import { hybridGeoCache, hybridApiCache } from '@/lib/cache/supabase-cache-manager'

// ENHANCED: Advanced cache system replacing simple Map
const GEO_CACHE_TTL = 10 * 60 * 1000 // 10 minutes (geo data changes slowly)

/**
 * ENHANCED: Create hierarchical cache key for geo filtering
 * Supports multiple radius levels for better hit rates
 */
function createGeoFilterCacheKey(lat: number, lon: number, radiusKm: number, type: 'places' | 'events'): string {
  // OPTIMIZATION: Hierarchical bucketing for better cache efficiency
  // Round coordinates to appropriate precision based on radius
  const precision = radiusKm > 10 ? 100 : radiusKm > 5 ? 1000 : 10000
  const roundedLat = Math.round(lat * precision) / precision
  const roundedLon = Math.round(lon * precision) / precision
  
  // Smart radius bucketing: 1km, 2km, 5km, 10km, 25km, 50km
  const radiusBuckets = [1, 2, 5, 10, 25, 50]
  const bucketedRadius = radiusBuckets.find(r => r >= radiusKm) || radiusKm
  
  return `${type}:${roundedLat}:${roundedLon}:${bucketedRadius}`
}

/**
 * ENHANCED: Get cached geo filter results with hybrid hierarchy (Memory -> Supabase -> null)
 */
async function getCachedGeoResults(cacheKey: string): Promise<string[] | null> {
  return await cacheProfiler.profile(cacheKey, 'geo', 'get', async () => {
    // Try hybrid cache (memory + Supabase fallback)
    const cached = await hybridGeoCache.get(cacheKey)
    if (cached) {
      console.log(`[Hybrid Geo Cache] HIT for ${cacheKey} (${cached.length} results)`)
      return cached
    }
    
    // LEGACY: Try cluster cache as final fallback
    const clusterCached = await geoClusterCache.get(cacheKey)
    if (clusterCached) {
      console.log(`[Cluster Geo Cache] LEGACY HIT for ${cacheKey} (${clusterCached.length} results)`)
      return clusterCached
    }
    
    cacheMetrics.recordMiss(cacheKey, 'geo', 'not_found')
    return null
  })
}

/**
 * ENHANCED: Store geo filter results in hybrid cache system (Memory + Supabase)
 */
async function setCachedGeoResults(cacheKey: string, results: string[], type: 'places' | 'events', lat?: number, lon?: number, radiusKm?: number): Promise<void> {
  await cacheProfiler.profile(cacheKey, 'geo', 'set', async () => {
    // Extract coordinates from cache key if not provided
    const keyParts = cacheKey.split(':')
    const geoLat = lat ?? parseFloat(keyParts[1])
    const geoLon = lon ?? parseFloat(keyParts[2])
    const geoRadius = radiusKm ?? parseInt(keyParts[3])

    // Store in hybrid cache (memory + Supabase persistence)
    await hybridGeoCache.set(cacheKey, results, {
      ttl: GEO_CACHE_TTL,
      tags: ['geo', type],
      metadata: {
        lat: geoLat,
        lon: geoLon,
        radius_km: geoRadius,
        result_type: type
      }
    })
    
    // LEGACY: Also store in cluster cache for backward compatibility
    await geoClusterCache.set(cacheKey, results, GEO_CACHE_TTL)
    
    console.log(`[Hybrid Cache] Cached ${results.length} ${type} for ${cacheKey} (lat: ${geoLat}, lon: ${geoLon}, radius: ${geoRadius}km)`)
  })
}

/**
 * Context for RAG suggestion
 */
export interface SuggestionContext {
  companionship?: 'alone' | 'partner' | 'friends' | 'family'
  mood?: 'relaxed' | 'energetic' | 'romantic' | 'adventurous' | 'cultural'
  budget?: '€' | '€€' | '€€€' | '€€€€'
  time?: 'morning' | 'afternoon' | 'evening' | 'night'
  location: { lat: number; lon: number }
  radius_km?: number
  preferences?: string[]
  datetime?: string // ISO datetime for event filtering
}

/**
 * Place candidate with metadata
 */
interface PlaceCandidate {
  id: string
  name: string
  description: string | null
  address: string
  city: string
  place_type: string
  price_range: string | null
  ambience_tags: string[] | null
  music_genre: string[] | null
  verification_status: string
  opening_hours: any
  distance_km: number
  suggestions_count: number
}

/**
 * Event candidate with metadata
 */
interface EventCandidate {
  id: string
  title: string
  description: string | null
  event_type: string
  start_datetime: string
  end_datetime: string | null
  genre: string[] | null
  lineup: string[] | null
  ticket_price_min: number | null
  ticket_price_max: number | null
  place: {
    id: string
    name: string
    address: string
    city: string
    lat: number
    lon: number
  }
  distance_km: number
}

/**
 * Suggestion result
 */
export interface Suggestion {
  placeId: string
  reason: string
  matchScore: number
  confidence: 'high' | 'medium' | 'low'
}

/**
 * RAG Pipeline Result
 */
export interface RAGResult {
  suggestions: Suggestion[]
  searchMetadata: {
    totalCandidates: number
    processingTime: number
    cacheUsed: boolean
  }
}

/**
 * Step A: Geo Filter - Find places within radius using PostGIS
 * OPTIMIZED: Uses cache for frequently requested areas
 */
export async function geoFilterPlaces(
  lat: number,
  lon: number,
  radiusKm: number = 5,
  category?: string
): Promise<string[]> {
  // ENHANCED: Smart caching even with category filter
  const cacheKey = createGeoFilterCacheKey(lat, lon, radiusKm, 'places') + (category ? `:${category}` : '')
  
  // Try enhanced cache first
  const cached = await getCachedGeoResults(cacheKey)
  if (cached) {
    return cached
  }

  const supabase = await getReadOnlyClient()

  // Convert radius to meters for PostGIS
  const radiusMeters = radiusKm * 1000

  let query = supabase
    .from('places')
    .select('id')
    .eq('is_published', true)
    .eq('is_listed', true)
    .not('location', 'is', null)

  // Apply category filter if specified
  if (category) {
    query = query.eq('place_type', category)
  }

  // PostGIS distance filter using RPC function
  const { data, error } = await supabase.rpc('places_within_radius', {
    center_lat: lat,
    center_lon: lon,
    radius_meters: radiusMeters,
  })

  if (error) {
    console.error('Error in geo filter:', error)
    return []
  }

  // Return max 100 candidates
  const results = (data || []).slice(0, 100).map((p: any) => p.id)
  
  // ENHANCED: Always cache results for performance
  await setCachedGeoResults(cacheKey, results, 'places', lat, lon, radiusKm)

  return results
}

/**
 * Step B: Build semantic query from context
 */
export function buildSemanticQuery(context: SuggestionContext): string {
  const parts: string[] = []

  if (context.companionship) {
    const companionshipMap = {
      alone: 'da solo',
      partner: 'con il partner',
      friends: 'con gli amici',
      family: 'con la famiglia',
    }
    parts.push(`Cerco un locale per andare ${companionshipMap[context.companionship]}`)
  }

  if (context.mood) {
    const moodMap = {
      relaxed: 'rilassante',
      energetic: 'energico',
      romantic: 'romantico',
      adventurous: 'avventuroso',
      cultural: 'culturale',
    }
    parts.push(`atmosfera ${moodMap[context.mood]}`)
  }

  if (context.budget) {
    parts.push(`budget ${context.budget}`)
  }

  if (context.time) {
    const timeMap = {
      morning: 'mattina',
      afternoon: 'pomeriggio',
      evening: 'sera',
      night: 'notte',
    }
    parts.push(`orario ${timeMap[context.time]}`)
  }

  if (context.preferences && context.preferences.length > 0) {
    parts.push(`preferenze: ${context.preferences.join(', ')}`)
  }

  return parts.join(', ')
}

/**
 * OPTIMIZED: Create cache key for vector search results
 */
function createVectorSearchCacheKey(embeddingHash: string, candidateIds: string[], topK: number): string {
  const idsHash = hashText(candidateIds.sort().join(':'))
  return `vector_search:${embeddingHash}:${idsHash}:${topK}`
}

/**
 * Step C: Vector Search - Find similar places using pgvector
 * OPTIMIZED: Added vector search result caching
 */
export async function vectorSearch(
  queryEmbedding: number[],
  candidateIds: string[],
  topK: number = 12
): Promise<Array<{ placeId: string; similarity: number }>> {
  const supabase = await getReadOnlyClient()

  if (candidateIds.length === 0) {
    return []
  }

  // OPTIMIZED: Cache vector search results using embedding hash
  const embeddingHash = hashText(queryEmbedding.slice(0, 10).join(','))
  const cacheKey = createVectorSearchCacheKey(embeddingHash, candidateIds, topK)

  // Try to get cached vector search results
  const cachedResults = await hybridApiCache.get(cacheKey)
  if (cachedResults) {
    console.log(`[Vector Search Cache] HIT for ${cacheKey}`)
    cacheMetrics.recordHit(cacheKey, 'vector_search', 1)
    return cachedResults
  }

  // pgvector cosine similarity search
  const { data, error } = await supabase.rpc('match_place_embeddings', {
    query_embedding: queryEmbedding,
    candidate_ids: candidateIds,
    match_threshold: 0.3,
    match_count: topK,
  })

  if (error) {
    console.error('[Vector Search] Error:', error)
    cacheMetrics.recordMiss(cacheKey, 'vector_search', 'not_found')
    return []
  }

  const results = (data || []).map((row: any) => ({
    placeId: row.entity_id,
    similarity: row.similarity,
  }))

  console.log(`[Vector Search] Raw results: ${results.length} embeddings`)

  // Group by placeId to see duplicates
  const byPlace = results.reduce((acc: any, r: any) => {
    acc[r.placeId] = (acc[r.placeId] || 0) + 1
    return acc
  }, {})
  console.log(`[Vector Search] Unique places:`, Object.keys(byPlace).length)

  // OPTIMIZED: Cache vector search results (5 minute TTL)
  await hybridApiCache.set(cacheKey, results, {
    ttl: 5 * 60 * 1000,
    tags: ['vector_search', 'places']
  })

  return results
}

/**
 * Step D: Re-Ranking - Apply business rules and boost/penalize scores
 * OPTIMIZED: Enhanced with parallel distance calculations and metadata caching
 */
export async function reRank(
  topKIds: string[],
  context: SuggestionContext
): Promise<Array<{ placeId: string; score: number; metadata: PlaceCandidate }>> {
  if (topKIds.length === 0) {
    return []
  }

  // OPTIMIZED: Use batch client for metadata fetching
  const batchClient = await getBatchClient()
  console.log(`[Re-rank] Fetching metadata for ${topKIds.length} place IDs`)
  const { data: places, error } = await batchClient
    .from('places')
    .select('*')
    .in('id', topKIds)

  if (error || !places) {
    console.error('[Re-rank] Error fetching place metadata:', error)
    return []
  }

  console.log(`[Re-rank] Fetched ${places.length} unique places from DB`)

  // OTTIMIZZAZIONE AGGRESSIVA: Pre-compute distanze e scoring semplificato
  const targetLat = context.location.lat
  const targetLon = context.location.lon
  
  const placesWithScores = places.map((place: any) => {
    let score = 1.0 // Base score

    // FAST: Boost verified places
    if (place.verification_status === 'approved') score += 0.1

    // FAST: Distance calculation semplificato (no Haversine per performance)
    const latDiff = Math.abs(place.lat - targetLat)
    const lonDiff = Math.abs(place.lon - targetLon)
    const approximateDistance = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff) * 111 // Km approssimati

    // FAST: Distance penalty semplificato
    if (approximateDistance > 3) {
      score -= Math.min(0.3, (approximateDistance - 3) * 0.05)
    }

    // FAST: Popularity boost semplificato
    score += Math.min(0.1, place.suggestions_count * 0.01)

    // FAST: Budget match
    if (context.budget && place.price_range === context.budget) {
      score += 0.15
    }

    return {
      placeId: place.id,
      score: Math.max(0, score),
      metadata: {
        id: place.id,
        name: place.name,
        description: place.description,
        address: place.address,
        city: place.city,
        place_type: place.place_type,
        price_range: place.price_range,
        ambience_tags: place.ambience_tags,
        music_genre: place.music_genre,
        verification_status: place.verification_status,
        opening_hours: place.opening_hours,
        distance_km: approximateDistance,
        suggestions_count: place.suggestions_count,
      },
    }
  })

  // Sort by reranked score
  return placesWithScores.sort((a: any, b: any) => b.score - a.score)
}

/**
 * Calculate distance between two coordinates (Haversine formula)
 */
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371 // Earth radius in km
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/**
 * Check if place is open at given time
 */
function isOpenNow(openingHours: any, datetime?: string): boolean {
  if (!openingHours) return false

  const checkDate = datetime ? new Date(datetime) : new Date()
  const dayOfWeek = checkDate.getDay() // 0 = Sunday, 6 = Saturday
  const currentTime = checkDate.toTimeString().slice(0, 5) // HH:MM

  const daySchedule = openingHours[dayOfWeek]
  if (!daySchedule || !daySchedule.open || !daySchedule.close) {
    return false
  }

  return currentTime >= daySchedule.open && currentTime <= daySchedule.close
}

/**
 * Zod schema for LLM output validation
 */
const suggestionSchema = z.object({
  suggestions: z
    .array(
      z.object({
        placeId: z.string().uuid(),
        reason: z.string().max(300),
        matchScore: z.number().min(0).max(2),
        confidence: z.enum(['high', 'medium', 'low']),
      })
    )
    .length(3),
  searchMetadata: z.object({
    totalCandidates: z.number(),
    processingTime: z.number(),
    cacheUsed: z.boolean(),
  }),
})

/**
 * OPTIMIZED: LLM Generation with mixed places and events
 */
export async function generateSuggestionsWithMixedTypes(
  topPlaces: Array<{ placeId: string; score: number; metadata: PlaceCandidate }>,
  topEvents: Array<{ eventId: string; score: number; metadata: EventCandidate }>,
  context: SuggestionContext,
  searchMetadata: { totalCandidates: number; processingTime: number }
): Promise<RAGResult> {
  // Convert to the unified format expected by the existing LLM function
  const unifiedResults = [
    ...topPlaces.map(p => ({ ...p, id: p.placeId, type: 'place' })),
    ...topEvents.map(e => ({ ...e, id: e.eventId, type: 'event' }))
  ]
  
  return generateSuggestionsWithLLM(unifiedResults as any, context, searchMetadata)
}

/**
 * Step E: LLM Generation with Vercel AI SDK
 */
export async function generateSuggestionsWithLLM(
  topN: Array<{ placeId: string; score: number; metadata: PlaceCandidate }>,
  context: SuggestionContext,
  searchMetadata: { totalCandidates: number; processingTime: number }
): Promise<RAGResult> {
  // Load system prompt
  const systemPromptPath = path.join(
    process.cwd(),
    'src/lib/ai/prompts/system-rag.txt'
  )
  const systemPrompt = fs.readFileSync(systemPromptPath, 'utf-8')

  // Build user prompt with context and metadata
  const userPrompt = `
CONTESTO UTENTE:
${buildSemanticQuery(context)}

LOCALI DISPONIBILI (ordinati per rilevanza):
${topN
  .map(
    (item, idx) => `
${idx + 1}. ${item.metadata.name} (ID: ${item.placeId})
   - Tipo: ${item.metadata.place_type}
   - Descrizione: ${item.metadata.description || 'N/A'}
   - Indirizzo: ${item.metadata.address}, ${item.metadata.city}
   - Distanza: ${item.metadata.distance_km.toFixed(1)} km
   - Fascia prezzo: ${item.metadata.price_range || 'N/A'}
   - Atmosfera: ${item.metadata.ambience_tags?.join(', ') || 'N/A'}
   - Generi musicali: ${item.metadata.music_genre?.join(', ') || 'N/A'}
   - Verificato: ${item.metadata.verification_status === 'approved' ? 'Sì' : 'No'}
   - Popolarità: ${item.metadata.suggestions_count} suggerimenti
   - Match Score: ${item.score.toFixed(2)}
`
  )
  .join('\n')}

Seleziona ESATTAMENTE 3 locali dalla lista sopra che meglio corrispondono al contesto dell'utente.
`

  try {
    const { object } = await generateObject({
      model: openai('gpt-4.1-mini'), // FIX: No reasoning tokens per velocità massima
      schema: suggestionSchema,
      system: systemPrompt,
      prompt: userPrompt,
    })

    // Validate that all placeIds exist in topN
    const validPlaceIds = new Set(topN.map((item) => item.placeId))
    const validSuggestions = object.suggestions.filter((s) =>
      validPlaceIds.has(s.placeId)
    )

    if (validSuggestions.length < 3) {
      // Fallback: use top 3 from re-ranking
      return {
        suggestions: topN.slice(0, 3).map((item, idx) => ({
          placeId: item.placeId,
          reason: `Match score: ${item.score.toFixed(2)}`,
          matchScore: item.score,
          confidence: idx === 0 ? 'high' : idx === 1 ? 'medium' : ('low' as const),
        })),
        searchMetadata: {
          totalCandidates: searchMetadata.totalCandidates,
          processingTime: searchMetadata.processingTime,
          cacheUsed: false,
        },
      }
    }

    return {
      suggestions: validSuggestions,
      searchMetadata: {
        totalCandidates: searchMetadata.totalCandidates,
        processingTime: searchMetadata.processingTime,
        cacheUsed: false,
      },
    }
  } catch (error) {
    console.error('Error in LLM generation:', error)

    // Fallback to re-ranking results
    return {
      suggestions: topN.slice(0, 3).map((item, idx) => ({
        placeId: item.placeId,
        reason: `Match score: ${item.score.toFixed(2)}`,
        matchScore: item.score,
        confidence: idx === 0 ? 'high' : idx === 1 ? 'medium' : ('low' as const),
      })),
      searchMetadata: {
        totalCandidates: searchMetadata.totalCandidates,
        processingTime: searchMetadata.processingTime,
        cacheUsed: false,
      },
    }
  }
}

/**
 * EVENTS SEARCH FUNCTIONS
 */

/**
 * Step A (Events): Geo Filter - Find events within radius using PostGIS
 * OPTIMIZED: Uses cache for frequently requested areas
 */
export async function geoFilterEvents(
  lat: number,
  lon: number,
  radiusKm: number = 5
): Promise<string[]> {
  const cacheKey = createGeoFilterCacheKey(lat, lon, radiusKm, 'events')
  
  // ENHANCED: Use async cache system
  const cached = await getCachedGeoResults(cacheKey)
  if (cached) {
    return cached
  }

  const supabase = await getReadOnlyClient()

  const radiusMeters = radiusKm * 1000

  const { data, error } = await supabase.rpc('events_within_radius', {
    center_lat: lat,
    center_lon: lon,
    radius_meters: radiusMeters,
  })

  if (error) {
    console.error('Error in geo filter (events):', error)
    return []
  }

  const results = (data || []).slice(0, 100).map((e: any) => e.id)
  
  // ENHANCED: Async cache storage
  await setCachedGeoResults(cacheKey, results, 'events', lat, lon, radiusKm)

  return results
}

/**
 * OPTIMIZED: Create cache key for event vector search results
 */
function createEventVectorSearchCacheKey(embeddingHash: string, candidateIds: string[], topK: number): string {
  const idsHash = hashText(candidateIds.sort().join(':'))
  return `vector_search_events:${embeddingHash}:${idsHash}:${topK}`
}

/**
 * Step C (Events): Vector Search - Find similar events using pgvector
 * OPTIMIZED: Added caching for event vector search
 */
export async function vectorSearchEvents(
  queryEmbedding: number[],
  candidateIds: string[],
  topK: number = 12
): Promise<Array<{ eventId: string; similarity: number }>> {
  const supabase = await getReadOnlyClient()

  if (candidateIds.length === 0) {
    return []
  }

  // OPTIMIZED: Cache event vector search results
  const embeddingHash = hashText(queryEmbedding.slice(0, 10).join(','))
  const cacheKey = createEventVectorSearchCacheKey(embeddingHash, candidateIds, topK)

  const cachedResults = await hybridApiCache.get(cacheKey)
  if (cachedResults) {
    console.log(`[Event Vector Search Cache] HIT for ${cacheKey}`)
    cacheMetrics.recordHit(cacheKey, 'vector_search_events', 1)
    return cachedResults
  }

  const { data, error } = await supabase.rpc('match_event_embeddings', {
    query_embedding: queryEmbedding,
    candidate_ids: candidateIds,
    match_threshold: 0.3,
    match_count: topK,
  })

  if (error) {
    console.error('[Vector Search Events] Error:', error)
    cacheMetrics.recordMiss(cacheKey, 'vector_search_events', 'not_found')
    return []
  }

  const results = (data || []).map((row: any) => ({
    eventId: row.entity_id,
    similarity: row.similarity,
  }))

  console.log(`[Vector Search Events] Found ${results.length} similar events`)

  // OPTIMIZED: Cache event vector search results
  await hybridApiCache.set(cacheKey, results, {
    ttl: 5 * 60 * 1000,
    tags: ['vector_search', 'events']
  })

  return results
}

/**
 * Step D (Events): Re-Ranking - Apply event-specific business rules
 * OPTIMIZED: Enhanced with parallel distance calculations and metadata caching
 */
export async function reRankEvents(
  topKIds: string[],
  context: SuggestionContext
): Promise<Array<{ eventId: string; score: number; metadata: EventCandidate }>> {
  if (topKIds.length === 0) {
    return []
  }

  console.log(`[Re-rank Events] Fetching metadata for ${topKIds.length} event IDs`)

  // OPTIMIZED: Use batch client for metadata fetching
  const batchClient = await getBatchClient()
  const { data: events, error } = await batchClient
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
      place:places!events_place_id_fkey(id, name, address, city, lat, lon)
    `)
    .in('id', topKIds)

  if (error || !events) {
    console.error('[Re-rank Events] Error fetching event metadata:', error)
    return []
  }

  console.log(`[Re-rank Events] Fetched ${events.length} events from DB`)

  const now = new Date()
  const targetLat = context.location.lat
  const targetLon = context.location.lon
  
  // OTTIMIZZAZIONE AGGRESSIVA: Scoring semplificato per eventi
  const eventsWithScores = events.map((event: any) => {
    let score = 1.0
    let approximateDistance = 0

    // FAST: Distance calculation semplificato
    if (event.place) {
      const latDiff = Math.abs(event.place.lat - targetLat)
      const lonDiff = Math.abs(event.place.lon - targetLon)
      approximateDistance = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff) * 111

      // FAST: Distance penalty semplificato
      if (approximateDistance > 3) {
        score -= Math.min(0.3, (approximateDistance - 3) * 0.05)
      }
    }

    // Time relevance: Boost events happening soon
    const eventDate = new Date(event.start_datetime)
    const daysUntilEvent = (eventDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)

    if (daysUntilEvent < 0) {
      // Past event - heavily penalize
      score -= 1.0
    } else if (daysUntilEvent <= 7) {
      // This week - boost
      score += 0.3
    } else if (daysUntilEvent <= 30) {
      // This month - moderate boost
      score += 0.15
    }

    // Time of day match
    if (context.time && event.start_datetime) {
      const eventHour = eventDate.getHours()
      const timeMatches = {
        morning: eventHour >= 6 && eventHour < 12,
        afternoon: eventHour >= 12 && eventHour < 18,
        evening: eventHour >= 18 && eventHour < 23,
        night: eventHour >= 23 || eventHour < 6,
      }
      if (timeMatches[context.time]) {
        score += 0.2
      }
    }

    // Price match
    if (context.budget && event.ticket_price_min !== null) {
      const budgetRanges = { '€': 15, '€€': 30, '€€€': 60, '€€€€': 100 }
      const maxBudget = budgetRanges[context.budget]
      if (event.ticket_price_min <= maxBudget) {
        score += 0.1
      }
    }

    return {
      eventId: event.id,
      score: Math.max(0, score),
      metadata: {
        id: event.id,
        title: event.title,
        description: event.description,
        event_type: event.event_type,
        start_datetime: event.start_datetime,
        end_datetime: event.end_datetime,
        genre: event.genre,
        lineup: event.lineup,
        ticket_price_min: event.ticket_price_min,
        ticket_price_max: event.ticket_price_max,
        place: event.place,
        distance_km: approximateDistance,
      },
    }
  })

  return eventsWithScores.sort((a: any, b: any) => b.score - a.score)
}

/**
 * Full RAG Pipeline with caching
 * OPTIMIZED: Early LLM execution and parallel processing
 */
export async function runRAGPipeline(
  context: SuggestionContext
): Promise<RAGResult> {
  const startTime = Date.now()

  // Build semantic query
  const semanticQuery = buildSemanticQuery(context)
  const queryHash = hashText(semanticQuery + JSON.stringify(context.location))

  // Check cache first
  const cached = await getCachedResults(queryHash)
  if (cached) {
    return {
      suggestions: cached.similar_places,
      searchMetadata: {
        totalCandidates: 0,
        processingTime: Date.now() - startTime,
        cacheUsed: true,
      },
    }
  }

  // Step A: Geo filter (parallel for places and events)
  const [placeCandidateIds, eventCandidateIds] = await Promise.all([
    geoFilterPlaces(context.location.lat, context.location.lon, context.radius_km || 5),
    geoFilterEvents(context.location.lat, context.location.lon, context.radius_km || 5)
  ])

  const totalCandidates = placeCandidateIds.length + eventCandidateIds.length

  if (totalCandidates === 0) {
    return {
      suggestions: [],
      searchMetadata: {
        totalCandidates: 0,
        processingTime: Date.now() - startTime,
        cacheUsed: false,
      },
    }
  }

  // Step B: Generate query embedding
  const queryEmbedding = await generateEmbedding(semanticQuery)

  // Step C: Vector search (parallel for places and events)
  const [placeVectorResults, eventVectorResults] = await Promise.all([
    placeCandidateIds.length > 0 ? vectorSearch(queryEmbedding, placeCandidateIds, 12) : Promise.resolve([]),
    eventCandidateIds.length > 0 ? vectorSearchEvents(queryEmbedding, eventCandidateIds, 8) : Promise.resolve([])
  ])

  if (placeVectorResults.length === 0 && eventVectorResults.length === 0) {
    return {
      suggestions: [],
      searchMetadata: {
        totalCandidates,
        processingTime: Date.now() - startTime,
        cacheUsed: false,
      },
    }
  }

  // Step D: Re-ranking (parallel for places and events)
  const [rerankedPlaces, rerankedEvents] = await Promise.all([
    placeVectorResults.length > 0 ? reRank(placeVectorResults.map(r => r.placeId), context) : Promise.resolve([]),
    eventVectorResults.length > 0 ? reRankEvents(eventVectorResults.map(r => r.eventId), context) : Promise.resolve([])
  ])

  // Combine top results for LLM (flatten the mixed types)
  const topPlaces = rerankedPlaces.slice(0, 4)
  const topEvents = rerankedEvents.slice(0, 2)

  if (topPlaces.length === 0 && topEvents.length === 0) {
    return {
      suggestions: [],
      searchMetadata: {
        totalCandidates,
        processingTime: Date.now() - startTime,
        cacheUsed: false,
      },
    }
  }

  // Step E: LLM Generation with places and events separately
  const result = await generateSuggestionsWithMixedTypes(topPlaces, topEvents, context, {
    totalCandidates,
    processingTime: Date.now() - startTime,
  })

  // Cache results (fire and forget)
  cacheResults(queryHash, semanticQuery, queryEmbedding, result.suggestions).catch(err => 
    console.error('[Cache] Failed to cache results:', err)
  )

  return result
}
