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

    // Get list of users the current user follows
    const { data: followingData } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', user.id);

    if (!followingData || followingData.length === 0) {
      return NextResponse.json([]);
    }

    const followingIds = followingData.map((f) => f.following_id);

    // Also include current user's stories
    const userIds = [user.id, ...followingIds];

    // Get stories from followed users (grouped by user)
    const { data: stories, error } = await supabase
      .from('stories')
      .select(
        `
        id,
        user_id,
        media_url,
        media_type,
        text_overlay,
        place_id,
        created_at,
        expires_at,
        profiles(id, display_name, avatar_url)
      `
      )
      .in('user_id', userIds)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Fetch following stories error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch stories' },
        { status: 500 }
      );
    }

    // Group stories by user
    const storyGroups = stories.reduce((acc: any, story: any) => {
      const userId = story.user_id;
      const existingGroup = acc.find((g: any) => g.user_id === userId);

      if (existingGroup) {
        existingGroup.stories.push(story);
      } else {
        acc.push({
          user_id: userId,
          user: story.profiles,
          stories: [story],
        });
      }

      return acc;
    }, []);

    // For each story group, check which stories the current user has viewed
    const enrichedGroups = await Promise.all(
      storyGroups.map(async (group: any) => {
        const { data: viewedStories } = await supabase
          .from('story_views')
          .select('story_id')
          .eq('user_id', user.id)
          .in('story_id', group.stories.map((s: any) => s.id));

        const viewedStoryIds = new Set(
          viewedStories?.map((v) => v.story_id) || []
        );

        return {
          ...group,
          stories: group.stories.map((s: any) => ({
            ...s,
            is_viewed: viewedStoryIds.has(s.id),
          })),
          has_unseen: group.stories.some((s: any) => !viewedStoryIds.has(s.id)),
        };
      })
    );

    return NextResponse.json(enrichedGroups);
  } catch (error) {
    console.error('Get following stories error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
