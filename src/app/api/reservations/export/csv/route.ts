import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const event_id = searchParams.get('event_id');

    if (!event_id) {
      return NextResponse.json(
        { error: 'event_id is required' },
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

    // Verify user is event manager
    const { data: event } = await supabase
      .from('events')
      .select('id, owner_id, title')
      .eq('id', event_id)
      .single();

    if (!event || event.owner_id !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized - only event manager can export' },
        { status: 403 }
      );
    }

    // Fetch all reservations with guest details
    const { data: reservations, error } = await supabase
      .from('event_reservations')
      .select(
        `
        id,
        owner_id,
        status,
        total_guests,
        created_at,
        checked_in_at,
        owner:profiles(id, display_name, email),
        guests:reservation_guests(
          id,
          guest_id,
          status,
          profile:profiles(id, display_name, email)
        )
      `
      )
      .eq('event_id', event_id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching reservations:', error);
      return NextResponse.json(
        { error: 'Failed to fetch reservations' },
        { status: 500 }
      );
    }

    // Generate CSV content
    const csvContent = generateCSV(reservations, event.title);

    // Return CSV as downloadable file
    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="prenotazioni-${event.title.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function generateCSV(
  reservations: any[],
  eventTitle: string
): string {
  // CSV Headers
  const headers = [
    'Nome Prenotante',
    'Email Prenotante',
    'Numero Ospiti',
    'Stato',
    'Data Prenotazione',
    'Registrato',
    'Nomi Ospiti',
    'Email Ospiti',
  ];

  // CSV Rows
  const rows = reservations.map((res) => {
    const guestNames = res.guests
      .map((g: any) => g.profile?.display_name || 'N/A')
      .join('; ');
    const guestEmails = res.guests
      .map((g: any) => g.profile?.email || 'N/A')
      .join('; ');
    const checkedInDate = res.checked_in_at
      ? new Date(res.checked_in_at).toLocaleDateString('it-IT')
      : '';

    return [
      `"${res.owner?.display_name || 'N/A'}"`,
      `"${res.owner?.email || 'N/A'}"`,
      res.total_guests,
      mapStatus(res.status),
      new Date(res.created_at).toLocaleDateString('it-IT'),
      checkedInDate,
      `"${guestNames}"`,
      `"${guestEmails}"`,
    ];
  });

  // Build CSV string
  const csvString = [
    `Prenotazioni - ${eventTitle}`,
    `Esportato il: ${new Date().toLocaleString('it-IT')}`,
    '',
    headers.join(','),
    ...rows.map((row) => row.join(',')),
  ].join('\n');

  return csvString;
}

function mapStatus(status: string): string {
  const statusMap: Record<string, string> = {
    confirmed: 'Confermato',
    checked_in: 'Registrato',
    cancelled: 'Cancellato',
  };
  return statusMap[status] || status;
}
