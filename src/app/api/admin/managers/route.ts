import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check if user is admin
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

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get query params
    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const search = searchParams.get('search') || ''

    const from = (page - 1) * limit
    const to = from + limit - 1

    // Build query for managers
    let query = supabase
      .from('profiles')
      .select('id, email, display_name, created_at', { count: 'exact' })
      .eq('role', 'manager')
      .order('created_at', { ascending: false })

    // Apply search filter
    if (search) {
      query = query.or(`email.ilike.%${search}%,display_name.ilike.%${search}%`)
    }

    // Apply pagination
    query = query.range(from, to)

    const { data: managers, error, count } = await query

    if (error) {
      console.error('Error fetching managers:', error)
      return NextResponse.json(
        { error: 'Failed to fetch managers' },
        { status: 500 }
      )
    }

    // Get places count for each manager
    const managersWithPlaces = await Promise.all(
      (managers || []).map(async (manager) => {
        const { count: placesCount } = await supabase
          .from('places')
          .select('*', { count: 'exact', head: true })
          .eq('manager_id', manager.id)

        return {
          ...manager,
          places_count: placesCount || 0,
        }
      })
    )

    const totalPages = Math.ceil((count || 0) / limit)

    return NextResponse.json({
      managers: managersWithPlaces,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages,
      },
    })
  } catch (error) {
    console.error('Error in managers API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
