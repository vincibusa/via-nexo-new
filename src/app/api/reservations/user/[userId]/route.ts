import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/reservations/user/[userId]
 * Get all reservations for a specific user (public profile view)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    const supabase = await createClient();

    // Get query params
    const { searchParams } = new URL(request.url);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100);

    // Fetch user's reservations with event and place details
    // NOTE: qr_code_token is intentionally excluded for security - external users should not see QR codes
    const { data: reservations, error } = await supabase
      .from('event_reservations')
      .select(`
        id,
        event_id,
        owner_id,
        status,
        total_guests,
        checked_in_at,
        created_at,
        updated_at,
        events (
          id,
          title,
          start_datetime,
          end_datetime,
          cover_image_url,
          places (
            id,
            name,
            address,
            city
          )
        ),
        profiles!event_reservations_owner_id_fkey (
          id,
          display_name,
          avatar_url,
          email
        )
      `)
      .eq('owner_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching user reservations:', error);
      return NextResponse.json(
        { error: 'Failed to fetch reservations' },
        { status: 500 }
      );
    }

    // Transform the data to match the expected format
    // NOTE: qr_code_token and notes are excluded for privacy/security
    const formattedReservations = reservations?.map((reservation: any) => ({
      id: reservation.id,
      event_id: reservation.event_id,
      owner_id: reservation.owner_id,
      status: reservation.status,
      total_guests: reservation.total_guests,
      checked_in_at: reservation.checked_in_at,
      created_at: reservation.created_at,
      updated_at: reservation.updated_at,
      event: reservation.events ? {
        id: reservation.events.id,
        title: reservation.events.title,
        start_datetime: reservation.events.start_datetime,
        end_datetime: reservation.events.end_datetime,
        cover_image_url: reservation.events.cover_image_url,
        place: reservation.events.places ? {
          id: reservation.events.places.id,
          name: reservation.events.places.name,
          address: reservation.events.places.address,
          city: reservation.events.places.city,
        } : undefined,
      } : undefined,
      owner: reservation.profiles ? {
        id: reservation.profiles.id,
        display_name: reservation.profiles.display_name,
        avatar_url: reservation.profiles.avatar_url,
        email: reservation.profiles.email,
      } : undefined,
    })) || [];

    return NextResponse.json({
      reservations: formattedReservations,
      total: reservations?.length || 0,
    });
  } catch (error) {
    console.error('Error in GET /api/reservations/user/[userId]:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
