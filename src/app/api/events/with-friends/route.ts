/**
 * Events with Friends API
 * FASE 3F.1: Eventi con amici per mobile app
 * 
 * Endpoint per ottenere eventi a cui partecipano amici
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
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

    // Ottieni parametri
    const url = new URL(request.url)
    const limit = parseInt(url.searchParams.get('limit') || '10')
    const offset = parseInt(url.searchParams.get('offset') || '0')

    // 1. Ottieni amici dell'utente
    const { data: friends } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', user.id)

    if (!friends || friends.length === 0) {
      return NextResponse.json({
        events: [],
        count: 0,
        total: 0
      })
    }

    const friendIds = friends.map(f => f.following_id)

    // 2. Ottieni eventi a cui partecipano amici
    const now = new Date().toISOString()
    
    const { data: events, error, count } = await supabase
      .from('event_attendance')
      .select(`
        id,
        event_id,
        status,
        created_at,
        events!inner (
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
        ),
        profiles!inner (
          id,
          display_name,
          avatar_url
        )
      `, { count: 'exact' })
      .in('user_id', friendIds)
      .eq('status', 'going')
      .gt('events.start_datetime', now)
      .order('events.start_datetime', { ascending: true })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('[Events with Friends] Error:', error)
      return NextResponse.json(
        { error: 'Errore nel recupero eventi' },
        { status: 500 }
      )
    }

    // 3. Raggruppa eventi per ID e raccogli amici partecipanti
    const eventsMap = new Map<string, any>()
    
    events?.forEach(attendance => {
      const eventId = attendance.events.id
      
      if (!eventsMap.has(eventId)) {
        eventsMap.set(eventId, {
          id: attendance.events.id,
          title: attendance.events.title,
          description: attendance.events.description,
          event_type: attendance.events.category,
          start_datetime: attendance.events.start_datetime,
          end_datetime: attendance.events.end_datetime,
          cover_image: attendance.events.cover_image,
          lineup: attendance.events.lineup,
          music_genre: attendance.events.music_genre,
          ticket_price_min: attendance.events.ticket_price_min,
          ticket_price_max: attendance.events.ticket_price_max,
          ticket_url: attendance.events.ticket_url,
          ticket_availability: attendance.events.ticket_availability,
          place: {
            id: attendance.events.venues.id,
            name: attendance.events.venues.name,
            category: attendance.events.venues.category,
            address: attendance.events.venues.address,
            city: attendance.events.venues.city,
            latitude: parseLocation(attendance.events.venues.location).lat,
            longitude: parseLocation(attendance.events.venues.location).lng,
            cover_image: attendance.events.venues.cover_image,
            price_range: attendance.events.venues.price_range,
            verified: attendance.events.venues.verified
          },
          friends_going: [],
          friend_count: 0
        })
      }
      
      const event = eventsMap.get(eventId)!
      event.friends_going.push({
        id: attendance.profiles.id,
        display_name: attendance.profiles.display_name,
        avatar_url: attendance.profiles.avatar_url
      })
      event.friend_count = event.friends_going.length
    })

    const eventsWithFriends = Array.from(eventsMap.values())

    return NextResponse.json({
      events: eventsWithFriends,
      count: eventsWithFriends.length,
      total: count || 0,
      generated_at: new Date().toISOString()
    })

  } catch (error) {
    console.error('[Events with Friends] Error:', error)
    return NextResponse.json(
      { error: 'Errore interno del server' },
      { status: 500 }
    )
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