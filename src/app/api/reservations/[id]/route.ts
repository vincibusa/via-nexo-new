import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: () => {},
        },
      }
    );

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
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: () => {},
        },
      }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get reservation to check ownership
    const { data: reservation } = await supabase
      .from('event_reservations')
      .select('owner_id')
      .eq('id', id)
      .single();

    if (!reservation || reservation.owner_id !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      );
    }

    // Delete reservation (cascade will handle guests)
    const { error } = await supabase
      .from('event_reservations')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting reservation:', error);
      return NextResponse.json(
        { error: 'Failed to delete reservation' },
        { status: 500 }
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
