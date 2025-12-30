import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];

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

    // Validate authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all swipes for the user and date
    const { data: swipes, error: swipesError } = await supabase
      .from('user_daily_swipes')
      .select('*')
      .eq('user_id', user.id)
      .eq('featured_date', date)
      .order('swiped_at', { ascending: true });

    if (swipesError) {
      console.error('Error fetching swipes:', swipesError);
      return NextResponse.json({ error: 'Failed to fetch swipes' }, { status: 500 });
    }

    // Enrich swipes with event details
    const enrichedSwipes = [];
    for (const swipe of swipes || []) {
      const enriched = { ...swipe };

      // If the swipe has an event_id, fetch event details
      if (swipe.event_id) {
        const { data: event } = await supabase
          .from('events')
          .select('id, title, cover_image_url, start_datetime, description')
          .eq('id', swipe.event_id)
          .single();

        if (event) {
          enriched.event = event;
        }
      }

      // If the swipe has a place_id, fetch place details
      if (swipe.place_id) {
        const { data: place } = await supabase
          .from('places')
          .select('id, name, cover_image_url, city, place_type')
          .eq('id', swipe.place_id)
          .single();

        if (place) {
          enriched.place = place;
        }
      }

      enrichedSwipes.push(enriched);
    }

    // Check completion status
    const { data: completionData, error: completionError } = await supabase.rpc('check_daily_completion', {
      p_user_id: user.id,
      p_date: date,
    });

    if (completionError) {
      console.error('Error checking completion:', completionError);
    }

    return NextResponse.json({
      swipes: enrichedSwipes,
      completion_status: completionData || {
        completed: false,
        total_recommendations: 0,
        total_swiped: 0,
        remaining: 0,
      },
    });
  } catch (error) {
    console.error('GET /api/recommendations/daily/swipes error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
