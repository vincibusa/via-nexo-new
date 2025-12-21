/**
 * Similar Events API
 * FASE 3F.3: Eventi simili a quelli passati per mobile app
 * 
 * Endpoint per ottenere eventi simili a quelli a cui l'utente ha partecipato in passato
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

    // 1. Ottieni eventi passati a cui l'utente ha partecipato
    const now = new Date().toISOString()
    
    const { data: pastAttendance, error: attendanceError } = await supabase
      .from('event_attendance')
      .select(`
        event_id,
        status,
        events!inner (
          id,
          title,
          category,
          start_datetime,
          ticket_price_min,
          venues!inner (
            category
          )
        )
      `)
      .eq('user_id', user.id)
      .in('status', ['going', 'interested'])
      .lt('events.start_datetime', now)
      .order('events.start_datetime', { ascending: false })
      .limit(5)

    if (attendanceError) {
      console.error('[Similar Events] Error fetching past attendance:', attendanceError)
      return NextResponse.json(
        { error: 'Errore nel recupero storico partecipazioni' },
        { status: 500 }
      )
    }

    if (!pastAttendance || pastAttendance.length === 0) {
      // Se l'utente non ha partecipazioni passate, restituisci eventi popolari
      return getPopularEvents(supabase, limit)
    }

    // 2. Estrai categorie preferite dall'utente
    const eventCategories = new Set<string>()
    const venueCategories = new Set<string>()
    
    type AttendanceWithEvents = {
      event_id: string
      status: string
      events: {
        id: string
        title: string
        category: string
        start_datetime: string
        ticket_price_min?: number | null
        venues: {
          category: string
        }
      }
    }
    
    ;(pastAttendance as unknown as AttendanceWithEvents[]).forEach(attendance => {
      if (attendance.events?.category) {
        eventCategories.add(attendance.events.category)
      }
      if (attendance.events?.venues?.category) {
        venueCategories.add(attendance.events.venues.category)
      }
    })

    // 3. Trova eventi futuri simili
    const { data: similarEvents, error: eventsError } = await supabase
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
      .limit(limit * 2) // Prendi più eventi per filtrare

    if (eventsError) {
      console.error('[Similar Events] Error fetching events:', eventsError)
      return NextResponse.json(
        { error: 'Errore nel recupero eventi' },
        { status: 500 }
      )
    }

    if (!similarEvents || similarEvents.length === 0) {
      return NextResponse.json({
        events: [],
        count: 0,
        generated_at: new Date().toISOString()
      })
    }

    // 4. Calcola punteggio di similarità per ogni evento
    const scoredEvents = similarEvents.map(event => {
      let similarityScore = 0
      
      // Punteggio per categoria evento
      if (eventCategories.has(event.category)) {
        similarityScore += 30
      }
      
      // Punteggio per categoria venue
      const venue = Array.isArray(event.venues) ? event.venues[0] : event.venues
      if (venue && venueCategories.has(venue.category)) {
        similarityScore += 25
      }
      
      // Punteggio per prezzo simile (se disponibile)
      if ((pastAttendance as unknown as AttendanceWithEvents[]).some(att => {
        const pastEvent = att.events
        return pastEvent?.ticket_price_min && event.ticket_price_min &&
          Math.abs(pastEvent.ticket_price_min - event.ticket_price_min) < 10
      })) {
        similarityScore += 15
      }
      
      // Bonus per eventi nello stesso giorno della settimana
      const eventDate = new Date(event.start_datetime)
      const eventDay = eventDate.getDay()
      
      const hasSameDay = (pastAttendance as unknown as AttendanceWithEvents[]).some(att => {
        const pastDate = new Date(att.events?.start_datetime || '')
        return pastDate.getDay() === eventDay
      })
      
      if (hasSameDay) {
        similarityScore += 10
      }
      
      // Bonus per eventi nello stesso orario (±2 ore)
      const eventHour = eventDate.getHours()
      
      const hasSimilarTime = (pastAttendance as unknown as AttendanceWithEvents[]).some(att => {
        const pastDate = new Date(att.events?.start_datetime || '')
        const pastHour = pastDate.getHours()
        return Math.abs(pastHour - eventHour) <= 2
      })
      
      if (hasSimilarTime) {
        similarityScore += 10
      }
      
      return {
        ...event,
        similarity_score: similarityScore,
        match_reasons: generateMatchReasons(event, eventCategories, venueCategories)
      }
    })

    // 5. Ordina per punteggio di similarità e limita
    const topSimilarEvents = scoredEvents
      .sort((a, b) => b.similarity_score - a.similarity_score)
      .slice(0, limit)
      .map(event => formatEvent(event))

    return NextResponse.json({
      events: topSimilarEvents,
      count: topSimilarEvents.length,
      generated_at: new Date().toISOString(),
      user_preferences: {
        event_categories: Array.from(eventCategories),
        venue_categories: Array.from(venueCategories)
      }
    })

  } catch (error) {
    console.error('[Similar Events] Error:', error)
    return NextResponse.json(
      { error: 'Errore interno del server' },
      { status: 500 }
    )
  }
}

/**
 * Ottieni eventi popolari come fallback
 */
async function getPopularEvents(supabase: any, limit: number) {
  const now = new Date().toISOString()
  
  const { data: popularEvents, error } = await supabase
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
    console.error('[Similar Events] Error fetching popular events:', error)
    return NextResponse.json(
      { error: 'Errore nel recupero eventi popolari' },
      { status: 500 }
    )
  }

  const events = popularEvents?.map((event: any) => formatEvent(event)) || []

  return NextResponse.json({
    events,
    count: events.length,
    generated_at: new Date().toISOString(),
    note: 'Nessuna partecipazione passata trovata, mostrando eventi popolari'
  })
}

/**
 * Genera motivi di corrispondenza
 */
function generateMatchReasons(
  event: any,
  eventCategories: Set<string>,
  venueCategories: Set<string>
): string[] {
  const reasons: string[] = []
  
  if (eventCategories.has(event.category)) {
    reasons.push(`Categoria simile: ${event.category}`)
  }
  
  const venue = Array.isArray(event.venues) ? event.venues[0] : event.venues
  if (venue && venueCategories.has(venue.category)) {
    reasons.push(`Tipo di locale simile: ${venue.category}`)
  }
  
  if (reasons.length === 0) {
    reasons.push('Basato su eventi popolari')
  }
  
  return reasons
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
    similarity_score: event.similarity_score || 0,
    match_reasons: event.match_reasons || []
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