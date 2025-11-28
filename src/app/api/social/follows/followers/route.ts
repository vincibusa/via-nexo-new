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

    // Get userId from query params or default to current user
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('userId') || user.id;
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Get followers (users who follow this user)
    const { data: followers, error, count } = await supabase
      .from('follows')
      .select('follower_id, profiles(id, username, full_name, avatar_url, bio)', {
        count: 'exact',
      })
      .eq('following_id', userId)
      .range(offset, offset + limit - 1)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Fetch followers error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch followers' },
        { status: 500 }
      );
    }

    // Enrich with follow status for current user
    const enrichedFollowers = await Promise.all(
      followers.map(async (follow: any) => {
        const followerProfile = follow.profiles;

        // Check if current user follows this person
        const { data: followData } = await supabase
          .from('follows')
          .select('id')
          .eq('follower_id', user.id)
          .eq('following_id', followerProfile.id)
          .single();

        return {
          ...followerProfile,
          isFollowedByCurrentUser: !!followData,
        };
      })
    );

    return NextResponse.json({
      followers: enrichedFollowers,
      total: count,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Get followers error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
