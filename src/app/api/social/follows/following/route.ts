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

    // Get following (users that this user follows)
    const { data: following, error, count } = await supabase
      .from('follows')
      .select('following_id, profiles!follows_following_id_fkey(id, display_name, avatar_url, bio, email)', {
        count: 'exact',
      })
      .eq('follower_id', userId)
      .range(offset, offset + limit - 1)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Fetch following error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch following' },
        { status: 500 }
      );
    }

    // Enrich with follow status for current user
    const enrichedFollowing = await Promise.all(
      following.map(async (follow: any) => {
        const followingProfile = follow.profiles;

        // Check if current user follows this person
        const { data: followData } = await supabase
          .from('follows')
          .select('id')
          .eq('follower_id', user.id)
          .eq('following_id', followingProfile.id)
          .single();

        return {
          id: followingProfile.id,
          display_name: followingProfile.display_name || followingProfile.email?.split('@')[0] || 'Utente',
          email: followingProfile.email,
          avatar_url: followingProfile.avatar_url,
          bio: followingProfile.bio,
          isFollowedByCurrentUser: !!followData,
        };
      })
    );

    return NextResponse.json(enrichedFollowing);
  } catch (error) {
    console.error('Get following error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
