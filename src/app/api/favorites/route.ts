import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

// Add favorite schema
const addFavoriteSchema = z.object({
  entity_type: z.enum(['place', 'event']),
  entity_id: z.string().uuid(),
})

/**
 * GET /api/favorites
 * Get user's favorite places and events
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch all favorites
    const { data: favorites, error: favError } = await supabase
      .from('favorites')
      .select('id, entity_type, entity_id, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (favError) {
      console.error('Error fetching favorites:', favError)
      return NextResponse.json(
        { error: 'Failed to fetch favorites' },
        { status: 500 }
      )
    }

    // Fetch place and event details separately
    const placeIds = favorites?.filter((f: any) => f.entity_type === 'place').map((f: any) => f.entity_id) || []
    const eventIds = favorites?.filter((f: any) => f.entity_type === 'event').map((f: any) => f.entity_id) || []

    let places: any[] = []
    let events: any[] = []

    // Fetch places
    if (placeIds.length > 0) {
      const { data: placesData } = await supabase
        .from('places')
        .select('*')
        .in('id', placeIds)
        .eq('is_published', true)

      places = (placesData || []).map((place: any) => {
        const fav = favorites?.find((f: any) => f.entity_id === place.id)
        return {
          favorite_id: fav?.id,
          created_at: fav?.created_at,
          id: place.id,
          name: place.name,
          category: place.place_type,
          description: place.description,
          cover_image: place.cover_image_url,
          address: place.address,
          city: place.city,
          latitude: place.lat,
          longitude: place.lon,
          price_range: place.price_range,
          verified: place.verification_status === 'approved',
        }
      })
    }

    // Fetch events
    if (eventIds.length > 0) {
      const { data: eventsData } = await supabase
        .from('events')
        .select(`
          *,
          place:place_id(id, name, address, city)
        `)
        .in('id', eventIds)
        .eq('is_published', true)
        .eq('is_cancelled', false)

      events = (eventsData || []).map((event: any) => {
        const fav = favorites?.find((f: any) => f.entity_id === event.id)
        return {
          favorite_id: fav?.id,
          created_at: fav?.created_at,
          id: event.id,
          title: event.title,
          description: event.description,
          event_type: event.event_type,
          start_datetime: event.start_datetime,
          end_datetime: event.end_datetime,
          cover_image: event.cover_image_url,
          ticket_price_min: event.ticket_price_min,
          ticket_price_max: event.ticket_price_max,
          music_genre: event.genre,
          place: event.place,
        }
      })
    }

    return NextResponse.json({
      places,
      events,
      total: places.length + events.length,
    })
  } catch (error) {
    console.error('Error in GET /api/favorites:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/favorites
 * Add a place or event to favorites
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse and validate request body
    const body = await request.json()
    const { entity_type, entity_id } = addFavoriteSchema.parse(body)

    // Check if resource exists and is published
    if (entity_type === 'place') {
      const { data: place, error: placeError } = await supabase
        .from('places')
        .select('id, is_published')
        .eq('id', entity_id)
        .single()

      if (placeError || !place || !place.is_published) {
        return NextResponse.json(
          { error: 'Place not found or not published' },
          { status: 404 }
        )
      }
    } else if (entity_type === 'event') {
      const { data: event, error: eventError } = await supabase
        .from('events')
        .select('id, is_published, is_cancelled')
        .eq('id', entity_id)
        .single()

      if (eventError || !event || !event.is_published || event.is_cancelled) {
        return NextResponse.json(
          { error: 'Event not found, not published, or cancelled' },
          { status: 404 }
        )
      }
    }

    // Check if already favorited
    const { data: existing } = await supabase
      .from('favorites')
      .select('id')
      .eq('user_id', user.id)
      .eq('entity_type', entity_type)
      .eq('entity_id', entity_id)
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        { error: 'Already in favorites', favorite_id: existing.id },
        { status: 409 }
      )
    }

    // Add to favorites
    const { data: favorite, error: insertError } = await supabase
      .from('favorites')
      .insert({
        user_id: user.id,
        entity_type,
        entity_id,
      })
      .select()
      .single()

    if (insertError) {
      console.error('Error adding favorite:', insertError)
      return NextResponse.json(
        { error: 'Failed to add favorite' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      favorite,
      message: 'Added to favorites',
    }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Invalid input',
          details: error.issues,
        },
        { status: 400 }
      )
    }

    console.error('Error in POST /api/favorites:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
