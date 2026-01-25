import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { createNotification } from '@/lib/services/notifications';

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

    // Get reservation to check ownership, event_id, and if it's an open table
    const { data: reservation } = await supabase
      .from('event_reservations')
      .select(`
        owner_id,
        event_id,
        is_open_table,
        event:events(
          id,
          title
        )
      `)
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

    // If this is an open table, find and delete guest reservations
    if (reservation.is_open_table && guests && guests.length > 0) {
      const eventTitle = reservation.event?.title || 'evento';
      
      for (const guest of guests) {
        try {
          // Find the guest's separate reservation for this event
          const { data: guestReservation } = await supabase
            .from('event_reservations')
            .select('id, owner_id')
            .eq('owner_id', guest.guest_id)
            .eq('event_id', reservation.event_id)
            .single();

          if (guestReservation) {
            // Remove guest from event group chat
            try {
              await supabase.rpc('remove_user_from_event_group_chat', {
                p_event_id: reservation.event_id,
                p_user_id: guest.guest_id,
              });
            } catch (chatError) {
              console.error('Error removing guest from chat:', chatError);
              // Don't fail deletion if chat removal fails
            }

            // Delete the guest's reservation
            const { error: deleteGuestError } = await supabase
              .from('event_reservations')
              .delete()
              .eq('id', guestReservation.id);

            if (deleteGuestError) {
              console.error('Error deleting guest reservation:', deleteGuestError);
              // Continue with other guests even if one fails
            } else {
              // Send cancellation notification to guest
              try {
                await createNotification({
                  user_id: guest.guest_id,
                  type: 'reservation_cancelled',
                  content: `Il proprietario del tavolo ha cancellato la prenotazione per "${eventTitle}". La tua prenotazione è stata annullata.`,
                  entity_type: 'reservation',
                  entity_id: guestReservation.id,
                  metadata: {
                    reservation_id: guestReservation.id,
                    event_id: reservation.event_id,
                    event_title: eventTitle,
                    cancelled_by_owner: true,
                  },
                });
              } catch (notificationError) {
                console.error('Error sending cancellation notification:', notificationError);
                // Don't fail deletion if notification fails
              }
            }
          }
        } catch (guestError) {
          console.error('Error processing guest cancellation:', guestError);
          // Continue with other guests even if one fails
        }
      }
    }

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
