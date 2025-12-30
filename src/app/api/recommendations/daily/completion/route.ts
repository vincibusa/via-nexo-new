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

    // Check completion status using the database function
    const { data: completionData, error: completionError } = await supabase.rpc('check_daily_completion', {
      p_user_id: user.id,
      p_date: date,
    });

    if (completionError) {
      console.error('Error checking completion:', completionError);
      return NextResponse.json({ error: 'Failed to check completion status' }, { status: 500 });
    }

    // If completed, fetch liked events
    let likedEvents: Array<{ id: string; title: string; cover_image_url: string | null; start_datetime: string }> = [];
    if (completionData?.completed) {
      // Get all likes for this date
      const { data: swipes, error: swipesError } = await supabase
        .from('user_daily_swipes')
        .select('event_id')
        .eq('user_id', user.id)
        .eq('featured_date', date)
        .eq('action_type', 'like')
        .not('event_id', 'is', null);

      if (!swipesError && swipes && swipes.length > 0) {
        // Fetch event details for liked events
        const eventIds = swipes.map((s) => s.event_id);
        const { data: events } = await supabase
          .from('events')
          .select('id, title, cover_image_url, start_datetime')
          .in('id', eventIds)
          .order('start_datetime', { ascending: true });

        likedEvents = events || [];
      }
    }

    return NextResponse.json({
      completed: completionData?.completed || false,
      total_recommendations: completionData?.total_recommendations || 0,
      total_swiped: completionData?.total_swiped || 0,
      remaining: completionData?.remaining || 0,
      liked_events: likedEvents,
    });
  } catch (error) {
    console.error('GET /api/recommendations/daily/completion error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
