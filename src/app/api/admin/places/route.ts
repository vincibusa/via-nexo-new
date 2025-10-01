import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const search = searchParams.get('search') || ''
    const filter = searchParams.get('filter') || 'all' // all, verified, unverified, published, unpublished
    const category = searchParams.get('category') || ''
    const city = searchParams.get('city') || ''
    const offset = (page - 1) * limit

    // Build query
    let query = supabase
      .from('places')
      .select(`
        id,
        name,
        address,
        city,
        place_type,
        verification_status,
        is_published,
        is_listed,
        embeddings_status,
        created_at,
        updated_at,
        owner:profiles!places_owner_id_fkey(id, display_name, email)
      `, { count: 'exact' })

    // Apply search
    if (search) {
      query = query.or(`name.ilike.%${search}%,address.ilike.%${search}%,city.ilike.%${search}%`)
    }

    // Apply filters
    if (filter === 'verified') {
      query = query.eq('verification_status', 'approved')
    } else if (filter === 'unverified') {
      query = query.eq('verification_status', 'pending')
    } else if (filter === 'published') {
      query = query.eq('is_published', true)
    } else if (filter === 'unpublished') {
      query = query.eq('is_published', false)
    }

    if (category) {
      query = query.eq('place_type', category)
    }

    if (city) {
      query = query.ilike('city', `%${city}%`)
    }

    // Apply pagination and sorting
    query = query.range(offset, offset + limit - 1).order('created_at', { ascending: false })

    const { data: places, error, count } = await query

    if (error) {
      console.error('Error fetching places:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      places,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get place data
    const placeData = await request.json()

    // Validate required fields
    if (!placeData.name || !placeData.address || !placeData.city || !placeData.lat || !placeData.lon || !placeData.place_type) {
      return NextResponse.json(
        { error: 'Missing required fields: name, address, city, lat, lon, place_type' },
        { status: 400 }
      )
    }

    // Create geography point from lat/lon
    const location = `POINT(${placeData.lon} ${placeData.lat})`

    // Insert place
    const { data: place, error } = await supabase
      .from('places')
      .insert({
        ...placeData,
        location,
        owner_id: placeData.owner_id || user.id, // Admin can assign to specific manager or self
        verification_status: placeData.verification_status || 'approved', // Admin can create pre-approved
        is_published: placeData.is_published !== undefined ? placeData.is_published : false,
        is_listed: placeData.is_listed !== undefined ? placeData.is_listed : true,
        embeddings_status: 'pending',
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating place:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ place }, { status: 201 })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
