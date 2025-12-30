/**
 * User Preferences Service
 *
 * Manages user preference profiles learned from behavior data.
 * Preferences are used to personalize AI recommendations in the RAG pipeline.
 */

import { createClient } from '@/lib/supabase/server'

/**
 * User preferences interface matching the database schema
 */
export interface UserPreferences {
  preferredEventTypes: string[]
  preferredGenres: string[]
  preferredPlaceTypes: string[]
  preferredAmbiences: string[]
  preferredMusicGenres: string[]
  preferredBudget: string | null
  avgTicketPriceMin: number | null
  avgTicketPriceMax: number | null
  totalReservations: number
  totalCheckIns: number
  totalFavorites: number
  totalSwipesLiked: number
  totalSwipesPassed: number
  preferenceConfidence: number // 0-100
  lastComputedAt: string
}

/**
 * Raw database row type
 */
interface UserPreferenceProfileRow {
  id: string
  user_id: string
  preferred_event_types: string[]
  preferred_genres: string[]
  preferred_place_types: string[]
  preferred_ambiences: string[]
  preferred_music_genres: string[]
  preferred_budget: string | null
  avg_ticket_price_min: number | null
  avg_ticket_price_max: number | null
  total_reservations: number
  total_check_ins: number
  total_favorites: number
  total_swipes_liked: number
  total_swipes_passed: number
  preference_confidence: number
  last_computed_at: string
  created_at: string
  updated_at: string
}

/**
 * Transform database row to UserPreferences interface
 */
function transformPreferences(row: UserPreferenceProfileRow): UserPreferences {
  return {
    preferredEventTypes: row.preferred_event_types || [],
    preferredGenres: row.preferred_genres || [],
    preferredPlaceTypes: row.preferred_place_types || [],
    preferredAmbiences: row.preferred_ambiences || [],
    preferredMusicGenres: row.preferred_music_genres || [],
    preferredBudget: row.preferred_budget,
    avgTicketPriceMin: row.avg_ticket_price_min,
    avgTicketPriceMax: row.avg_ticket_price_max,
    totalReservations: row.total_reservations,
    totalCheckIns: row.total_check_ins,
    totalFavorites: row.total_favorites,
    totalSwipesLiked: row.total_swipes_liked,
    totalSwipesPassed: row.total_swipes_passed,
    preferenceConfidence: row.preference_confidence,
    lastComputedAt: row.last_computed_at,
  }
}

/**
 * Get user preferences from database
 * Returns null if user has no preference profile or if preferences are too stale (>24h)
 *
 * @param userId - User ID to fetch preferences for
 * @param forceRecompute - Force recomputation even if cache is fresh
 * @returns UserPreferences or null
 */
export async function getUserPreferences(
  userId: string,
  forceRecompute: boolean = false
): Promise<UserPreferences | null> {
  try {
    const supabase = await createClient()

    // Fetch existing preferences
    const { data: existingProfile, error: fetchError } = await supabase
      .from('user_preference_profiles')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (fetchError && fetchError.code !== 'PGRST116') {
      // PGRST116 = not found, which is ok
      console.error('[User Preferences] Error fetching preferences:', fetchError)
      return null
    }

    // Check if preferences need recomputation (>24h old or forced)
    const needsRecompute = forceRecompute ||
      !existingProfile ||
      new Date().getTime() - new Date(existingProfile.last_computed_at).getTime() > 24 * 60 * 60 * 1000

    if (needsRecompute) {
      console.log(`[User Preferences] Recomputing preferences for user ${userId}`)
      return await computeUserPreferences(userId)
    }

    return transformPreferences(existingProfile)
  } catch (error) {
    console.error('[User Preferences] Unexpected error:', error)
    return null
  }
}

/**
 * Compute user preferences from behavior data
 * Calls the Supabase RPC function to aggregate preferences
 *
 * @param userId - User ID to compute preferences for
 * @returns UserPreferences or null on error
 */
export async function computeUserPreferences(userId: string): Promise<UserPreferences | null> {
  try {
    const supabase = await createClient()

    // Call RPC function to compute preferences
    const { data, error } = await supabase.rpc('compute_user_preferences', {
      p_user_id: userId
    })

    if (error) {
      console.error('[User Preferences] Error computing preferences:', error)
      return null
    }

    if (!data) {
      console.warn('[User Preferences] No data returned from compute_user_preferences')
      return null
    }

    console.log(`[User Preferences] Computed preferences for user ${userId}:`, {
      confidence: data.preference_confidence,
      eventTypes: data.preferred_event_types?.length || 0,
      genres: data.preferred_genres?.length || 0,
    })

    return transformPreferences(data)
  } catch (error) {
    console.error('[User Preferences] Unexpected error computing preferences:', error)
    return null
  }
}

/**
 * Check if user preferences are sufficient for personalization
 * Returns true if confidence score is above threshold (30%)
 *
 * @param preferences - User preferences object
 * @returns boolean indicating if preferences can be used for personalization
 */
export function hasSignificantPreferences(preferences: UserPreferences | null): boolean {
  return preferences !== null && preferences.preferenceConfidence >= 30
}

/**
 * Get a summary of user preferences for logging/debugging
 *
 * @param preferences - User preferences object
 * @returns string summary
 */
export function getPreferencesSummary(preferences: UserPreferences | null): string {
  if (!preferences) {
    return 'No preferences available'
  }

  const parts: string[] = []

  if (preferences.preferredEventTypes.length > 0) {
    parts.push(`Events: ${preferences.preferredEventTypes.slice(0, 3).join(', ')}`)
  }

  if (preferences.preferredGenres.length > 0) {
    parts.push(`Genres: ${preferences.preferredGenres.slice(0, 3).join(', ')}`)
  }

  if (preferences.preferredBudget) {
    parts.push(`Budget: ${preferences.preferredBudget}`)
  }

  parts.push(`Confidence: ${preferences.preferenceConfidence}%`)

  return parts.join(' | ')
}
