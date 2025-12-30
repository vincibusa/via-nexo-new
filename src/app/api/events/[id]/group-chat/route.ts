import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    // Check if event group chat exists
    const { data: eventGroupChat, error: chatError } = await supabase
      .from('event_group_chats')
      .select('id, conversation_id')
      .eq('event_id', id)
      .single();

    if (chatError && chatError.code !== 'PGRST116') {
      // PGRST116 is "not found" which is ok
      console.error('Error fetching event group chat:', chatError);
      return NextResponse.json(
        { error: 'Failed to fetch event group chat' },
        { status: 500 }
      );
    }

    // If chat doesn't exist
    if (!eventGroupChat) {
      return NextResponse.json({
        exists: false,
        conversation_id: null,
        participant_count: 0,
        is_member: false,
      });
    }

    // Get participant count
    const { count: participantCount } = await supabase
      .from('conversation_participants')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', eventGroupChat.conversation_id);

    // Check if user is a member
    const { data: membership } = await supabase
      .from('conversation_participants')
      .select('id')
      .eq('conversation_id', eventGroupChat.conversation_id)
      .eq('user_id', user.id)
      .single();

    return NextResponse.json({
      exists: true,
      conversation_id: eventGroupChat.conversation_id,
      participant_count: participantCount || 0,
      is_member: !!membership,
    });
  } catch (error) {
    console.error('Get event group chat error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
