import { createClient } from '@/lib/supabase/server'
import { SuggestionContext, RAGResult } from './rag-pipeline'

export interface SuggestionLog {
  context_json: any
  query_embedding: number[]
  geo_bounds: any
  candidates_count: number
  top_k_ids: string[]
  reranked_ids: string[]
  places_returned: string[]
  ai_response_json: any
  ai_tokens_used?: number
  client_app_version?: string
  device_locale?: string
  query_duration_ms: number
  user_id?: string
}

/**
 * Log suggestion to database
 */
export async function logSuggestion(
  context: SuggestionContext,
  result: RAGResult,
  queryEmbedding: number[],
  metadata: {
    candidatesCount: number
    topKIds: string[]
    rerankedIds: string[]
    tokensUsed?: number
    appVersion?: string
    locale?: string
    userId?: string
  }
): Promise<string | null> {
  try {
    const supabase = await createClient()

    const logData: Partial<SuggestionLog> = {
      context_json: context,
      query_embedding: queryEmbedding,
      geo_bounds: {
        center: context.location,
        radius_km: context.radius_km || 5,
      },
      candidates_count: metadata.candidatesCount,
      top_k_ids: metadata.topKIds,
      reranked_ids: metadata.rerankedIds,
      places_returned: result.suggestions.map((s) => s.placeId),
      ai_response_json: result.suggestions,
      ai_tokens_used: metadata.tokensUsed,
      client_app_version: metadata.appVersion,
      device_locale: metadata.locale,
      query_duration_ms: result.searchMetadata.processingTime,
      user_id: metadata.userId,
    }

    const { data, error } = await supabase
      .from('suggestions_logs')
      .insert(logData)
      .select('id')
      .single()

    if (error) {
      console.error('Error logging suggestion:', error)
      return null
    }

    return data?.id || null
  } catch (error) {
    console.error('Error in suggestion logging:', error)
    return null
  }
}

/**
 * Get analytics data for suggestions
 */
export async function getSuggestionsAnalytics(days: number = 30) {
  const supabase = await createClient()

  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)

  const { data, error } = await supabase
    .from('suggestions_logs')
    .select('*')
    .gte('created_at', startDate.toISOString())
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching suggestions analytics:', error)
    return []
  }

  return data || []
}

/**
 * Get top suggested places
 */
export async function getTopSuggestedPlaces(limit: number = 10, days?: number) {
  const supabase = await createClient()

  let query = supabase
    .from('suggestions_logs')
    .select('places_returned')

  if (days) {
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)
    query = query.gte('created_at', startDate.toISOString())
  }

  const { data, error } = await query

  if (error || !data) {
    console.error('Error fetching top suggested places:', error)
    return []
  }

  // Count place occurrences
  const placeCounts: Record<string, number> = {}

  data.forEach((log) => {
    if (Array.isArray(log.places_returned)) {
      log.places_returned.forEach((placeId: string) => {
        placeCounts[placeId] = (placeCounts[placeId] || 0) + 1
      })
    }
  })

  // Sort by count and get top N
  const sortedPlaces = Object.entries(placeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([placeId, count]) => ({ placeId, count }))

  return sortedPlaces
}
