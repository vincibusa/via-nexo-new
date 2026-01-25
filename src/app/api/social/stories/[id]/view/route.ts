import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createNotification } from '@/lib/services/notifications';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

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
    // First check if view already exists
    const { data: existingView } = await supabase
      .from('story_views')
      .select('id')
      .eq('story_id', id)
      .eq('viewer_id', user.id)
      .single();

    const { error } = await supabase
      .from('story_views')
      .upsert({
        id: existingView?.id, // Include primary key for proper upsert
        story_id: id,
        viewer_id: user.id, // Fixed: was 'user_id', should be 'viewer_id'
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
