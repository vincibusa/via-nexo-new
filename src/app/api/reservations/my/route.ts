import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const offset = parseInt(searchParams.get('offset') || '0');
    const limit = parseInt(searchParams.get('limit') || '20');

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

    // Get all reservations where user is the owner
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

    if (error) {
      console.error('Error fetching reservations:', error);
      return NextResponse.json(
        { error: 'Failed to fetch reservations' },
        { status: 500 }
      );
    }

    return NextResponse.json({ reservations: reservations || [] });
  } catch (error) {
    console.error('Get my reservations error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
