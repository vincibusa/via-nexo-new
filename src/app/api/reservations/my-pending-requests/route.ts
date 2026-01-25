import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all open table reservations for the current user
    const { data: reservations, error: reservationsError } = await supabase
      .from('event_reservations')
      .select(`
        id,
        event_id,
        reservation_type,
        is_open_table,
        open_table_available_spots,
        event:events(
          id,
          title,
          start_datetime,
          cover_image_url,
          place:places(
            id,
            name,
            city
          )
        )
      `)
      .eq('owner_id', user.id)
      .eq('is_open_table', true);

    if (reservationsError) {
      console.error('Error fetching reservations:', reservationsError);
      return NextResponse.json(
        { error: 'Failed to fetch reservations' },
        { status: 500 }
      );
    }

    if (!reservations || reservations.length === 0) {
      return NextResponse.json({ requests: [] });
    }

    // Get all pending join requests for these reservations
    const reservationIds = reservations.map((r) => r.id);

    const { data: joinRequests, error: requestsError } = await supabase
      .from('open_table_requests')
      .select(`
        id,
        reservation_id,
        requester_id,
        status,
        message,
        created_at,
        responded_at,
        requester:profiles!requester_id(
          id,
          display_name,
          avatar_url,
          bio
        )
      `)
      .in('reservation_id', reservationIds)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (requestsError) {
      console.error('Error fetching join requests:', requestsError);
      return NextResponse.json(
        { error: 'Failed to fetch join requests' },
        { status: 500 }
      );
    }

    // Group requests by reservation and enrich with reservation/event data
    const requestsWithReservation = (joinRequests || []).map((request) => {
      const reservation = reservations.find(
        (r) => r.id === request.reservation_id
      );
      return {
        ...request,
        reservation: reservation
          ? {
              id: reservation.id,
              reservation_type: reservation.reservation_type,
              open_table_available_spots: reservation.open_table_available_spots,
              event: reservation.event,
            }
          : null,
      };
    });

    return NextResponse.json({ requests: requestsWithReservation || [] });
  } catch (error) {
    console.error('Get my pending requests error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
