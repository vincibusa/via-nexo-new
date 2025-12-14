import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);

    // Pagination
    const limit = parseInt(searchParams.get('limit') || '20');
    const cursor = searchParams.get('cursor') || null;

    // Search
    const search = searchParams.get('search') || '';

    // Filters
    const eventType = searchParams.get('event_type') || '';
    const musicGenre = searchParams.get('music_genre') || '';
    const ticketAvailability = searchParams.get('ticket_availability') || '';
    const priceMin = searchParams.get('price_min');
    const priceMax = searchParams.get('price_max');
    const timeFilter = searchParams.get('time_filter') || 'upcoming'; // upcoming, today, this_week, this_weekend, this_month

    // Location for distance calculation
    const lat = searchParams.get('lat');
    const lon = searchParams.get('lon');
    const maxDistance = searchParams.get('max_distance_km');

    // Sort
    const sortBy = searchParams.get('sort') || 'date'; // date, distance, price

    // Build query
    let query = supabase
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
        lineup,
        genre,
        ticket_price_min,
        ticket_price_max,
        ticket_url,
        is_published,
        place:place_id (
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
      `,
        { count: 'exact' }
      )
      .not('place_id', 'is', null)
      .eq('is_published', true);

    // Apply time filter
    const now = new Date();
    if (timeFilter === 'upcoming') {
      query = query.gte('start_datetime', now.toISOString());
    } else if (timeFilter === 'today') {
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);
      query = query
        .gte('start_datetime', now.toISOString())
        .lte('start_datetime', endOfDay.toISOString());
    } else if (timeFilter === 'this_week') {
      const endOfWeek = new Date(now);
      endOfWeek.setDate(now.getDate() + (7 - now.getDay()));
      endOfWeek.setHours(23, 59, 59, 999);
      query = query
        .gte('start_datetime', now.toISOString())
        .lte('start_datetime', endOfWeek.toISOString());
    } else if (timeFilter === 'this_weekend') {
      const daysUntilFriday = (5 - now.getDay() + 7) % 7;
      const friday = new Date(now);
      friday.setDate(now.getDate() + daysUntilFriday);
      friday.setHours(0, 0, 0, 0);

      const sunday = new Date(friday);
      sunday.setDate(friday.getDate() + 2);
      sunday.setHours(23, 59, 59, 999);

      query = query
        .gte('start_datetime', friday.toISOString())
        .lte('start_datetime', sunday.toISOString());
    } else if (timeFilter === 'this_month') {
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      query = query
        .gte('start_datetime', now.toISOString())
        .lte('start_datetime', endOfMonth.toISOString());
    }

    // Apply search
    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    // Apply event type filter
    if (eventType) {
      query = query.eq('event_type', eventType);
    }

    // Apply music genre filter
    if (musicGenre) {
      query = query.contains('genre', [musicGenre]);
    }

    // Apply price filters
    if (priceMin) {
      query = query.gte('ticket_price_min', parseFloat(priceMin));
    }
    if (priceMax) {
      query = query.lte('ticket_price_max', parseFloat(priceMax));
    }

    // Apply cursor pagination
    if (cursor) {
      query = query.gt('id', cursor);
    }

    // Fetch data
    query = query.order('id', { ascending: true }).limit(limit + 1);

    const { data: events, error, count } = await query;

    if (error) {
      console.error('Error fetching events:', error);
      return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
    }

    if (!events) {
      return NextResponse.json({ data: [], nextCursor: null, hasMore: false, total: 0 });
    }

    // Determine if there are more results
    const hasMore = events.length > limit;
    const results = hasMore ? events.slice(0, limit) : events;
    const nextCursor = hasMore ? results[results.length - 1].id : null;

    // Calculate distance if location provided
    let processedResults = results.map((event: any) => {
      const result: any = {
        ...event,
        // Map database fields to mobile-friendly names
        cover_image: event.cover_image_url,
        music_genre: event.genre,
      };

      // Remove database-specific fields
      delete result.cover_image_url;
      delete result.genre;
      delete result.is_published;

      // Map place fields
      if (result.place) {
        result.place = {
          ...result.place,
          category: result.place.place_type,
          cover_image: result.place.cover_image_url,
          verified: result.place.verification_status === 'approved',
          latitude: result.place.lat,
          longitude: result.place.lon,
        };

        delete result.place.place_type;
        delete result.place.cover_image_url;
        delete result.place.verification_status;
        delete result.place.lat;
        delete result.place.lon;
      }

      // Calculate distance if lat/lon provided and place has coordinates
      if (lat && lon && result.place?.latitude && result.place?.longitude) {
        const distance = calculateDistance(
          parseFloat(lat),
          parseFloat(lon),
          result.place.latitude,
          result.place.longitude
        );
        result.distance_km = parseFloat(distance.toFixed(2));
      }

      return result;
    });

    // Filter by max distance if specified
    if (maxDistance && lat && lon) {
      const maxDist = parseFloat(maxDistance);
      processedResults = processedResults.filter(
        (event: any) => event.distance_km !== undefined && event.distance_km <= maxDist
      );
    }

    // Sort results
    if (sortBy === 'date') {
      processedResults.sort(
        (a: any, b: any) =>
          new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime()
      );
    } else if (sortBy === 'distance' && lat && lon) {
      processedResults.sort((a: any, b: any) => {
        const distA = a.distance_km ?? Infinity;
        const distB = b.distance_km ?? Infinity;
        return distA - distB;
      });
    } else if (sortBy === 'price') {
      processedResults.sort((a: any, b: any) => {
        const priceA = a.ticket_price_min ?? Infinity;
        const priceB = b.ticket_price_min ?? Infinity;
        return priceA - priceB;
      });
    }

    return NextResponse.json({
      data: processedResults,
      nextCursor,
      hasMore,
      total: count || 0,
    });
  } catch (error) {
    console.error('Unexpected error fetching events:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Calculate distance between two coordinates using Haversine formula
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return distance;
}

function toRad(degrees: number): number {
  return degrees * (Math.PI / 180);
}
