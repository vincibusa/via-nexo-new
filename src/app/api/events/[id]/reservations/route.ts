import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { createNotification } from '@/lib/services/notifications';
import { calculateDistance } from '@/lib/utils/distance';

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
    const {
      guest_ids = [],
      notes,
      wants_group_chat = false,
      reservation_type = 'pista',
      is_open_table = false,
      open_table_description,
      open_table_min_budget,
      open_table_available_spots,
      user_location
    } = body;

    // Validate user_location (FASE 2)
    if (!user_location || typeof user_location.lat !== 'number' || typeof user_location.lon !== 'number') {
      return NextResponse.json(
        { error: 'User location is required for booking' },
        { status: 400 }
      );
    }

    // Validate reservation_type
    if (reservation_type !== 'pista' && reservation_type !== 'prive') {
      return NextResponse.json(
        { error: 'Invalid reservation_type. Must be "pista" or "prive"' },
        { status: 400 }
      );
    }

    // Validate open_table can only be true for prive
    if (is_open_table && reservation_type !== 'prive') {
      return NextResponse.json(
        { error: 'Open table is only available for prive reservations' },
        { status: 400 }
      );
    }

    // Log for debugging
    console.log('[Reservations] Creating reservation:', {
      event_id: id,
      owner_id: user.id,
      reservation_type,
      is_open_table,
      guest_ids,
      guest_count: guest_ids.length,
    });

    // Get event settings with place location for distance validation (same join pattern as GET /api/events/[id])
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select(`
        id,
        title,
        lista_nominativa_enabled,
        max_guests_per_reservation,
        start_datetime,
        end_datetime,
        prive_enabled,
        prive_min_price,
        prive_max_seats,
        prive_deposit_required,
        place:places(
          id,
          name,
          address,
          city,
          lat,
          lon
        )
      `)
      .eq('id', id)
      .eq('is_published', true)
      .single();

    if (eventError || !event) {
      console.error('[Reservations] Event fetch failed:', { id, eventError, event })
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const venue = Array.isArray(event.place) ? event.place[0] : event.place;

    // Validate distance for booking (FASE 2)
    if (venue?.lat == null || venue?.lon == null) {
      return NextResponse.json(
        { error: 'Venue location not available for booking validation' },
        { status: 400 }
      );
    }

    // Calculate distance from user to venue
    const distanceKm = calculateDistance(
      user_location.lat,
      user_location.lon,
      venue.lat,
      venue.lon
    );

    const DEFAULT_BOOKING_RADIUS = 10;
    const maxBookingRadius = DEFAULT_BOOKING_RADIUS;

    // Check if user is within booking radius
    if (distanceKm > maxBookingRadius) {
      return NextResponse.json(
        {
          error: `You must be within ${maxBookingRadius}km of the venue to book this event`,
          details: {
            current_distance_km: parseFloat(distanceKm.toFixed(2)),
            max_booking_radius_km: maxBookingRadius,
            venue_name: venue.name,
            venue_address: `${venue.address}, ${venue.city}`,
          },
        },
        { status: 403 }
      );
    }

    // Validate prive reservation
    if (reservation_type === 'prive') {
      if (!event.prive_enabled) {
        return NextResponse.json(
          { error: 'Prive reservations are not enabled for this event' },
          { status: 400 }
        );
      }

      // Validate min price if set
      if (event.prive_min_price && open_table_min_budget && open_table_min_budget < event.prive_min_price) {
        return NextResponse.json(
          { error: `Minimum budget must be at least €${event.prive_min_price}` },
          { status: 400 }
        );
      }

      // Use prive_max_seats if available, otherwise fallback to max_guests_per_reservation
      const max_seats = event.prive_max_seats || event.max_guests_per_reservation || 10;
      const total_people = 1 + guest_ids.length; // owner + guests
      
      if (total_people > max_seats) {
        return NextResponse.json(
          { error: `Maximum ${max_seats} people allowed for prive reservation` },
          { status: 400 }
        );
      }

      // Validate available spots for open table
      if (is_open_table) {
        if (!open_table_available_spots || open_table_available_spots <= 0) {
          return NextResponse.json(
            { error: 'Available spots must be greater than 0 for open table' },
            { status: 400 }
          );
        }
        
        // Available spots cannot exceed remaining capacity
        const remaining_capacity = max_seats - total_people;
        if (open_table_available_spots > remaining_capacity) {
          return NextResponse.json(
            { error: `Available spots cannot exceed ${remaining_capacity} (remaining capacity)` },
            { status: 400 }
          );
        }
      }
    } else {
      // Pista reservation validation
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
    const reservationData: any = {
      event_id: id,
      owner_id: user.id,
      qr_code_token,
      total_guests: 1,
      notes,
      wants_group_chat,
      reservation_type,
    };

    // Add open table fields if applicable
    if (reservation_type === 'prive' && is_open_table) {
      reservationData.is_open_table = true;
      reservationData.open_table_description = open_table_description || null;
      reservationData.open_table_min_budget = open_table_min_budget || null;
      reservationData.open_table_available_spots = open_table_available_spots || 0;
    }

    const { data: reservation, error: createError } = await supabase
      .from('event_reservations')
      .insert(reservationData)
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
