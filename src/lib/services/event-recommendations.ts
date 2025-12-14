/**
 * Smart Event Recommendations Service
 * FASE 3C: Eventi Personalizzati e Social
 * 
 * Sistema di raccomandazioni eventi basato su:
 * 1. Amici che partecipano
 * 2. Interessi utente
 * 3. Posizione geografica
 * 4. Storico partecipazioni
 */

import { getBatchClient } from '@/lib/supabase/connection-pool'
import { createNotification } from './notifications'

export interface EventRecommendation {
  event_id: string
  event_title: string
  event_start_datetime: string
  venue_name: string
  venue_location: { lat: number; lng: number }
  friend_count: number
  friends_attending: Array<{
    user_id: string
    display_name: string
    avatar_url?: string
  }>
  match_score: number
  reason: string
}

export interface UserPreferences {
  interests?: string[]
  preferred_categories?: string[]
  max_distance_km?: number
  preferred_days?: string[] // ['weekend', 'weekday']
  preferred_times?: string[] // ['morning', 'afternoon', 'evening', 'night']
}

/**
 * Ottieni raccomandazioni eventi personalizzate per un utente
 */
export async function getPersonalizedEventRecommendations(
  userId: string,
  options: {
    limit?: number
    location?: { lat: number; lng: number }
    preferences?: UserPreferences
  } = {}
): Promise<EventRecommendation[]> {
  try {
    const { limit = 10, location, preferences = {} } = options
    const supabase = await getBatchClient()

    // 1. Ottieni eventi futuri
    const now = new Date().toISOString()
    
    let eventsQuery = supabase
      .from('events')
      .select(`
        id,
        title,
        description,
        start_datetime,
        end_datetime,
        category,
        venue_id,
        venues!inner (
          id,
          name,
          location
        )
      `)
      .gt('start_datetime', now)
      .order('start_datetime', { ascending: true })
      .limit(limit * 3) // Prendi più eventi per filtrare dopo

    // Filtro per posizione se fornita
    if (location && preferences.max_distance_km) {
      // Utilizza funzione RPC per eventi entro raggio
      const { data: nearbyEvents } = await supabase.rpc('events_within_radius', {
        p_lat: location.lat,
        p_lng: location.lng,
        p_radius_km: preferences.max_distance_km || 50,
        p_limit: limit * 3
      })

      if (nearbyEvents && nearbyEvents.length > 0) {
        const eventIds = nearbyEvents.map((e: any) => e.id)
        eventsQuery = eventsQuery.in('id', eventIds)
      }
    }

    const { data: events, error: eventsError } = await eventsQuery

    if (eventsError) {
      console.error('[Event Recommendations] Error fetching events:', eventsError)
      return []
    }

    if (!events || events.length === 0) {
      return []
    }

    // 2. Per ogni evento, trova amici che partecipano
    const recommendations: EventRecommendation[] = []

    for (const event of events) {
      // Ottieni partecipanti all'evento
      const { data: attendees } = await supabase
        .from('event_attendance')
        .select(`
          user_id,
          profiles!inner (
            id,
            display_name,
            avatar_url
          )
        `)
        .eq('event_id', event.id)
        .eq('status', 'going')

      if (!attendees || attendees.length === 0) {
        continue
      }

      // Trova quali partecipanti sono amici dell'utente
      const friendIds = attendees.map((a: any) => a.user_id)
      const { data: friendships } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', userId)
        .in('following_id', friendIds)

      const friendsAttending = attendees
        .filter((a: any) => 
          friendships?.some((f: any) => f.following_id === a.user_id)
        )
        .map((a: any) => ({
          user_id: a.user_id,
          display_name: a.profiles?.display_name || 'Utente',
          avatar_url: a.profiles?.avatar_url
        }))

      if (friendsAttending.length === 0) {
        continue
      }

      // 3. Calcola punteggio di raccomandazione
      const matchScore = calculateMatchScore(event, preferences, friendsAttending.length)

      // 4. Genera motivo della raccomandazione
      const reason = generateRecommendationReason(
        event,
        friendsAttending,
        preferences
      )

      recommendations.push({
        event_id: event.id,
        event_title: event.title,
        event_start_datetime: event.start_datetime,
        venue_name: event.venues?.name || 'Luogo sconosciuto',
        venue_location: parseLocation(event.venues?.location),
        friend_count: friendsAttending.length,
        friends_attending: friendsAttending,
        match_score: matchScore,
        reason
      })
    }

    // 5. Ordina per punteggio e limita
    return recommendations
      .sort((a, b) => b.match_score - a.match_score)
      .slice(0, limit)

  } catch (error) {
    console.error('[Event Recommendations] Error:', error)
    return []
  }
}

/**
 * Calcola punteggio di corrispondenza per un evento
 */
function calculateMatchScore(
  event: any,
  preferences: UserPreferences,
  friendCount: number
): number {
  let score = 0

  // Punteggio base per amici che partecipano
  score += friendCount * 20

  // Corrispondenza categoria/interessi
  if (preferences.preferred_categories?.includes(event.category)) {
    score += 30
  }

  if (preferences.interests?.some(interest => 
    event.title.toLowerCase().includes(interest.toLowerCase()) ||
    event.description?.toLowerCase().includes(interest.toLowerCase())
  )) {
    score += 25
  }

  // Preferenze giorno/ora
  const eventDate = new Date(event.start_datetime)
  const dayOfWeek = eventDate.getDay()
  const hour = eventDate.getHours()

  if (preferences.preferred_days?.includes('weekend') && (dayOfWeek === 0 || dayOfWeek === 6)) {
    score += 15
  }

  if (preferences.preferred_days?.includes('weekday') && dayOfWeek >= 1 && dayOfWeek <= 5) {
    score += 15
  }

  if (preferences.preferred_times?.includes('morning') && hour >= 6 && hour < 12) {
    score += 10
  }

  if (preferences.preferred_times?.includes('afternoon') && hour >= 12 && hour < 18) {
    score += 10
  }

  if (preferences.preferred_times?.includes('evening') && hour >= 18 && hour < 22) {
    score += 10
  }

  if (preferences.preferred_times?.includes('night') && (hour >= 22 || hour < 6)) {
    score += 10
  }

  return Math.min(score, 100)
}

/**
 * Genera motivo della raccomandazione
 */
function generateRecommendationReason(
  event: any,
  friendsAttending: Array<{ display_name: string }>,
  preferences: UserPreferences
): string {
  const reasons: string[] = []

  // Amici che partecipano
  if (friendsAttending.length > 0) {
    if (friendsAttending.length === 1) {
      reasons.push(`${friendsAttending[0].display_name} partecipa`)
    } else if (friendsAttending.length === 2) {
      reasons.push(`${friendsAttending[0].display_name} e ${friendsAttending[1].display_name} partecipano`)
    } else {
      reasons.push(`${friendsAttending.length} tuoi amici partecipano`)
    }
  }

  // Corrispondenza categoria
  if (preferences.preferred_categories?.includes(event.category)) {
    reasons.push(`nell tua categoria preferita (${event.category})`)
  }

  // Prossimità temporale
  const eventDate = new Date(event.start_datetime)
  const now = new Date()
  const daysDiff = Math.ceil((eventDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

  if (daysDiff <= 3) {
    reasons.push('prossimo evento')
  } else if (daysDiff <= 7) {
    reasons.push('questa settimana')
  }

  return reasons.length > 0 
    ? `Consigliato perché: ${reasons.join(', ')}`
    : 'Potrebbe interessarti'
}

/**
 * Invia notifiche per eventi con amici
 */
export async function sendFriendEventNotifications(
  userId: string,
  eventId: string
): Promise<void> {
  try {
    const supabase = await getBatchClient()

    // Ottieni dettagli evento
    const { data: event } = await supabase
      .from('events')
      .select(`
        id,
        title,
        start_datetime,
        venues!inner (
          name
        )
      `)
      .eq('id', eventId)
      .single()

    if (!event) {
      console.warn(`[Event Notifications] Evento ${eventId} non trovato`)
      return
    }

    // Ottieni amici dell'utente
    const { data: friends } = await supabase
      .from('follows')
      .select(`
        following_id,
        profiles!following_id (
          id,
          display_name
        )
      `)
      .eq('follower_id', userId)

    if (!friends || friends.length === 0) {
      return
    }

    // Invia notifiche a ciascun amico
    const notificationPromises = friends.map(async (friend: any) => {
      try {
        await createNotification({
          user_id: friend.following_id,
          actor_id: userId,
          type: 'friend_going_to_event',
          entity_type: 'event',
          entity_id: eventId,
          content: `${friend.profiles?.display_name || 'Un tuo amico'} parteciperà a "${event.title}"`,
          metadata: {
            event_id: eventId,
            event_title: event.title,
            event_start: event.start_datetime,
            venue_name: event.venues?.name,
            friend_id: userId,
            friend_name: friend.profiles?.display_name
          }
        })
      } catch (error) {
        console.warn(`[Event Notifications] Errore notifica per amico ${friend.following_id}:`, error)
      }
    })

    await Promise.allSettled(notificationPromises)
    console.log(`[Event Notifications] Notifiche inviate a ${friends.length} amici per evento ${eventId}`)

  } catch (error) {
    console.error('[Event Notifications] Error:', error)
  }
}

/**
 * API per ottenere raccomandazioni eventi
 */
export async function getEventRecommendationsAPI(
  userId: string,
  request: Request
): Promise<Response> {
  try {
    const url = new URL(request.url)
    const limit = parseInt(url.searchParams.get('limit') || '10')
    const lat = parseFloat(url.searchParams.get('lat') || '')
    const lng = parseFloat(url.searchParams.get('lng') || '')

    const location = !isNaN(lat) && !isNaN(lng) ? { lat, lng } : undefined

    // Qui potresti ottenere preferenze utente dal database
    const preferences: UserPreferences = {
      max_distance_km: 50,
      preferred_days: ['weekend'],
      preferred_times: ['evening']
    }

    const recommendations = await getPersonalizedEventRecommendations(
      userId,
      { limit, location, preferences }
    )

    return new Response(JSON.stringify({
      recommendations,
      count: recommendations.length,
      generated_at: new Date().toISOString()
    }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('[Event Recommendations API] Error:', error)
    return new Response(JSON.stringify({
      error: 'Errore nel recupero raccomandazioni'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
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