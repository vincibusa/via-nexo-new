import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createNotification } from '@/lib/services/notifications';

export async function POST(
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

    // Verify story exists and get owner
    const { data: story } = await supabase
      .from('stories')
      .select('id, user_id')
      .eq('id', id)
      .single();

    if (!story) {
      return NextResponse.json({ error: 'Story not found' }, { status: 404 });
    }

    // Insert view record (upsert to avoid duplicates)
    const { error } = await supabase
      .from('story_views')
      .upsert({
        story_id: id,
        user_id: user.id,
        viewed_at: new Date().toISOString(),
      });

    if (error) {
      console.error('Mark story view error:', error);
      return NextResponse.json(
        { error: 'Failed to mark story as viewed' },
        { status: 500 }
      );
    }

    // Create notification for story owner (if not viewing own story)
    if (story.user_id !== user.id) {
      try {
        await createNotification({
          user_id: story.user_id,
          actor_id: user.id,
          type: 'story_view',
          entity_type: 'story',
          entity_id: id,
          content: 'Ha visto la tua story',
          metadata: {
            story_id: id,
            viewed_at: new Date().toISOString()
          }
        });
      } catch (notificationError) {
        console.error('Error creating story view notification:', notificationError);
        // Don't fail the view recording if notification fails
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Mark story view error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
