import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { handleCorsPreflight, withCors } from '@/lib/cors';

export async function OPTIONS(request: NextRequest) {
  const preflightResponse = handleCorsPreflight(request)
  if (preflightResponse) {
    return preflightResponse
  }
  return new Response(null, { status: 204 })
}

export async function GET(request: NextRequest) {
  // Handle CORS preflight
  const preflightResponse = handleCorsPreflight(request)
  if (preflightResponse) {
    return preflightResponse
  }
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);

    // Pagination
    const limit = parseInt(searchParams.get('limit') || '20');
    const cursor = searchParams.get('cursor') || null;

    // Search
    const search = searchParams.get('search') || '';

    // Filters
    const category = searchParams.get('category') || '';
    const priceRange = searchParams.get('price_range') || '';
    const verified = searchParams.get('verified');
    const hasEvents = searchParams.get('has_events');

    // Location for distance calculation
    const lat = searchParams.get('lat');
    const lon = searchParams.get('lon');
    const maxDistance = searchParams.get('max_distance_km');

    // Sort
    const sortBy = searchParams.get('sort') || 'name'; // name, distance, events_count

    // Build query
    let query = supabase
      .from('places')
      .select(
        `
        id,
        name,
        place_type,
        description,
        cover_image_url,
        address,
        city,
        postal_code,
        lat,
        lon,
        phone,
        website,
        instagram_handle,
        facebook_url,
        price_range,
        ambience_tags,
        music_genre,
        capacity,
        opening_hours,
        verification_status,
        is_published,
        is_listed,
        events:events(count)
      `,
        { count: 'exact' }
      )
      .eq('is_published', true)
      .eq('is_listed', true);

    // Apply search
    if (search) {
      query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%,city.ilike.%${search}%`);
    }

    // Apply category filter
    if (category) {
      query = query.eq('place_type', category);
    }

    // Apply price range filter
    if (priceRange) {
      query = query.eq('price_range', priceRange);
    }

    // Apply verified filter
    if (verified !== null && verified !== undefined) {
      query = query.eq('verified', verified === 'true');
    }

    // Apply cursor pagination
    if (cursor) {
      query = query.gt('id', cursor);
    }

    // Fetch data
    query = query.order('id', { ascending: true }).limit(limit + 1);

    const { data: places, error, count } = await query;

    if (error) {
      console.error('Error fetching places:', error);
      return withCors(
        request,
        NextResponse.json({ error: 'Failed to fetch places' }, { status: 500 })
      )
    }

    if (!places) {
      return withCors(
        request,
        NextResponse.json({ data: [], nextCursor: null, hasMore: false, total: 0 })
      )
    }

    // Determine if there are more results
    const hasMore = places.length > limit;
    const results = hasMore ? places.slice(0, limit) : places;
    const nextCursor = hasMore ? results[results.length - 1].id : null;

    // Calculate distance if location provided
    let processedResults = results.map((place: any) => {
      const eventsCount = place.events?.[0]?.count || 0;

      const result: any = {
        ...place,
        // Map database fields to mobile-friendly names
        category: place.place_type,
        cover_image: place.cover_image_url,
        instagram: place.instagram_handle,
        facebook: place.facebook_url,
        verified: place.verification_status === 'approved',
        latitude: place.lat,
        longitude: place.lon,
        events_count: eventsCount,
      };

      // Remove database-specific fields
      delete result.events;
      delete result.place_type;
      delete result.cover_image_url;
      delete result.instagram_handle;
      delete result.facebook_url;
      delete result.verification_status;
      delete result.lat;
      delete result.lon;

      // Calculate distance if lat/lon provided
      if (lat && lon && place.lat && place.lon) {
        const distance = calculateDistance(
          parseFloat(lat),
          parseFloat(lon),
          place.lat,
          place.lon
        );
        result.distance_km = parseFloat(distance.toFixed(2));
      }

      return result;
    });

    // Filter by max distance if specified
    if (maxDistance && lat && lon) {
      const maxDist = parseFloat(maxDistance);
      processedResults = processedResults.filter(
        (place: any) => place.distance_km !== undefined && place.distance_km <= maxDist
      );
    }

    // Filter by has_events if specified
    if (hasEvents === 'true') {
      processedResults = processedResults.filter((place: any) => place.events_count > 0);
    }

    // Sort results
    if (sortBy === 'distance' && lat && lon) {
      processedResults.sort((a: any, b: any) => {
        const distA = a.distance_km ?? Infinity;
        const distB = b.distance_km ?? Infinity;
        return distA - distB;
      });
    } else if (sortBy === 'events_count') {
      processedResults.sort((a: any, b: any) => b.events_count - a.events_count);
    } else if (sortBy === 'name') {
      processedResults.sort((a: any, b: any) => a.name.localeCompare(b.name));
    }

    return withCors(
      request,
      NextResponse.json({
        data: processedResults,
        nextCursor,
        hasMore,
        total: count || 0,
      })
    )
  } catch (error) {
    console.error('Unexpected error fetching places:', error);
    return withCors(
      request,
      NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    )
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
