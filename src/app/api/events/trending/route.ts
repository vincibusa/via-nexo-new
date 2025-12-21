/**
 * Trending Events API
 * FASE 3F.2: Eventi trending per mobile app
 * 
 * Endpoint per ottenere eventi popolari nell'area dell'utente
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()

  try {
    // Verifica autenticazione
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Non autorizzato' },
        { status: 401 }
      )
    }

    // Ottieni parametri dal body
    const body = await request.json()
    const {
      latitude,
      longitude,
      radius_km = 10,
      limit = 15
    } = body

    if (!latitude || !longitude) {
      return NextResponse.json(
        { error: 'Coordinate richieste (latitude, longitude)' },
        { status: 400 }
      )
    }

    // 1. Ottieni eventi futuri nell'area specificata
    const now = new Date().toISOString()
    
    // Utilizza funzione RPC per eventi entro raggio
    const { data: nearbyEvents, error: rpcError } = await supabase.rpc('events_within_radius', {
      p_lat: latitude,
      p_lng: longitude,
      p_radius_km: radius_km,
      p_limit: limit * 2 // Prendi più eventi per calcolare trending
    })

    if (rpcError) {
      console.error('[Trending Events] RPC Error:', rpcError)
      // Fallback: ottieni eventi futuri senza filtro posizione
      const { data: events, error } = await supabase
        .from('events')
        .select(`
          id,
          title,
          description,
          start_datetime,
          end_datetime,
          category,
          cover_image,
          ticket_price_min,
          ticket_price_max,
          ticket_availability,
          venues!inner (
            id,
            name,
            category,
            address,
            city,
            location,
            cover_image,
            price_range,
            verified
          )
        `)
        .gt('start_datetime', now)
        .order('start_datetime', { ascending: true })
        .limit(limit)

      if (error) {
        console.error('[Trending Events] Error:', error)
        return NextResponse.json(
          { error: 'Errore nel recupero eventi' },
          { status: 500 }
        )
      }

      return NextResponse.json({
        events: events?.map((event: any) => formatEvent(event)) || [],
        count: events?.length || 0,
        generated_at: new Date().toISOString()
      })
    }

    if (!nearbyEvents || nearbyEvents.length === 0) {
      return NextResponse.json({
        events: [],
        count: 0,
        generated_at: new Date().toISOString()
      })
    }

    // 2. Calcola punteggio trending per ogni evento
    const eventIds = nearbyEvents.map((e: any) => e.id)
    
    // Ottieni statistiche per ogni evento (query separate per status)
    const { data: goingStats } = await supabase
      .from('event_attendance')
      .select('event_id')
      .in('event_id', eventIds)
      .eq('status', 'going')

    const { data: interestedStats } = await supabase
      .from('event_attendance')
      .select('event_id')
      .in('event_id', eventIds)
      .eq('status', 'interested')

    // Aggrega manualmente i conteggi
    const eventStats = eventIds.map((eventId: string) => {
      const goingCount = goingStats?.filter((s: any) => s.event_id === eventId).length || 0
      const interestedCount = interestedStats?.filter((s: any) => s.event_id === eventId).length || 0
      return {
        event_id: eventId,
        going: goingCount,
        interested: interestedCount
      }
    })

    // Ottieni visualizzazioni recenti
    const oneWeekAgo = new Date()
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7)
    
    const { data: recentViewsData } = await supabase
      .from('event_views')
      .select('event_id')
      .in('event_id', eventIds)
      .gt('viewed_at', oneWeekAgo.toISOString())

    // Aggrega manualmente le visualizzazioni
    const recentViews = eventIds.map((eventId: string) => ({
      event_id: eventId,
      count: recentViewsData?.filter((v: any) => v.event_id === eventId).length || 0
    }))

    // 3. Calcola punteggio trending
    const trendingScores = nearbyEvents.map((event: any) => {
      const stats = eventStats?.find((s: any) => s.event_id === event.id)
      const goingCount = stats?.going || 0
      const interestedCount = stats?.interested || 0
      const recentViewCount = recentViews?.find((v: any) => v.event_id === event.id)?.count || 0
      
      // Calcola punteggio: going (peso 3), interested (peso 2), views (peso 1)
      let score = (goingCount * 3) + (interestedCount * 2) + recentViewCount
      
      // Bonus per eventi prossimi (entro 3 giorni)
      const eventDate = new Date(event.start_datetime)
      const now = new Date()
      const daysDiff = Math.ceil((eventDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      
      if (daysDiff <= 3) {
        score += 10
      } else if (daysDiff <= 7) {
        score += 5
      }
      
      // Bonus per eventi con biglietti ancora disponibili
      if (event.ticket_availability === 'available') {
        score += 3
      } else if (event.ticket_availability === 'limited') {
        score += 1
      }
      
      return {
        ...event,
        trending_score: score,
        going_count: goingCount,
        interested_count: interestedCount,
        recent_views: recentViewCount
      }
    })

    // 4. Ordina per punteggio trending e limita
    const trendingEvents = trendingScores
      .sort((a: any, b: any) => b.trending_score - a.trending_score)
      .slice(0, limit)
      .map((event: any) => formatEvent(event))

    return NextResponse.json({
      events: trendingEvents,
      count: trendingEvents.length,
      generated_at: new Date().toISOString()
    })

  } catch (error) {
    console.error('[Trending Events] Error:', error)
    return NextResponse.json(
      { error: 'Errore interno del server' },
      { status: 500 }
    )
  }
}

/**
 * Formatta evento per risposta API
 */
function formatEvent(event: any) {
  const venue = Array.isArray(event.venues) ? event.venues[0] : event.venues
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    event_type: event.category,
    start_datetime: event.start_datetime,
    end_datetime: event.end_datetime,
    cover_image: event.cover_image,
    lineup: event.lineup,
    music_genre: event.music_genre,
    ticket_price_min: event.ticket_price_min,
    ticket_price_max: event.ticket_price_max,
    ticket_url: event.ticket_url,
    ticket_availability: event.ticket_availability,
    place: {
      id: venue?.id,
      name: venue?.name,
      category: venue?.category,
      address: venue?.address,
      city: venue?.city,
      latitude: parseLocation(venue?.location).lat,
      longitude: parseLocation(venue?.location).lng,
      cover_image: venue?.cover_image,
      price_range: venue?.price_range,
      verified: venue?.verified
    },
    trending_score: event.trending_score,
    going_count: event.going_count || 0,
    interested_count: event.interested_count || 0,
    recent_views: event.recent_views || 0
  }
}

/**
 * Helper per parsare location da stringa a oggetto
 */
function parseLocation(locationString?: string): { lat: number; lng: number } {
  if (!locationString) {
    return { lat: 0, lng: 0 }
  }

  try {
    const [lat, lng] = locationString.split(',').map(coord => parseFloat(coord.trim()))
    return { lat: isNaN(lat) ? 0 : lat, lng: isNaN(lng) ? 0 : lng }
  } catch {
    return { lat: 0, lng: 0 }
  }
}