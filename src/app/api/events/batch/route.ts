import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

// Input validation schema
const batchRequestSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50), // Max 50 events per request
})

export async function POST(request: NextRequest) {
  try {
    // Parse and validate input
    const body = await request.json()
    const { ids } = batchRequestSchema.parse(body)

    // Create Supabase client
    const supabase = await createClient()

    // Fetch events by IDs with place details
    const { data: events, error } = await supabase
      .from('events')
      .select(
        `
        id,
        title,
        description,
        event_type,
        start_datetime,
        end_datetime,
        cover_image_url,
        promo_video_url,
        doors_open_time,
        genre,
        lineup,
        ticket_price_min,
        ticket_price_max,
        ticket_url,
        tickets_available,
        is_published,
        is_listed,
        is_cancelled,
        place:place_id(
          id,
          name,
          place_type,
          address,
          city,
          lat,
          lon,
          cover_image_url,
          price_range,
          verification_status
        )
      `
      )
      .in('id', ids)
      .eq('is_published', true)
      .eq('is_listed', true)

    if (error) {
      console.error('Error fetching events:', error)
      return NextResponse.json(
        {
          error: 'Failed to fetch events',
        },
        { status: 500 }
      )
    }

    // Map database fields to mobile API format
    const mappedEvents = (events || []).map((event: any) => {
      // Supabase returns place as an object (not array) when using foreign key select
      const placeData = event.place;
      
      return {
        id: event.id,
        title: event.title,
        description: event.description,
        event_type: event.event_type,
        start_datetime: event.start_datetime,
        end_datetime: event.end_datetime,
        cover_image: event.cover_image_url,
        promo_video_url: event.promo_video_url,
        doors_open_time: event.doors_open_time,
        music_genre: event.genre,
        lineup: event.lineup,
        ticket_price_min: event.ticket_price_min,
        ticket_price_max: event.ticket_price_max,
        ticket_url: event.ticket_url,
        tickets_available: event.tickets_available,
        is_published: event.is_published,
        is_listed: event.is_listed,
        is_cancelled: event.is_cancelled,
        // Map place data
        place: placeData ? {
          id: placeData.id,
          name: placeData.name,
          category: placeData.place_type,
          address: placeData.address,
          city: placeData.city,
          latitude: placeData.lat,
          longitude: placeData.lon,
          cover_image: placeData.cover_image_url,
          price_range: placeData.price_range as '€' | '€€' | '€€€' | undefined,
          verified: placeData.verification_status === 'approved',
        } : null,
      };
    })

    return NextResponse.json({
      events: mappedEvents,
      count: mappedEvents.length,
    })
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

    console.error('Error in batch events API:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
}
