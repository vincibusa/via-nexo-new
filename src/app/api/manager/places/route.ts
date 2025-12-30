import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
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

    // Get query params
    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const search = searchParams.get('search') || ''
    const filter = searchParams.get('filter') || 'all'
    const category = searchParams.get('category') || 'all'

    const from = (page - 1) * limit
    const to = from + limit - 1

    // Build query - all published and approved places for managers to choose from
    let query = supabase
      .from('places')
      .select('*', { count: 'exact' })
      .eq('is_published', true)
      .eq('verification_status', 'approved')
      .order('name', { ascending: true })

    // Apply filters
    if (search) {
      query = query.or(`name.ilike.%${search}%,address.ilike.%${search}%,city.ilike.%${search}%`)
    }

    if (category !== 'all') {
      query = query.eq('place_type', category)
    }

    // Apply pagination
    query = query.range(from, to)

    const { data: places, error, count } = await query

    if (error) {
      console.error('Error fetching places:', error)
      return NextResponse.json(
        { error: 'Failed to fetch places' },
        { status: 500 }
      )
    }

    const totalPages = Math.ceil((count || 0) / limit)

    return NextResponse.json({
      places: places || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages,
      },
    })
  } catch (error) {
    console.error('Error in manager places API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST removed - managers don't create places, only events
// Place creation is handled by admins through the admin panel
