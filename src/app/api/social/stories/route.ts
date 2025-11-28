import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
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

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user_id from query params if provided
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');

    // Build query
    let query = supabase
      .from('stories')
      .select('id, user_id, media_url, media_type, text_overlay, place_id, created_at, expires_at, profiles(id, display_name, avatar_url)')
      .gt('expires_at', new Date().toISOString());

    // Filter by user_id if provided
    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data: stories, error } = await query.order('created_at', { ascending: false });

    if (error) {
      console.error('Fetch stories error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch stories' },
        { status: 500 }
      );
    }

    return NextResponse.json(stories);
  } catch (error) {
    console.error('Get stories error:', error);
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

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      media_url,
      media_type = 'image',
      text_overlay,
      place_id,
    } = body;

    if (!media_url) {
      return NextResponse.json(
        { error: 'media_url is required' },
        { status: 400 }
      );
    }

    // Create story
    const { data: story, error } = await supabase
      .from('stories')
      .insert({
        user_id: user.id,
        media_url,
        media_type,
        text_overlay,
        place_id,
      })
      .select('id, user_id, media_url, media_type, text_overlay, place_id, created_at, expires_at')
      .single();

    if (error) {
      console.error('Create story error:', error);
      return NextResponse.json(
        { error: 'Failed to create story' },
        { status: 500 }
      );
    }

    return NextResponse.json(story, { status: 201 });
  } catch (error) {
    console.error('Create story error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
