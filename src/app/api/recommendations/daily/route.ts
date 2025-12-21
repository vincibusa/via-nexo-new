import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

interface DailyRecommendation {
  id: string;
  entity_type: 'place' | 'event';
  entity_id: string;
  featured_date: string;
  source: 'automatic' | 'admin';
  priority: number;
  score: number | null;
  reason: string | null;
  place?: {
    id: string;
    name: string;
    cover_image_url?: string;
    city: string;
    place_type: string;
  };
  event?: {
    id: string;
    title: string;
    cover_image_url?: string;
    start_datetime: string;
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
    const city = searchParams.get('city');

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

    // Fetch daily recommendations with related data
    let query = supabase
      .from('daily_recommendations')
      .select('*')
      .eq('featured_date', date)
      .order('priority', { ascending: false })
      .order('score', { ascending: false, nullsFirst: false });

    const { data: recommendations, error } = await query;

    if (error) {
      console.error('Error fetching recommendations:', error);
      return NextResponse.json(
        { recommendations: [], hasRecommendations: false },
        { status: 200 }
      );
    }

    // Fetch related place and event data
    const enrichedRecommendations: DailyRecommendation[] = [];

    for (const rec of recommendations || []) {
      const enriched: DailyRecommendation = {
        ...rec,
        entity_type: rec.entity_type as 'place' | 'event',
        source: rec.source as 'automatic' | 'admin',
      };

      if (rec.entity_type === 'place') {
        const { data: place } = await supabase
          .from('places')
          .select('id, name, cover_image_url, city, place_type')
          .eq('id', rec.entity_id)
          .single();

        if (place && (!city || place.city === city)) {
          enriched.place = place;
          enrichedRecommendations.push(enriched);
        }
      } else if (rec.entity_type === 'event') {
        const { data: event } = await supabase
          .from('events')
          .select('id, title, cover_image_url, start_datetime')
          .eq('id', rec.entity_id)
          .single();

        // Only include events that are still in the future
        if (event && new Date(event.start_datetime) > new Date()) {
          enriched.event = event;
          enrichedRecommendations.push(enriched);
        }
      }
    }

    return NextResponse.json({
      recommendations: enrichedRecommendations,
      hasRecommendations: enrichedRecommendations.length > 0,
      count: enrichedRecommendations.length,
      date,
    });
  } catch (error) {
    console.error('Get daily recommendations error:', error);
    return NextResponse.json(
      { recommendations: [], hasRecommendations: false },
      { status: 200 }
    );
  }
}
