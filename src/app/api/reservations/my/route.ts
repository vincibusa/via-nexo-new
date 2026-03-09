import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const offset = parseInt(searchParams.get('offset') || '0');
    const limit = parseInt(searchParams.get('limit') || '20');
    const includePast = searchParams.get('include_past') !== 'false'; // Default true

    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all reservations where user is the owner
    // include_past defaults to true, so we show all events by default
    const { data: reservations, error } = await supabase
      .from('event_reservations')
      .select(`
        *,
        event:events(
          id,
          title,
          start_datetime,
          end_datetime,
          cover_image_url,
          place:places(id, name, address, city)
        ),
        owner:profiles!event_reservations_owner_id_fkey(id, display_name, avatar_url, email)
      `)
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Filter out past events if include_past is false
    let filteredReservations = reservations || [];
    if (!includePast) {
      const now = new Date().toISOString();
      filteredReservations = filteredReservations.filter((reservation: any) => {
        return reservation.event?.start_datetime && reservation.event.start_datetime >= now;
      });
    }

    if (error) {
      console.error('Error fetching reservations:', error);
      return NextResponse.json(
        { error: 'Failed to fetch reservations' },
        { status: 500 }
      );
    }

    return NextResponse.json({ reservations: filteredReservations });
  } catch (error) {
    console.error('Get my reservations error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
