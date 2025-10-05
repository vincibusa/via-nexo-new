import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Fetch event with place details
    const { data: event, error } = await supabase
      .from('events')
      .select(`
        *,
        place:places(
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
      `)
      .eq('id', id)
      .eq('is_published', true)
      .single();

    if (error) {
      console.error('Error fetching event:', error);
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      );
    }

    if (!event) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      );
    }

    // Format response
    const response = {
      ...event,
      // Map database column names to mobile-friendly names
      cover_image: event.cover_image_url,
      ticket_url: event.ticket_url,
      music_genre: event.genre,
      // Format place data
      place: event.place ? {
        id: event.place.id,
        name: event.place.name,
        category: event.place.place_type,
        address: event.place.address,
        city: event.place.city,
        latitude: event.place.lat,
        longitude: event.place.lon,
        cover_image: event.place.cover_image_url,
        price_range: event.place.price_range,
        verified: event.place.verification_status === 'approved',
      } : null,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error in event detail API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
