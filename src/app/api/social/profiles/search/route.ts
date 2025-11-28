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

    // Get search query and limit from URL params
    const searchParams = request.nextUrl.searchParams;
    const q = searchParams.get('q');
    const limit = parseInt(searchParams.get('limit') || '20');

    if (!q || q.trim().length === 0) {
      return NextResponse.json({ error: 'Search query required' }, { status: 400 });
    }

    // Search profiles by display_name or email (case-insensitive)
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, display_name, email, avatar_url, bio')
      .or(
        `display_name.ilike.%${q}%,email.ilike.%${q}%`
      )
      .limit(limit);

    if (error) {
      console.error('Search profiles error:', error);
      return NextResponse.json(
        { error: 'Search failed' },
        { status: 500 }
      );
    }

    // Enrich results with follow status for current user
    const enrichedProfiles = await Promise.all(
      profiles.map(async (profile) => {
        const { data: followData } = await supabase
          .from('follows')
          .select('id')
          .eq('follower_id', user.id)
          .eq('following_id', profile.id)
          .single();

        return {
          ...profile,
          isFollowing: !!followData,
        };
      })
    );

    return NextResponse.json(enrichedProfiles);
  } catch (error) {
    console.error('Profile search error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
