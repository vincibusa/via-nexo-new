import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') as 'going' | 'interested' | 'not_going' || undefined;
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

    // Build query
    let query = supabase
      .from('event_attendance')
      .select(
        `
        *,
        user:profiles(*)
      `
      )
      .eq('event_id', id);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: attendance, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching attendance:', error);
      return NextResponse.json(
        { error: 'Failed to fetch attendance' },
        { status: 500 }
      );
    }

    // Get current user's attendance status
    const { data: userAttendance } = await supabase
      .from('event_attendance')
      .select('status')
      .eq('event_id', id)
      .eq('user_id', user.id)
      .single();

    // Format response
    const attendanceList = attendance?.map((item: any) => ({
      ...item.user,
      attendance_status: item.status,
      checked_in: item.checked_in,
      checked_in_at: item.checked_in_at,
    })) || [];

    return NextResponse.json({
      attendees: attendanceList,
      user_status: userAttendance?.status || null,
    });
  } catch (error) {
    console.error('Get attendance error:', error);
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
    const { status } = body;

    if (!status || !['going', 'interested', 'not_going'].includes(status)) {
      return NextResponse.json(
        { error: 'Valid status required: going, interested, or not_going' },
        { status: 400 }
      );
    }

    // Check if already marked attendance
    const { data: existingAttendance } = await supabase
      .from('event_attendance')
      .select('id')
      .eq('event_id', id)
      .eq('user_id', user.id)
      .single();

    if (existingAttendance) {
      // Update existing
      const { data: updated, error } = await supabase
        .from('event_attendance')
        .update({ status })
        .eq('event_id', id)
        .eq('user_id', user.id)
        .select('*')
        .single();

      if (error) {
        return NextResponse.json(
          { error: 'Failed to update attendance' },
          { status: 500 }
        );
      }

      return NextResponse.json(updated);
    }

    // Create new attendance record
    const { data: attendance, error } = await supabase
      .from('event_attendance')
      .insert({
        event_id: id,
        user_id: user.id,
        status,
      })
      .select('*')
      .single();

    if (error) {
      console.error('Error marking attendance:', error);
      return NextResponse.json(
        { error: 'Failed to mark attendance' },
        { status: 500 }
      );
    }

    return NextResponse.json(attendance, { status: 201 });
  } catch (error) {
    console.error('Mark attendance error:', error);
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

    // Delete attendance
    const { error } = await supabase
      .from('event_attendance')
      .delete()
      .eq('event_id', id)
      .eq('user_id', user.id);

    if (error) {
      console.error('Error removing attendance:', error);
      return NextResponse.json(
        { error: 'Failed to remove attendance' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Remove attendance error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
