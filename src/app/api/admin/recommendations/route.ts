import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const source = searchParams.get('source');
    const entityType = searchParams.get('entityType');

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

    // Verify admin role
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Build query
    let query = supabase.from('daily_recommendations').select('*');

    if (startDate) {
      query = query.gte('featured_date', startDate);
    }
    if (endDate) {
      query = query.lte('featured_date', endDate);
    }
    if (source) {
      query = query.eq('source', source);
    }
    if (entityType) {
      query = query.eq('entity_type', entityType);
    }

    const { data: recommendations, error } = await query.order('featured_date', {
      ascending: false,
    });

    if (error) {
      console.error('Error fetching recommendations:', error);
      return NextResponse.json(
        { error: 'Failed to fetch recommendations' },
        { status: 500 }
      );
    }

    return NextResponse.json({ recommendations });
  } catch (error) {
    console.error('Get admin recommendations error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
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

    // Verify admin role
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { entityId, featuredDate, priority, reason } = body;

    if (!entityId || !featuredDate) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Check if recommendation already exists
    const { data: existing } = await supabase
      .from('daily_recommendations')
      .select('id')
      .eq('entity_type', 'event')
      .eq('entity_id', entityId)
      .eq('featured_date', featuredDate)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: 'Questo evento è già consigliato per questa data' },
        { status: 409 }
      );
    }

    // Create recommendation - always set entityType to 'event'
    const { data: recommendation, error } = await supabase
      .from('daily_recommendations')
      .insert({
        entity_type: 'event',
        entity_id: entityId,
        featured_date: featuredDate,
        source: 'admin',
        priority: priority || 0,
        reason: reason || null,
        created_by: user.id,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating recommendation:', error);
      
      // Handle duplicate key error (unique constraint violation)
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Questo evento è già consigliato per questa data' },
          { status: 409 }
        );
      }
      
      return NextResponse.json(
        { error: error.message || 'Errore nella creazione del consigliato' },
        { status: 500 }
      );
    }

    return NextResponse.json(recommendation, { status: 201 });
  } catch (error) {
    console.error('Create recommendation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
