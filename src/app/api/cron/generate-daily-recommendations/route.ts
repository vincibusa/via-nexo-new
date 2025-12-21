import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const maxDuration = 60; // Allow up to 60 seconds for this function

interface PlaceScore {
  id: string;
  name: string;
  city: string;
  score: number;
  suggestions_count: number;
  favorites_count: number;
}

interface EventScore {
  id: string;
  title: string;
  city: string;
  score: number;
  start_datetime: string;
}

export async function POST(request: NextRequest) {
  try {
    // Verify Vercel Cron secret
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: () => {},
        },
      }
    );

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDate = tomorrow.toISOString().split('T')[0];

    // Check if we already have recommendations for tomorrow
    const { data: existingRecs } = await supabase
      .from('daily_recommendations')
      .select('id')
      .eq('featured_date', tomorrowDate)
      .limit(1);

    if (existingRecs && existingRecs.length > 0) {
      return NextResponse.json({
        message: 'Recommendations for tomorrow already exist',
        date: tomorrowDate,
      });
    }

    // Get top places by engagement metrics
    const { data: topPlaces, error: placesError } = await supabase
      .from('places')
      .select('id, name, city, suggestions_count, favorites_count')
      .eq('is_published', true)
      .eq('is_listed', true)
      .order('suggestions_count', { ascending: false })
      .order('favorites_count', { ascending: false })
      .limit(200);

    if (placesError) {
      console.error('Error fetching places:', placesError);
      return NextResponse.json({ error: 'Failed to fetch places' }, { status: 500 });
    }

    // Calculate place scores and select top ones
    const scoredPlaces: PlaceScore[] = (topPlaces || []).map((place: any) => ({
      ...place,
      score:
        (place.suggestions_count || 0) * 0.4 +
        (place.favorites_count || 0) * 0.6,
    }));

    const topScoredPlaces = scoredPlaces
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    // Get top upcoming events
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const { data: upcomingEvents, error: eventsError } = await supabase
      .from('events')
      .select(
        `id, title, city:places(city), start_datetime,
        attendance_count, interested_count, favorites_count`
      )
      .eq('is_published', true)
      .eq('is_listed', true)
      .gte('start_datetime', now.toISOString())
      .lte('start_datetime', nextWeek.toISOString())
      .order('start_datetime', { ascending: true })
      .limit(100);

    if (eventsError) {
      console.error('Error fetching events:', eventsError);
      return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
    }

    // Calculate event scores and select top ones
    const scoredEvents: EventScore[] = (upcomingEvents || [])
      .map((event: any) => ({
        id: event.id,
        title: event.title,
        city: event.city?.city || 'Unknown',
        start_datetime: event.start_datetime,
        score:
          (event.attendance_count || 0) * 0.3 +
          (event.interested_count || 0) * 0.3 +
          (event.favorites_count || 0) * 0.2 +
          0.2, // Base for upcoming events
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    // Insert recommendations (only if not already created by admin)
    const recommendationsToInsert = [
      ...topScoredPlaces.map((place) => ({
        entity_type: 'place' as const,
        entity_id: place.id,
        featured_date: tomorrowDate,
        source: 'automatic' as const,
        score: place.score,
        reason: `Popular per stasera (${Math.round(place.suggestions_count)} suggerimenti)`,
        priority: 0,
      })),
      ...scoredEvents.map((event) => ({
        entity_type: 'event' as const,
        entity_id: event.id,
        featured_date: tomorrowDate,
        source: 'automatic' as const,
        score: event.score,
        reason: `Evento trending (${Math.round(event.score)} punti)`,
        priority: 0,
      })),
    ];

    const { data: inserted, error: insertError } = await supabase
      .from('daily_recommendations')
      .insert(recommendationsToInsert)
      .select('id');

    if (insertError) {
      console.error('Error inserting recommendations:', insertError);
      return NextResponse.json(
        { error: 'Failed to insert recommendations' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      date: tomorrowDate,
      placed_count: topScoredPlaces.length,
      events_count: scoredEvents.length,
      total_inserted: inserted?.length || 0,
    });
  } catch (error) {
    console.error('Cron job error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
