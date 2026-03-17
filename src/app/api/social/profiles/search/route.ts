import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Get authenticated user (optional - for follow status)
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Get search query and limit from URL params with validation
    const searchParams = request.nextUrl.searchParams;
    const q = searchParams.get('q');

    // VALIDATION: Require search query and limit max length
    if (!q || q.trim().length === 0) {
      return NextResponse.json(
        { error: 'Search query required' },
        { status: 400 }
      );
    }

    if (q.length > 100) {
      return NextResponse.json(
        { error: 'Search query too long (max 100 characters)' },
        { status: 400 }
      );
    }

    // VALIDATION: Parse limit with fallback and max cap
    const limitParam = searchParams.get('limit') || '20';
    let limit = parseInt(limitParam);

    // Fallback to default if parseInt fails
    if (isNaN(limit)) {
      limit = 20;
    }

    // Cap maximum limit to prevent excessive results
    const MAX_LIMIT = 100;
    if (limit > MAX_LIMIT) {
      limit = MAX_LIMIT;
    }
    if (limit < 1) {
      limit = 1;
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

    // PERFORMANCE: Batch query for follow status only if user is logged in
    const profileIds = profiles.map(p => p.id);

    let followingSet = new Set<string>();
    if (profileIds.length > 0 && user) {
      const { data: followData, error: followError } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', user.id)
        .in('following_id', profileIds);

      if (!followError && followData) {
        followingSet = new Set(followData.map(f => f.following_id));
      }
    }

    // Enrich results with follow status from cached data
    const enrichedProfiles = profiles.map(profile => ({
      ...profile,
      isFollowing: followingSet.has(profile.id),
    }));

    return NextResponse.json(enrichedProfiles);
  } catch (error) {
    console.error('Profile search error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
