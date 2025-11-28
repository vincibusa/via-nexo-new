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

    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type') || 'all'; // taste|events|popular|all
    const limit = parseInt(searchParams.get('limit') || '10');

    let suggestions = [];

    if (type === 'taste' || type === 'all') {
      // Get users with similar tastes using embedding similarity
      // This requires pgvector extension and embedding functions
      const { data: tasteSuggestions, error: tasteError } = await supabase.rpc(
        'find_similar_taste_users',
        {
          user_id: user.id,
          limit: limit,
        }
      );

      if (!tasteError && tasteSuggestions) {
        suggestions = tasteSuggestions.map((s: any) => ({
          ...s,
          suggestionReason: 'Gusti simili ai tuoi',
        }));
      }
    }

    if (type === 'events' || (type === 'all' && suggestions.length < limit)) {
      // Get users attending same events
      const { data: eventSuggestions } = await supabase
        .from('event_attendance')
        .select('user_id')
        .eq('event_id', supabase.from('event_attendance').select('event_id').eq('user_id', user.id))
        .neq('user_id', user.id)
        .limit(limit - suggestions.length);

      // This is a simplified approach - in production, use proper subqueries
      const { data: eventUsers } = await supabase
        .from('profiles')
        .select('id, username, full_name, avatar_url, bio')
        .limit(limit - suggestions.length);

      if (eventUsers) {
        const eventUserSuggestions = eventUsers.map((u) => ({
          ...u,
          suggestionReason: 'Presenti agli stessi eventi',
        }));
        suggestions = [...suggestions, ...eventUserSuggestions];
      }
    }

    if (type === 'popular' || (type === 'all' && suggestions.length < limit)) {
      // Get popular users (by followers count)
      const { data: popularUsers } = await supabase
        .from('profiles')
        .select('id, username, full_name, avatar_url, bio')
        .range(0, limit - suggestions.length - 1)
        .order('followers_count', { ascending: false });

      if (popularUsers) {
        const popularSuggestions = popularUsers.map((u) => ({
          ...u,
          suggestionReason: 'Utenti popolari',
        }));
        suggestions = [...suggestions, ...popularSuggestions];
      }
    }

    // Remove already followed users and current user
    const { data: followedUsers } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', user.id);

    const followedIds = new Set(followedUsers?.map((f) => f.following_id) || []);
    followedIds.add(user.id);

    const filteredSuggestions = suggestions
      .filter((s: { id: string }) => !followedIds.has(s.id))
      .slice(0, limit);

    // Add follow status
    const enrichedSuggestions = filteredSuggestions.map((s: { id: string }) => ({
      ...s,
      isFollowing: false,
    }));

    return NextResponse.json(enrichedSuggestions);
  } catch (error) {
    console.error('Follow suggestions error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
