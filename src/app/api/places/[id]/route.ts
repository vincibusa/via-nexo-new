import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Get user location from query params for distance calculation (optional)
    const { searchParams } = new URL(request.url);
    const userLat = searchParams.get('lat');
    const userLon = searchParams.get('lon');

    // Build query
    let query = supabase
      .from('places')
      .select(`
        *,
        events:events(
          id,
          title,
          event_type,
          start_datetime,
          end_datetime,
          cover_image_url,
          ticket_price_min,
          ticket_price_max,
          is_published
        )
      `)
      .eq('id', id)
      .eq('is_published', true)
      .single();

    const { data: place, error } = await query;

    if (error) {
      console.error('Error fetching place:', error);
      return NextResponse.json(
        { error: 'Place not found' },
        { status: 404 }
      );
    }

    if (!place) {
      return NextResponse.json(
        { error: 'Place not found' },
        { status: 404 }
      );
    }

    // Calculate distance if user location provided
    let distance_km;
    if (userLat && userLon) {
      const { data: distanceData } = await supabase.rpc('calculate_distance', {
        lat1: parseFloat(userLat),
        lon1: parseFloat(userLon),
        lat2: place.latitude,
        lon2: place.longitude,
      });
      distance_km = distanceData;
    }

    // Filter only published future events and sort by date
    const futureEvents = (place.events || [])
      .filter((event: any) => {
        if (!event.is_published) return false;
        const eventDate = new Date(event.start_datetime);
        return eventDate >= new Date();
      })
      .sort((a: any, b: any) => {
        return new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime();
      })
      .slice(0, 5); // Limit to 5 upcoming events

    // Format response
    const response = {
      ...place,
      distance_km,
      events: futureEvents,
      // Map database column names to mobile-friendly names
      cover_image: place.cover_image_url,
      gallery_images: place.image_urls || [],
      instagram: place.instagram_handle,
      facebook: place.facebook_url,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error in place detail API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
