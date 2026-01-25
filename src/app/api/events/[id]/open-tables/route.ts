import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get event to verify it exists
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, title, prive_enabled')
      .eq('id', id)
      .single();

    if (eventError || !event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    if (!event.prive_enabled) {
      return NextResponse.json({ open_tables: [] });
    }

    // Get all open tables for this event with available spots
    const { data: openTables, error } = await supabase
      .from('event_reservations')
      .select(`
        id,
        owner_id,
        open_table_description,
        open_table_min_budget,
        open_table_available_spots,
        total_guests,
        created_at,
        owner:profiles!owner_id(
          id,
          display_name,
          avatar_url
        ),
        guests:reservation_guests(
          id,
          guest_id,
          guest:profiles!guest_id(
            id,
            display_name,
            avatar_url
          )
        )
      `)
      .eq('event_id', id)
      .eq('reservation_type', 'prive')
      .eq('is_open_table', true)
      .eq('status', 'confirmed')
      .gt('open_table_available_spots', 0)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching open tables:', error);
      return NextResponse.json(
        { error: 'Failed to fetch open tables' },
        { status: 500 }
      );
    }

    // Calculate total members for each table (owner + guests)
    const formattedTables = (openTables || []).map((table) => {
      const totalMembers = 1 + (table.guests?.length || 0);
      
      return {
        id: table.id,
        owner: table.owner,
        description: table.open_table_description,
        min_budget: table.open_table_min_budget,
        available_spots: table.open_table_available_spots,
        total_members: totalMembers,
        created_at: table.created_at,
      };
    });

    return NextResponse.json({ open_tables: formattedTables });
  } catch (error) {
    console.error('Get open tables error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
