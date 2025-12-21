import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
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

    const body = await request.json();
    const { qr_code_token } = body;

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
        event:events(
          id,
          title,
          start_datetime,
          cover_image_url
        ),
        owner:profiles(id, display_name, avatar_url)
      `)
      .eq('qr_code_token', qr_code_token)
      .single();

    if (error || !reservation) {
      return NextResponse.json(
        { error: 'Invalid QR code' },
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
