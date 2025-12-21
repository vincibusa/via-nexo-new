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

    // Check if there are any valid recommendations for the requested date
    // Need to filter out past events
    const { data: recommendations, error } = await supabase
      .from('daily_recommendations')
      .select('id, entity_type, entity_id')
      .eq('featured_date', date);

    if (error) {
      console.error('Error checking recommendations:', error);
      return NextResponse.json(
        { hasRecommendations: false, count: 0 },
        { status: 200 }
      );
    }

    // Filter out past events
    let validCount = 0;
    for (const rec of recommendations || []) {
      if (rec.entity_type === 'place') {
        validCount++;
      } else if (rec.entity_type === 'event') {
        // Check if event is still in the future
        const { data: event } = await supabase
          .from('events')
          .select('start_datetime')
          .eq('id', rec.entity_id)
          .single();

        if (event && new Date(event.start_datetime) > new Date()) {
          validCount++;
        }
      }
    }

    return NextResponse.json({
      hasRecommendations: validCount > 0,
      count: validCount,
      date,
    });
  } catch (error) {
    console.error('Check recommendations error:', error);
    return NextResponse.json(
      { hasRecommendations: false, count: 0 },
      { status: 200 }
    );
  }
}
