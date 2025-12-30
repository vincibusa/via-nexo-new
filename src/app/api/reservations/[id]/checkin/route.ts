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

    const body = await request.json();
    const { guest_ids } = body; // Array of guest IDs to check-in, or empty to check-in owner

    // Get reservation
    const { data: reservation, error: resError } = await supabase
      .from('event_reservations')
      .select('id, event_id, owner_id')
      .eq('id', id)
      .single();

    if (resError || !reservation) {
      return NextResponse.json(
        { error: 'Reservation not found' },
        { status: 404 }
      );
    }

    // Check if user is the event manager
    const { data: event } = await supabase
      .from('events')
      .select('owner_id')
      .eq('id', reservation.event_id)
      .single();

    if (event?.owner_id !== user.id) {
      return NextResponse.json(
        { error: 'Only event manager can check-in' },
        { status: 403 }
      );
    }

    const now = new Date().toISOString();

    // Check-in owner if no guest_ids provided
    if (!guest_ids || guest_ids.length === 0) {
      const { data: updated, error } = await supabase
        .from('event_reservations')
        .update({
          status: 'checked_in',
          checked_in_at: now,
          checked_in_by: user.id,
        })
        .eq('id', id)
        .select(
          `
          *,
          event:events(id, title),
          owner:profiles!event_reservations_owner_id_fkey(id, display_name, avatar_url),
          guests:reservation_guests(
            id,
            guest_id,
            status,
            checked_in_at,
            profile:profiles(id, display_name, avatar_url)
          )
        `
        )
        .single();

      if (error) {
        console.error('Error checking in owner:', error);
        return NextResponse.json(
          { error: 'Failed to check-in' },
          { status: 500 }
        );
      }

      // Send notification to owner
      if (updated?.event) {
        await createNotification({
          user_id: updated.owner_id,
          type: 'reservation_checked_in',
          entity_type: 'reservation',
          entity_id: id,
          content: `✓ Sei registrato per "${updated.event.title}"`,
          metadata: {
            reservation_id: id,
            event_id: updated.event.id,
            checked_in_at: now,
          },
        }).catch((err) => {
          console.error('Failed to send check-in notification:', err);
        });
      }

      return NextResponse.json(updated);
    }

    // Check-in specific guests
    const { error: guestError } = await supabase
      .from('reservation_guests')
      .update({
        status: 'checked_in',
        checked_in_at: now,
      })
      .in('guest_id', guest_ids)
      .eq('reservation_id', id);

    if (guestError) {
      console.error('Error checking in guests:', guestError);
      return NextResponse.json(
        { error: 'Failed to check-in guests' },
        { status: 500 }
      );
    }

    // Send notifications to guests who were checked in
    const guestNotificationPromises = guest_ids.map((guestId: string) =>
      createNotification({
        user_id: guestId,
        type: 'reservation_checked_in',
        entity_type: 'reservation',
        entity_id: id,
        content: '✓ Sei registrato per l\'evento',
        metadata: {
          reservation_id: id,
          checked_in_at: now,
        },
      }).catch((err) => {
        console.error(`Failed to send check-in notification to guest ${guestId}:`, err);
      })
    );

    await Promise.all(guestNotificationPromises);

    // Get updated reservation
    const { data: updated } = await supabase
      .from('event_reservations')
      .select(
        `
        *,
        event:events(id, title),
        owner:profiles!event_reservations_owner_id_fkey(id, display_name, avatar_url),
        guests:reservation_guests(
          id,
          guest_id,
          status,
          checked_in_at,
          profile:profiles(id, display_name, avatar_url)
        )
      `
      )
      .eq('id', id)
      .single();

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Check-in error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
