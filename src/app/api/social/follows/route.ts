import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createNotification } from '@/lib/services/notifications';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const type = searchParams.get('type') as 'followers' | 'following' || 'followers';
    const offset = parseInt(searchParams.get('offset') || '0');
    const limit = parseInt(searchParams.get('limit') || '20');

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

    if (!userId) {
      return NextResponse.json(
        { error: 'userId parameter required' },
        { status: 400 }
      );
    }

    let query;

    if (type === 'following') {
      // Get users that userId is following
      query = supabase
        .from('follows')
        .select(
          `
          following_id,
          profile:profiles!following_id(*)
        `
        )
        .eq('follower_id', userId);
    } else {
      // Get users that follow userId
      query = supabase
        .from('follows')
        .select(
          `
          follower_id,
          profile:profiles!follower_id(*)
        `
        )
        .eq('following_id', userId);
    }

    const { data: follows, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching follows:', error);
      return NextResponse.json(
        { error: 'Failed to fetch follows' },
        { status: 500 }
      );
    }

    // Get current user's following list
    const { data: userFollows } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', user.id);

    const followingIds = new Set(userFollows?.map((f: any) => f.following_id) || []);

    // Enrich with follow status
    const enrichedFollows = follows?.map((item: any) => {
      const profile = type === 'following' ? item.profile : item.profile;
      return {
        ...profile,
        is_followed: followingIds.has(profile.id),
      };
    }) || [];

    return NextResponse.json(enrichedFollows);
  } catch (error) {
    console.error('Get follows error:', error);
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
    const { followingId } = body;

    if (!followingId) {
      return NextResponse.json(
        { error: 'followingId is required' },
        { status: 400 }
      );
    }

    if (followingId === user.id) {
      return NextResponse.json(
        { error: 'Cannot follow yourself' },
        { status: 400 }
      );
    }

    // Check if already following
    const { data: existingFollow } = await supabase
      .from('follows')
      .select('id')
      .eq('follower_id', user.id)
      .eq('following_id', followingId)
      .single();

    if (existingFollow) {
      return NextResponse.json(
        { error: 'Already following' },
        { status: 409 }
      );
    }

    // Create follow
    const { error } = await supabase
      .from('follows')
      .insert({
        follower_id: user.id,
        following_id: followingId,
      });

    if (error) {
      console.error('Error following user:', error);
      return NextResponse.json(
        { error: 'Failed to follow user' },
        { status: 500 }
      );
    }

    // Create notification for the followed user
    try {
      await createNotification({
        user_id: followingId,
        actor_id: user.id,
        type: 'new_follower',
        entity_type: 'user',
        entity_id: user.id,
        content: `${user.id} ti ha iniziato a seguire`,
        metadata: {
          follower_id: user.id,
          following_id: followingId
        }
      });
    } catch (notificationError) {
      // Log but don't fail the follow operation
      console.warn('Failed to create follow notification:', notificationError);
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error('Follow user error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const followingId = searchParams.get('followingId');

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

    if (!followingId) {
      return NextResponse.json(
        { error: 'followingId parameter required' },
        { status: 400 }
      );
    }

    // Delete follow
    const { error } = await supabase
      .from('follows')
      .delete()
      .eq('follower_id', user.id)
      .eq('following_id', followingId);

    if (error) {
      console.error('Error unfollowing user:', error);
      return NextResponse.json(
        { error: 'Failed to unfollow user' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Unfollow user error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
