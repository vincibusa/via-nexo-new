import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const supabase = await createClient()

    // Check if user is manager
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'manager') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get places count
    const { count: placesCount } = await supabase
      .from('places')
      .select('*', { count: 'exact', head: true })
      .eq('manager_id', user.id)

    // Get events count
    const { count: eventsCount } = await supabase
      .from('events')
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', user.id)

    // Get upcoming events count
    const { count: upcomingEventsCount } = await supabase
      .from('events')
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', user.id)
      .gte('start_datetime', new Date().toISOString())

    return NextResponse.json({
      placesCount: placesCount || 0,
      eventsCount: eventsCount || 0,
      upcomingEventsCount: upcomingEventsCount || 0,
    })
  } catch (error) {
    console.error('Error in manager dashboard stats API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
