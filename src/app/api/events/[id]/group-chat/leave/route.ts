import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

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

    // Call RPC function to remove user from event group chat
    const { error: rpcError } = await supabase.rpc('remove_user_from_event_group_chat', {
      p_event_id: id,
      p_user_id: user.id,
    });

    if (rpcError) {
      console.error('Error removing user from event group chat:', rpcError);
      return NextResponse.json(
        { error: 'Failed to leave event group chat' },
        { status: 500 }
      );
    }

    // Update wants_group_chat flag in event_reservations
    await supabase
      .from('event_reservations')
      .update({ wants_group_chat: false })
      .eq('event_id', id)
      .eq('owner_id', user.id);

    // Update wants_group_chat flag in reservation_guests if user is a guest
    const { data: guestReservations } = await supabase
      .from('reservation_guests')
      .select('id, reservation_id')
      .eq('guest_id', user.id);

    if (guestReservations && guestReservations.length > 0) {
      for (const guest of guestReservations) {
        const { data: reservation } = await supabase
          .from('event_reservations')
          .select('event_id')
          .eq('id', guest.reservation_id)
          .single();

        if (reservation && reservation.event_id === id) {
          await supabase
            .from('reservation_guests')
            .update({ wants_group_chat: false })
            .eq('id', guest.id);
        }
      }
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Leave event group chat error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
