import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createNotification } from '@/lib/services/notifications';
import crypto from 'crypto';

function generateQRToken(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(16).toString('hex');
  return `NEXO-${timestamp}-${random}`.toUpperCase();
}

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

    // Get reservation to check authorization
    const { data: reservation } = await supabase
      .from('event_reservations')
      .select('owner_id, event_id')
      .eq('id', id)
      .single();

    if (!reservation) {
      return NextResponse.json(
        { error: 'Reservation not found' },
        { status: 404 }
      );
    }

    // Check authorization
    if (reservation.owner_id !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      );
    }

    const { data: guests, error } = await supabase
      .from('reservation_guests')
      .select(
        `
        id,
        guest_id,
        status,
        checked_in_at,
        invited_at,
        qr_code_token,
        profile:profiles(id, display_name, avatar_url, email)
      `
      )
      .eq('reservation_id', id)
      .order('invited_at', { ascending: true });

    if (error) {
      console.error('Error fetching guests:', error);
      return NextResponse.json(
        { error: 'Failed to fetch guests' },
        { status: 500 }
      );
    }

    return NextResponse.json({ guests });
  } catch (error) {
    console.error('Get guests error:', error);
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

    const body = await request.json();
    const { guest_id } = body;

    if (!guest_id) {
      return NextResponse.json(
        { error: 'guest_id is required' },
        { status: 400 }
      );
    }

    // Get reservation to check authorization and settings
    const { data: reservation, error: resError } = await supabase
      .from('event_reservations')
      .select('owner_id, event_id, total_guests')
      .eq('id', id)
      .single();

    if (resError || !reservation) {
      return NextResponse.json(
        { error: 'Reservation not found' },
        { status: 404 }
      );
    }

    if (reservation.owner_id !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      );
    }

    // Check max guests
    const { data: event } = await supabase
      .from('events')
      .select('max_guests_per_reservation')
      .eq('id', reservation.event_id)
      .single();

    const max_guests = event?.max_guests_per_reservation || 5;
    if (reservation.total_guests >= max_guests) {
      return NextResponse.json(
        { error: `Maximum ${max_guests} guests allowed` },
        { status: 400 }
      );
    }

    // Check if guest already exists
    const { data: existing } = await supabase
      .from('reservation_guests')
      .select('id')
      .eq('reservation_id', id)
      .eq('guest_id', guest_id)
      .single();

    if (existing) {
      return NextResponse.json(
        { error: 'Guest already added to this reservation' },
        { status: 400 }
      );
    }

    // Add guest with unique QR code
    const { data: newGuest, error } = await supabase
      .from('reservation_guests')
      .insert({
        reservation_id: id,
        guest_id,
        status: 'confirmed',
        qr_code_token: generateQRToken(), // Generate unique QR token for guest
      })
      .select(
        `
        id,
        guest_id,
        status,
        invited_at,
        qr_code_token,
        profile:profiles(id, display_name, avatar_url)
      `
      )
      .single();

    if (error) {
      console.error('Error adding guest:', error);
      return NextResponse.json(
        { error: 'Failed to add guest' },
        { status: 500 }
      );
    }

    // Update total_guests count
    await supabase
      .from('event_reservations')
      .update({ total_guests: reservation.total_guests + 1 })
      .eq('id', id);

    // Get event and owner info for notification
    const { data: eventData } = await supabase
      .from('events')
      .select('id, title')
      .eq('id', reservation.event_id)
      .single();

    const { data: ownerData } = await supabase
      .from('profiles')
      .select('id, display_name')
      .eq('id', reservation.owner_id)
      .single();

    // Send notification to guest
    if (eventData && ownerData) {
      await createNotification({
        user_id: guest_id,
        type: 'reservation_invitation',
        actor_id: reservation.owner_id,
        entity_type: 'reservation',
        entity_id: id,
        content: `${ownerData.display_name} ti ha aggiunto alla lista per "${eventData.title}"`,
        metadata: {
          reservation_id: id,
          event_id: reservation.event_id,
          event_title: eventData.title,
        },
      }).catch((err) => {
        console.error('Failed to send invitation notification:', err);
      });
    }

    return NextResponse.json(newGuest, { status: 201 });
  } catch (error) {
    console.error('Add guest error:', error);
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
    const { searchParams } = new URL(request.url);
    const guest_id = searchParams.get('guest_id');

    if (!guest_id) {
      return NextResponse.json(
        { error: 'guest_id is required' },
        { status: 400 }
      );
    }

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

    // Get reservation to check authorization
    const { data: reservation } = await supabase
      .from('event_reservations')
      .select('owner_id, total_guests')
      .eq('id', id)
      .single();

    if (!reservation) {
      return NextResponse.json(
        { error: 'Reservation not found' },
        { status: 404 }
      );
    }

    if (reservation.owner_id !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      );
    }

    // Delete guest
    const { error } = await supabase
      .from('reservation_guests')
      .delete()
      .eq('reservation_id', id)
      .eq('guest_id', guest_id);

    if (error) {
      console.error('Error removing guest:', error);
      return NextResponse.json(
        { error: 'Failed to remove guest' },
        { status: 500 }
      );
    }

    // Update total_guests count
    await supabase
      .from('event_reservations')
      .update({ total_guests: Math.max(1, reservation.total_guests - 1) })
      .eq('id', id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Remove guest error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
