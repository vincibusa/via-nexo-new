import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const supabase = await createClient()

    // Verify admin role
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }, { status: 401 })
    }

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Admin access required' } }, { status: 403 })
    }

    // Fetch stats in parallel
    const [
      { count: totalPlaces },
      { count: totalEvents },
      { count: totalManagers },
      { count: totalUsers },
      { count: pendingManagerRequests },
      { count: placesNeedingVerification },
      { count: suggestionsLast7Days },
    ] = await Promise.all([
      supabase.from('places').select('*', { count: 'exact', head: true }),
      supabase.from('events').select('*', { count: 'exact', head: true }),
      supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'manager'),
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('manager_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('places').select('*', { count: 'exact', head: true }).eq('verified', false).eq('published', true),
      supabase
        .from('suggestions_logs')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
    ])

    return NextResponse.json({
      totalPlaces: totalPlaces || 0,
      totalEvents: totalEvents || 0,
      totalManagers: totalManagers || 0,
      totalUsers: totalUsers || 0,
      pendingManagerRequests: pendingManagerRequests || 0,
      placesNeedingVerification: placesNeedingVerification || 0,
      suggestionsLast7Days: suggestionsLast7Days || 0,
    })
  } catch (error) {
    console.error('Dashboard stats error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } },
      { status: 500 }
    )
  }
}
