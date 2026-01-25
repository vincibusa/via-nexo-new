import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') as string | undefined;

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
      .select('id, owner_id, is_open_table')
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
        { error: 'Only the reservation owner can view join requests' },
        { status: 403 }
      );
    }

    if (!reservation.is_open_table) {
      return NextResponse.json({ join_requests: [] });
    }

    // Build query
    let query = supabase
      .from('open_table_requests')
      .select(`
        id,
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
      .eq('reservation_id', id)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data: joinRequests, error } = await query;

    if (error) {
      console.error('Error fetching join requests:', error);
      return NextResponse.json(
        { error: 'Failed to fetch join requests' },
        { status: 500 }
      );
    }

    return NextResponse.json({ join_requests: joinRequests || [] });
  } catch (error) {
    console.error('Get join requests error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
