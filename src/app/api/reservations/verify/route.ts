import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    console.log('[Verify QR] Auth check:', { userId: user?.id, authError: authError?.message });

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { qr_code_token } = body;

    console.log('[Verify QR] Token received:', qr_code_token);

    if (!qr_code_token) {
      return NextResponse.json(
        { error: 'QR code token is required' },
        { status: 400 }
      );
    }

    // Find reservation by QR token
    const { data: reservation, error } = await supabase
      .from('event_reservations')
      .select(`
        id,
        event_id,
        owner_id,
        qr_code_token,
        status,
        total_guests,
        checked_in_at,
        created_at,
        reservation_type,
        is_open_table,
        open_table_available_spots,
        event:events(
          id,
          title,
          start_datetime,
          cover_image_url
        ),
        owner:profiles!event_reservations_owner_id_fkey(id, display_name, avatar_url)
      `)
      .eq('qr_code_token', qr_code_token)
      .single();

    console.log('[Verify QR] Query result:', {
      found: !!reservation,
      error: error?.message,
      errorCode: error?.code
    });

    if (error || !reservation) {
      return NextResponse.json(
        { error: 'Invalid QR code', details: error?.message },
        { status: 404 }
      );
    }

    return NextResponse.json(reservation);
  } catch (error) {
    console.error('Verify QR error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
