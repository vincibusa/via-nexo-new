import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
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

    // Get reservation with full details
    const { data: reservation, error } = await supabase
      .from('event_reservations')
      .select(
        `
        *,
        event:events(id, title, start_datetime, end_datetime, cover_image_url, place:places(id, name, address, city)),
        owner:profiles!owner_id(id, display_name, avatar_url, email),
        guests:reservation_guests(
          id,
          guest_id,
          status,
          checked_in_at,
          invited_at,
          guest:profiles!guest_id(id, display_name, avatar_url)
        )
      `
      )
      .eq('id', id)
      .single();

    if (error || !reservation) {
      console.error('Error fetching reservation:', error);
      return NextResponse.json(
        { error: 'Reservation not found' },
        { status: 404 }
      );
    }

    // Check if user has access to this reservation (is the owner)
    if (reservation.owner_id !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      );
    }

    return NextResponse.json(reservation);
  } catch (error) {
    console.error('Get reservation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
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

    // Get reservation to check ownership and event_id
    const { data: reservation } = await supabase
      .from('event_reservations')
      .select('owner_id, event_id')
      .eq('id', id)
      .single();

    if (!reservation || reservation.owner_id !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      );
    }

    // Get all guests for this reservation
    const { data: guests } = await supabase
      .from('reservation_guests')
      .select('guest_id')
      .eq('reservation_id', id);

    // Remove owner from event group chat (if exists)
    try {
      await supabase.rpc('remove_user_from_event_group_chat', {
        p_event_id: reservation.event_id,
        p_user_id: reservation.owner_id,
      });
    } catch (chatError) {
      console.error('Error removing owner from chat:', chatError);
      // Don't fail deletion if chat removal fails
    }

    // Remove all guests from event group chat
    if (guests && guests.length > 0) {
      for (const guest of guests) {
        try {
          await supabase.rpc('remove_user_from_event_group_chat', {
            p_event_id: reservation.event_id,
            p_user_id: guest.guest_id,
          });
        } catch (chatError) {
          console.error('Error removing guest from chat:', chatError);
          // Don't fail deletion if chat removal fails
        }
      }
    }

    // Delete reservation (cascade will handle guests)
    const { data: deletedData, error } = await supabase
      .from('event_reservations')
      .delete()
      .eq('id', id)
      .select();

    if (error) {
      console.error('Error deleting reservation:', error);
      return NextResponse.json(
        { error: 'Failed to delete reservation' },
        { status: 500 }
      );
    }

    // Check if any rows were actually deleted
    if (!deletedData || deletedData.length === 0) {
      console.error('No reservation deleted - RLS policy may have blocked the operation');
      return NextResponse.json(
        { error: 'Reservation not found or unauthorized' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete reservation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
