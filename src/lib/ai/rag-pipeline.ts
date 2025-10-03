import { createClient } from '@/lib/supabase/server'
import { generateEmbedding, getCachedResults, cacheResults } from './embedding'
import { hashText } from './chunking'
import { generateObject } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'

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
 */
export async function geoFilterPlaces(
  lat: number,
  lon: number,
  radiusKm: number = 5,
  category?: string
): Promise<string[]> {
  const supabase = await createClient()

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
  return (data || []).slice(0, 100).map((p: any) => p.id)
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
 * Step C: Vector Search - Find similar places using pgvector
 */
export async function vectorSearch(
  queryEmbedding: number[],
  candidateIds: string[],
  topK: number = 12
): Promise<Array<{ placeId: string; similarity: number }>> {
  const supabase = await createClient()

  if (candidateIds.length === 0) {
    return []
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

  return results
}

/**
 * Step D: Re-Ranking - Apply business rules and boost/penalize scores
 */
export async function reRank(
  topKIds: string[],
  context: SuggestionContext
): Promise<Array<{ placeId: string; score: number; metadata: PlaceCandidate }>> {
  const supabase = await createClient()

  if (topKIds.length === 0) {
    return []
  }

  // Fetch full metadata for top K places
  console.log(`[Re-rank] Fetching metadata for ${topKIds.length} place IDs`)
  const { data: places, error } = await supabase
    .from('places')
    .select('*')
    .in('id', topKIds)

  if (error || !places) {
    console.error('[Re-rank] Error fetching place metadata:', error)
    return []
  }

  console.log(`[Re-rank] Fetched ${places.length} unique places from DB`)

  // Calculate distance for each place
  const placesWithScores = places.map((place) => {
    let score = 1.0 // Base score

    // Boost verified places
    if (place.verification_status === 'approved') {
      score += 0.1
    }

    // Calculate distance
    const distance = calculateDistance(
      context.location.lat,
      context.location.lon,
      place.lat,
      place.lon
    )

    // Penalize by distance (exponential decay)
    if (distance > 3) {
      score -= Math.min(0.3, (distance - 3) * 0.05)
    }

    // Boost by popularity
    const popularityBoost = Math.log(place.suggestions_count + 1) * 0.02
    score += popularityBoost

    // Budget match
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
        distance_km: distance,
        suggestions_count: place.suggestions_count,
      },
    }
  })

  // Sort by reranked score
  return placesWithScores.sort((a, b) => b.score - a.score)
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
        reason: z.string().max(200),
        matchScore: z.number().min(0).max(1),
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
      model: openai('gpt-5-mini'), // Reasoning model, no temperature parameter
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
 * Full RAG Pipeline with caching
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

  // Step A: Geo filter
  const candidateIds = await geoFilterPlaces(
    context.location.lat,
    context.location.lon,
    context.radius_km || 5
  )

  if (candidateIds.length === 0) {
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

  // Step C: Vector search
  const vectorResults = await vectorSearch(queryEmbedding, candidateIds, 12)

  if (vectorResults.length === 0) {
    return {
      suggestions: [],
      searchMetadata: {
        totalCandidates: candidateIds.length,
        processingTime: Date.now() - startTime,
        cacheUsed: false,
      },
    }
  }

  // Step D: Re-ranking
  const topKIds = vectorResults.map((r) => r.placeId)
  const reranked = await reRank(topKIds, context)

  // Take top 6 for LLM
  const topN = reranked.slice(0, 6)

  // Step E: LLM Generation
  const result = await generateSuggestionsWithLLM(topN, context, {
    totalCandidates: candidateIds.length,
    processingTime: Date.now() - startTime,
  })

  // Cache results
  await cacheResults(
    queryHash,
    semanticQuery,
    queryEmbedding,
    result.suggestions
  )

  return result
}
