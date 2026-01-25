import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createNotification } from '@/lib/services/notifications';
import crypto from 'crypto';

function generateQRToken(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(16).toString('hex');
  return `NEXO-${timestamp}-${random}`.toUpperCase();
}

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
    const { message } = body;

    // Get reservation and verify it's an open table
    const { data: reservation, error: reservationError } = await supabase
      .from('event_reservations')
      .select(`
        id,
        owner_id,
        event_id,
        is_open_table,
        open_table_available_spots,
        reservation_type,
        status,
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

    // Verify it's an open prive table
    if (reservation.reservation_type !== 'prive' || !reservation.is_open_table) {
      return NextResponse.json(
        { error: 'This reservation is not an open table' },
        { status: 400 }
      );
    }

    // Check if reservation is confirmed
    if (reservation.status !== 'confirmed') {
      return NextResponse.json(
        { error: 'This reservation is not active' },
        { status: 400 }
      );
    }

    // Check if there are available spots
    if (!reservation.open_table_available_spots || reservation.open_table_available_spots <= 0) {
      return NextResponse.json(
        { error: 'No available spots left for this table' },
        { status: 400 }
      );
    }

    // Check if user is the owner (can't request to join own table)
    if (reservation.owner_id === user.id) {
      return NextResponse.json(
        { error: 'You cannot request to join your own table' },
        { status: 400 }
      );
    }

    // Check if user already has a pending or approved request
    const { data: existingRequest } = await supabase
      .from('open_table_requests')
      .select('id, status')
      .eq('reservation_id', id)
      .eq('requester_id', user.id)
      .single();

    if (existingRequest) {
      if (existingRequest.status === 'pending') {
        return NextResponse.json(
          { error: 'You already have a pending request for this table' },
          { status: 400 }
        );
      }
      if (existingRequest.status === 'approved') {
        // Recovery logic: Check if user has a reservation for this event
        // If not, auto-create it (data integrity fix for edge cases)
        const { data: existingReservation } = await supabase
          .from('event_reservations')
          .select('id')
          .eq('owner_id', user.id)
          .eq('event_id', reservation.event_id)
          .single();

        if (!existingReservation) {
          // Auto-create missing reservation for approved user
          console.log('[Join Request Recovery] Creating missing reservation for approved user:', {
            user_id: user.id,
            event_id: reservation.event_id,
            reservation_id: id,
          });

          const recoveryQRToken = generateQRToken();
          const { data: recoveryReservation, error: recoveryError } = await supabase
            .from('event_reservations')
            .insert({
              event_id: reservation.event_id,
              owner_id: user.id,
              reservation_type: reservation.reservation_type || 'prive',
              status: 'confirmed',
              total_guests: 1,
              qr_code_token: recoveryQRToken,
              notes: 'Parte del tavolo aperto - Richiesta approvata (auto-recovery)',
            })
            .select('id')
            .single();

          if (recoveryError || !recoveryReservation) {
            console.error('[Join Request Recovery] Failed to create reservation:', recoveryError);
            // Still return error, but with more context
            return NextResponse.json(
              { 
                error: 'You are already approved for this table, but there was an issue creating your reservation. Please contact support.',
                recovery_failed: true
              },
              { status: 500 }
            );
          }

          console.log('[Join Request Recovery] Successfully created reservation:', recoveryReservation.id);
          
          // Return success with recovery info
          return NextResponse.json({ 
            message: 'Your reservation has been automatically created',
            reservation_id: recoveryReservation.id,
            recovered: true
          }, { status: 200 });
        }

        // User already has reservation, return normal error
        return NextResponse.json(
          { error: 'You are already approved for this table' },
          { status: 400 }
        );
      }
    }

    // Create join request
    const { data: joinRequest, error: createError } = await supabase
      .from('open_table_requests')
      .insert({
        reservation_id: id,
        requester_id: user.id,
        message: message || null,
        status: 'pending',
      })
      .select('*')
      .single();

    if (createError || !joinRequest) {
      console.error('Error creating join request:', createError);
      return NextResponse.json(
        { error: 'Failed to create join request' },
        { status: 500 }
      );
    }

    // Send notification to table owner
    try {
      await createNotification({
        user_id: reservation.owner_id,
        type: 'open_table_join_request',
        content: `Nuova richiesta per unirsi al tuo tavolo per "${reservation.event?.title || 'evento'}"`,
        entity_type: 'reservation',
        entity_id: id,
        metadata: {
          reservation_id: id,
          request_id: joinRequest.id,
          requester_id: user.id,
          event_id: reservation.event_id,
          event_title: reservation.event?.title,
        },
      });
    } catch (notificationError) {
      console.error('Error sending notification:', notificationError);
      // Don't fail the request creation if notification fails
    }

    return NextResponse.json({ join_request: joinRequest }, { status: 201 });
  } catch (error) {
    console.error('Create join request error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
