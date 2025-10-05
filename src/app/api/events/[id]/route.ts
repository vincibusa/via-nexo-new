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
          category,
          address,
          city,
          latitude,
          longitude,
          cover_image_url,
          price_range,
          verified
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
      ticket_url: event.ticket_link,
      // Format place data
      place: event.place ? {
        ...event.place,
        cover_image: event.place.cover_image_url,
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
