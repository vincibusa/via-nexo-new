/**
 * Event Recommendations API
 * FASE 3C: Smart Event Recommendations
 *
 * Endpoint per ottenere raccomandazioni eventi personalizzate
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getEventRecommendationsAPI } from '@/lib/services/event-recommendations'
import { runRAGPipeline } from '@/lib/ai/rag-pipeline'
import type { SuggestionContext } from '@/lib/ai/rag-pipeline'
import { getUserPreferences } from '@/lib/ai/user-preferences'

export async function GET(request: NextRequest) {
  const supabase = await createClient()

  try {
    // Verifica autenticazione
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return new Response(JSON.stringify({
        error: 'Non autorizzato'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    return await getEventRecommendationsAPI(user.id, request)

  } catch (error) {
    console.error('[Event Recommendations API] Error:', error)
    return new Response(JSON.stringify({
      error: 'Errore interno del server'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

/**
 * POST /api/events/recommendations
 * Daily recommendations with warm-start from initial_preferences when behavioral confidence < 30
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()

  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
    }

    const body = await request.json()
    const { location, radius_km } = body as {
      location: { lat: number; lon: number }
      radius_km?: number
    }

    if (!location?.lat || !location?.lon) {
      return NextResponse.json({ error: 'location is required' }, { status: 400 })
    }

    // Fetch behavioral preferences and profile metadata in parallel
    const [userPreferences, profileResult] = await Promise.all([
      getUserPreferences(user.id),
      supabase.from('profiles').select('metadata').eq('id', user.id).single(),
    ])

    const profileMetadata = (profileResult.data?.metadata as Record<string, unknown>) ?? {}
    const initialPreferences = profileMetadata.initial_preferences as {
      partyTypes?: string[]
      musicGenres?: string[]
      budget?: string
      companionship?: string
      ambiences?: string[]
    } | undefined

    const confidence = userPreferences?.preferenceConfidence ?? 0

    // Build context — if confidence < 30, inject initial_preferences as warm-start
    const context: SuggestionContext = {
      location,
      radius_km: radius_km ?? 50,
      userPreferences: userPreferences ?? undefined,
    }

    if (confidence < 30 && initialPreferences) {
      console.log(`[Recommendations] confidence=${confidence} < 30 — warm-start with initial_preferences`)

      // Map companionship
      const companionshipMap: Record<string, SuggestionContext['companionship']> = {
        'Da solo': 'alone',
        'In coppia': 'partner',
        'Con amici': 'friends',
        'In famiglia': 'family',
      }
      if (initialPreferences.companionship) {
        context.companionship = companionshipMap[initialPreferences.companionship]
      }

      // Map budget
      const budgetMap: Record<string, SuggestionContext['budget']> = {
        '€ Economico': '€',
        '€€ Moderato': '€€',
        '€€€ Libero': '€€€',
        '€€€€ Premium': '€€€€',
      }
      if (initialPreferences.budget) {
        context.budget = budgetMap[initialPreferences.budget]
      }

      // Merge party types + music genres + ambiences into preferences array
      const prefStrings: string[] = [
        ...(initialPreferences.partyTypes ?? []),
        ...(initialPreferences.musicGenres ?? []),
        ...(initialPreferences.ambiences ?? []),
      ]
      if (prefStrings.length > 0) {
        context.preferences = prefStrings
      }
    }

    const result = await runRAGPipeline(context)

    if (result.suggestions.length === 0) {
      return NextResponse.json({ recommendations: [], searchMetadata: result.searchMetadata })
    }

    // Join suggestions with full place data
    const placeIds = result.suggestions.map(s => s.placeId)
    const { data: places } = await supabase
      .from('places')
      .select('id, name, address, city, place_type, cover_image, price_range, ambience_tags, music_genre, lat, lon, is_published, is_listed, verification_status')
      .in('id', placeIds)

    const placesById = Object.fromEntries((places ?? []).map((p: Record<string, unknown>) => [p.id, p]))

    const recommendations = result.suggestions
      .map(s => {
        const place = placesById[s.placeId]
        if (!place) return null
        return {
          ...place,
          id: s.placeId,
          verified: place.verification_status === 'approved',
          ai_reason: s.reason,
          similarity_score: s.matchScore,
        }
      })
      .filter(Boolean)

    return NextResponse.json({
      recommendations,
      searchMetadata: result.searchMetadata,
    })
  } catch (error) {
    console.error('[Event Recommendations POST] Error:', error)
    return NextResponse.json({ error: 'Errore interno del server' }, { status: 500 })
  }
}