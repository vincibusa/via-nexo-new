import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { createNotification } from '@/lib/services/notifications';

function generateQRToken(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(16).toString('hex');
  return `NEXO-${timestamp}-${random}`.toUpperCase();
}

async function checkEventOverlap(
  supabase: any,
  userId: string,
  newEventId: string,
  newEventStart: string,
  newEventEnd: string
): Promise<{ hasOverlap: boolean; conflictingEvent?: any }> {
  // Get all user's existing reservations with event details
  const { data: reservations, error } = await supabase
    .from('event_reservations')
    .select(`
      id,
      event:events(
        id,
        title,
        start_datetime,
        end_datetime
      )
    `)
    .eq('owner_id', userId)
    .neq('status', 'cancelled'); // Exclude cancelled reservations

  if (error || !reservations) {
    return { hasOverlap: false };
  }

  const newStart = new Date(newEventStart);
  const newEnd = new Date(newEventEnd);

  for (const reservation of reservations) {
    if (!reservation.event) continue;
    
    const existingStart = new Date(reservation.event.start_datetime);
    const existingEnd = new Date(reservation.event.end_datetime || reservation.event.start_datetime);

    // Check overlap: new_start < existing_end AND new_end > existing_start
    if (newStart < existingEnd && newEnd > existingStart) {
      return {
        hasOverlap: true,
        conflictingEvent: reservation.event
      };
    }
  }

  return { hasOverlap: false };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const offset = parseInt(searchParams.get('offset') || '0');
    const limit = parseInt(searchParams.get('limit') || '20');
    const status = searchParams.get('status') as string || undefined;

    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get event and check if user is the manager
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, owner_id')
      .eq('id', id)
      .single();

    if (eventError || !event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Only managers and the event owner can view reservations
    if (event.owner_id !== user.id) {
      return NextResponse.json(
        { error: 'Only event manager can view reservations' },
        { status: 403 }
      );
    }

    // Build query
    let query = supabase
      .from('event_reservations')
      .select(
        `
        *,
        owner:profiles(id, display_name, avatar_url, email),
        guests:reservation_guests(
          id,
          guest_id,
          status,
          checked_in_at,
          qr_code_token,
          profile:profiles(id, display_name, avatar_url)
        )
      `
      )
      .eq('event_id', id);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: reservations, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching reservations:', error);
      return NextResponse.json(
        { error: 'Failed to fetch reservations' },
        { status: 500 }
      );
    }

    return NextResponse.json({ reservations });
  } catch (error) {
    console.error('Get reservations error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
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
    const { guest_ids = [], notes, wants_group_chat = false } = body;

    // Log for debugging
    console.log('[Reservations] Creating reservation:', {
      event_id: id,
      owner_id: user.id,
      guest_ids,
      guest_count: guest_ids.length,
    });

    // Get event settings
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, title, lista_nominativa_enabled, max_guests_per_reservation, start_datetime, end_datetime')
      .eq('id', id)
      .single();

    if (eventError || !event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    if (!event.lista_nominativa_enabled) {
      return NextResponse.json(
        { error: 'Lista nominativa not enabled for this event' },
        { status: 400 }
      );
    }

    const max_guests = event.max_guests_per_reservation || 5;
    if (guest_ids.length > max_guests) {
      return NextResponse.json(
        { error: `Maximum ${max_guests} guests allowed` },
        { status: 400 }
      );
    }

    // Check if owner already has a reservation for this event
    const { data: existingOwnerReservation } = await supabase
      .from('event_reservations')
      .select('id')
      .eq('event_id', id)
      .eq('owner_id', user.id)
      .single();

    if (existingOwnerReservation) {
      return NextResponse.json(
        { error: 'You already have a reservation for this event' },
        { status: 400 }
      );
    }

    // Check if owner has overlapping events
    const ownerOverlap = await checkEventOverlap(
      supabase,
      user.id,
      id,
      event.start_datetime,
      event.end_datetime || event.start_datetime
    );

    if (ownerOverlap.hasOverlap) {
      return NextResponse.json(
        { 
          error: 'You already have a reservation for an overlapping event',
          conflictingEvent: ownerOverlap.conflictingEvent
        },
        { status: 400 }
      );
    }

    // Check guests for existing reservations and overlaps
    if (guest_ids.length > 0) {
      // Check if any guest already has this event
      const { data: existingGuestReservations } = await supabase
        .from('event_reservations')
        .select('owner_id')
        .eq('event_id', id)
        .in('owner_id', guest_ids);

      if (existingGuestReservations && existingGuestReservations.length > 0) {
        const alreadyBookedIds = existingGuestReservations.map(r => r.owner_id);
        return NextResponse.json(
          { 
            error: 'Some guests already have a reservation for this event',
            alreadyBookedIds 
          },
          { status: 400 }
        );
      }

      // Check each guest for overlapping events
      const guestOverlaps = [];
      for (const guest_id of guest_ids) {
        const overlap = await checkEventOverlap(
          supabase,
          guest_id,
          id,
          event.start_datetime,
          event.end_datetime || event.start_datetime
        );
        
        if (overlap.hasOverlap) {
          guestOverlaps.push({
            guest_id,
            conflictingEvent: overlap.conflictingEvent
          });
        }
      }

      if (guestOverlaps.length > 0) {
        return NextResponse.json(
          { 
            error: 'Some guests have overlapping event reservations',
            guestOverlaps
          },
          { status: 400 }
        );
      }
    }

    // Create reservation for owner
    const qr_code_token = generateQRToken();
    const { data: reservation, error: createError } = await supabase
      .from('event_reservations')
      .insert({
        event_id: id,
        owner_id: user.id,
        qr_code_token,
        total_guests: 1,
        notes,
        wants_group_chat,
      })
      .select('*')
      .single();

    if (createError || !reservation) {
      console.error('Error creating reservation:', createError);
      return NextResponse.json(
        { error: 'Failed to create reservation' },
        { status: 500 }
      );
    }

    // Handle event group chat if user wants to join
    if (wants_group_chat) {
      try {
        // Create or get event group chat
        const { data: conversationId, error: chatError } = await supabase.rpc(
          'create_or_get_event_group_chat',
          {
            p_event_id: id,
            p_user_id: user.id,
          }
        );

        if (!chatError && conversationId) {
          // Add user to the chat
          await supabase.rpc('add_user_to_event_group_chat', {
            p_event_id: id,
            p_user_id: user.id,
          });
        }
      } catch (chatError) {
        console.error('Error creating/joining event group chat:', chatError);
        // Don't fail the reservation if chat creation fails
      }
    }

    // Create separate reservations for each guest using RPC function
    // This bypasses RLS because the function uses SECURITY DEFINER
    const guestReservations = [];
    for (const guest_id of guest_ids) {
      const guestQRToken = generateQRToken();
      
      // Use RPC function to create reservation for guest (bypasses RLS)
      const { data: guestReservation, error: guestError } = await supabase
        .rpc('create_guest_reservation', {
          p_event_id: id,
          p_guest_id: guest_id,
          p_qr_code_token: guestQRToken,
          p_notes: `Invited by ${user.email}`,
          p_invited_by_email: user.email || '',
        });

      if (!guestError && guestReservation) {
        guestReservations.push(guestReservation);
        
        // Send notification to guest
        try {
          await createNotification({
            user_id: guest_id,
            type: 'reservation_invitation',
            content: `Hai una prenotazione per "${event.title}"`,
            entity_type: 'reservation',
            entity_id: guestReservation.id,
            metadata: {
              reservation_id: guestReservation.id,
              event_id: id,
              event_title: event.title,
            },
          });
        } catch (notificationError) {
          // Don't fail the reservation creation if notification fails
          console.error(`Error sending notification to guest ${guest_id}:`, notificationError);
        }
      } else {
        console.error(`Error creating reservation for guest ${guest_id}:`, guestError);
      }
    }

    // Return owner reservation with guest count
    return NextResponse.json({
      reservation,
      guestsBooked: guestReservations.length,
      total: 1 + guestReservations.length
    }, { status: 201 });
  } catch (error) {
    console.error('Create reservation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
