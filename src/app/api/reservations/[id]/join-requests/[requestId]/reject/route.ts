import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createNotification } from '@/lib/services/notifications';

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
        event:events(
          id,
          title
        )
      `)
      .eq('id', id)
      .single();

    if (reservationError || !reservation) {
      return NextResponse.json(
        { error: 'Reservation not found' },
        { status: 404 }
      );
    }

    if (reservation.owner_id !== user.id) {
      return NextResponse.json(
        { error: 'Only the reservation owner can reject requests' },
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

    // Update request status
    const { data: updatedRequest, error: updateError } = await supabase
      .from('open_table_requests')
      .update({
        status: 'rejected',
        responded_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .select('*')
      .single();

    if (updateError || !updatedRequest) {
      console.error('Error rejecting request:', updateError);
      return NextResponse.json(
        { error: 'Failed to reject request' },
        { status: 500 }
      );
    }

    // Send notification to requester
    try {
      await createNotification({
        user_id: joinRequest.requester_id,
        type: 'open_table_request_rejected',
        content: `La tua richiesta per il tavolo "${reservation.event?.title || 'evento'}" è stata rifiutata`,
        entity_type: 'reservation',
        entity_id: id,
        metadata: {
          reservation_id: id,
          request_id: requestId,
          event_id: reservation.event_id,
          event_title: reservation.event?.title,
        },
      });
    } catch (notificationError) {
      console.error('Error sending notification:', notificationError);
    }

    return NextResponse.json({ join_request: updatedRequest });
  } catch (error) {
    console.error('Reject join request error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
