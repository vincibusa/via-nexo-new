import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

interface SwipeRequest {
  recommendation_id: string;
  action_type: 'like' | 'pass';
  featured_date: string;
  event_id?: string;
  event_type?: string;
  event_genre?: string[];
  place_id?: string;
  place_type?: string;
}

export async function POST(request: NextRequest) {
  try {
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

    // Parse request body
    const body: SwipeRequest = await request.json();
    const {
      recommendation_id,
      action_type,
      featured_date,
      event_id,
      event_type,
      event_genre,
      place_id,
      place_type,
    } = body;

    // Validate required fields
    if (!recommendation_id || !action_type || !featured_date) {
      return NextResponse.json(
        { error: 'Missing required fields: recommendation_id, action_type, featured_date' },
        { status: 400 }
      );
    }

    if (!['like', 'pass'].includes(action_type)) {
      return NextResponse.json({ error: 'Invalid action_type. Must be "like" or "pass"' }, { status: 400 });
    }

    // Upsert swipe (handle duplicates with UNIQUE constraint)
    const { data: swipe, error: swipeError } = await supabase
      .from('user_daily_swipes')
      .upsert(
        {
          user_id: user.id,
          recommendation_id,
          action_type,
          featured_date,
          event_id,
          event_type,
          event_genre,
          place_id,
          place_type,
          swiped_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,recommendation_id' }
      )
      .select()
      .single();

    if (swipeError) {
      console.error('Error saving swipe:', swipeError);
      return NextResponse.json({ error: 'Failed to save swipe', details: swipeError.message }, { status: 500 });
    }

    // If liked, also add to favorites
    if (action_type === 'like' && event_id) {
      const { error: favoriteError } = await supabase
        .from('favorites')
        .upsert(
          {
            user_id: user.id,
            entity_type: 'event',
            entity_id: event_id,
          },
          { onConflict: 'user_id,entity_type,entity_id' }
        );

      if (favoriteError) {
        console.error('Error adding to favorites:', favoriteError);
        // Don't fail the request if favorites fails, swipe is still saved
      }
    }

    // Check completion status using the database function
    const { data: completionData, error: completionError } = await supabase.rpc('check_daily_completion', {
      p_user_id: user.id,
      p_date: featured_date,
    });

    if (completionError) {
      console.error('Error checking completion:', completionError);
    }

    return NextResponse.json({
      success: true,
      swipe: {
        id: swipe.id,
        action_type: swipe.action_type,
        swiped_at: swipe.swiped_at,
      },
      completion_status: completionData || {
        completed: false,
        total_recommendations: 0,
        total_swiped: 0,
        remaining: 0,
      },
    });
  } catch (error) {
    console.error('POST /api/recommendations/daily/swipe error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
