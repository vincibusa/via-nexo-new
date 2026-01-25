import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { createNotification } from '@/lib/services/notifications';

function generateQRToken(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(16).toString('hex');
  return `NEXO-${timestamp}-${random}`.toUpperCase();
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; requestId: string }> }
) {
  try {
    const { id, requestId } = await params;
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get reservation and verify user is the owner
    const { data: reservation, error: reservationError } = await supabase
      .from('event_reservations')
      .select(`
        id,
        owner_id,
        event_id,
        is_open_table,
        open_table_available_spots,
        reservation_type
      `)
      .eq('id', id)
      .single();

    if (reservationError || !reservation) {
      return NextResponse.json(
        { error: 'Reservation not found' },
        { status: 404 }
      );
    }

    // Get event details separately
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, title')
      .eq('id', reservation.event_id)
      .single();

    if (eventError || !event) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      );
    }

    if (reservation.owner_id !== user.id) {
      return NextResponse.json(
        { error: 'Only the reservation owner can approve requests' },
        { status: 403 }
      );
    }

    // Get join request
    const { data: joinRequest, error: requestError } = await supabase
      .from('open_table_requests')
      .select('*')
      .eq('id', requestId)
      .eq('reservation_id', id)
      .single();

    if (requestError || !joinRequest) {
      return NextResponse.json(
        { error: 'Join request not found' },
        { status: 404 }
      );
    }

    if (joinRequest.status !== 'pending') {
      return NextResponse.json(
        { error: 'This request has already been processed' },
        { status: 400 }
      );
    }

    // Check if there are still available spots
    if (!reservation.open_table_available_spots || reservation.open_table_available_spots <= 0) {
      return NextResponse.json(
        { error: 'No available spots left for this table' },
        { status: 400 }
      );
    }

    // Update request status
    const { data: updatedRequest, error: updateError } = await supabase
      .from('open_table_requests')
      .update({
        status: 'approved',
        responded_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .select('*')
      .single();

    if (updateError || !updatedRequest) {
      console.error('Error approving request:', updateError);
      return NextResponse.json(
        { error: 'Failed to approve request' },
        { status: 500 }
      );
    }

    // Create a new reservation for the approved user using RPC function
    // This bypasses RLS policies since it's a server-side operation
    const newReservationQRToken = generateQRToken();

    console.log('[Approve Request] Creating reservation for user:', {
      requester_id: joinRequest.requester_id,
      event_id: reservation.event_id,
      reservation_type: reservation.reservation_type || 'prive',
    });

    const { data: newReservation, error: createReservationError } = await supabase
      .rpc('approve_open_table_request', {
        p_request_id: requestId,
        p_reservation_id: id,
        p_requester_id: joinRequest.requester_id,
        p_event_id: reservation.event_id,
        p_qr_token: newReservationQRToken,
      });

    if (createReservationError || !newReservation || newReservation.length === 0) {
      console.error('[Approve Request] Error creating reservation for approved user:', {
        error: createReservationError,
        requester_id: joinRequest.requester_id,
        event_id: reservation.event_id,
      });
      // Rollback request approval
      await supabase
        .from('open_table_requests')
        .update({ status: 'pending', responded_at: null })
        .eq('id', requestId);

      return NextResponse.json(
        { error: 'Failed to create reservation for approved user' },
        { status: 500 }
      );
    }

    // RPC returns array, get first element
    const newReservationData = Array.isArray(newReservation) ? newReservation[0] : newReservation;

    console.log('[Approve Request] Reservation created successfully:', {
      reservation_id: newReservationData.id,
      owner_id: newReservationData.owner_id,
      event_id: newReservationData.event_id,
      status: newReservationData.status,
    });

    // Add approved user to event group chat automatically
    try {
      // Create or get event group chat (if it doesn't exist)
      const { data: conversationId, error: chatCreateError } = await supabase.rpc(
        'create_or_get_event_group_chat',
        {
          p_event_id: reservation.event_id,
          p_user_id: joinRequest.requester_id,
        }
      );

      if (!chatCreateError && conversationId) {
        // Add user to the group chat
        const { error: addChatError } = await supabase.rpc('add_user_to_event_group_chat', {
          p_event_id: reservation.event_id,
          p_user_id: joinRequest.requester_id,
        });

        if (!addChatError) {
          console.log('[Approve Request] User added to event group chat:', {
            user_id: joinRequest.requester_id,
            event_id: reservation.event_id,
            conversation_id: conversationId,
          });

          // Update wants_group_chat flag in the new reservation
          await supabase
            .from('event_reservations')
            .update({ wants_group_chat: true })
            .eq('id', newReservationData.id);
        } else {
          console.error('[Approve Request] Error adding user to group chat:', addChatError);
          // Don't fail the approval if chat join fails
        }
      } else {
        console.error('[Approve Request] Error creating/getting group chat:', chatCreateError);
        // Don't fail the approval if chat creation fails
      }
    } catch (chatError) {
      console.error('[Approve Request] Error in group chat operations:', chatError);
      // Don't fail the approval if chat operations fail
    }

    // Also add requester as a guest to the original reservation for tracking
    const guestQRToken = `GUEST-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`.toUpperCase();
    
    const { error: guestError } = await supabase
      .from('reservation_guests')
      .insert({
        reservation_id: id,
        guest_id: joinRequest.requester_id,
        status: 'confirmed',
        qr_code_token: guestQRToken,
      });

    if (guestError) {
      console.error('Error adding guest:', guestError);
      // Note: We don't rollback here because the main reservation was created successfully
      // The guest entry is just for tracking purposes
    }

    // Update total_guests count and available spots
    const { data: guests } = await supabase
      .from('reservation_guests')
      .select('id', { count: 'exact', head: true })
      .eq('reservation_id', id);

    await supabase
      .from('event_reservations')
      .update({ 
        total_guests: (guests?.length || 0) + 1,
        open_table_available_spots: Math.max(0, (reservation.open_table_available_spots || 0) - 1)
      })
      .eq('id', id);

    // Send notification to requester
    try {
      await createNotification({
        user_id: joinRequest.requester_id,
        type: 'reservation_invitation',
        content: `La tua richiesta per il tavolo "${event.title || 'evento'}" è stata approvata!`,
        entity_type: 'reservation',
        entity_id: newReservationData.id,
        metadata: {
          reservation_id: newReservationData.id,
          original_reservation_id: id,
          request_id: requestId,
          event_id: reservation.event_id,
          event_title: event.title,
        },
      });
    } catch (notificationError) {
      console.error('Error sending notification:', notificationError);
    }

    return NextResponse.json({
      join_request: updatedRequest,
      new_reservation: {
        id: newReservationData.id,
        owner_id: newReservationData.owner_id,
        event_id: newReservationData.event_id,
      }
    });
  } catch (error) {
    console.error('Approve join request error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
