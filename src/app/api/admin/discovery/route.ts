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
    const filter = searchParams.get('filter') || 'all' // all, active, inactive
    const offset = (page - 1) * limit

    // Build query
    let query = supabase
      .from('discovery')
      .select(`
        id,
        media_url,
        media_type,
        thumbnail_url,
        event_id,
        title,
        description,
        display_order,
        views_count,
        likes_count,
        is_active,
        start_date,
        end_date,
        created_at,
        updated_at,
        created_by,
        event:events!discovery_event_id_fkey(
          id,
          title
        )
      `, { count: 'exact' })

    // Apply filters
    if (filter === 'active') {
      query = query.eq('is_active', true)
    } else if (filter === 'inactive') {
      query = query.eq('is_active', false)
    }

    // Apply search
    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`)
    }

    // Order by display_order then created_at
    query = query.order('display_order', { ascending: false }).order('created_at', { ascending: false })

    // Apply pagination
    query = query.range(offset, offset + limit - 1)

    const { data: discoveryItems, error, count } = await query

    if (error) {
      console.error('Error fetching discovery items:', error)
      return NextResponse.json(
        { error: 'Failed to fetch discovery items' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      items: discoveryItems || [],
      total: count || 0,
      page,
      limit,
    })
  } catch (error) {
    console.error('Error in admin discovery GET:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
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

    const body = await request.json()

    // Validate required fields
    if (!body.media_url || !body.media_type || !body.event_id) {
      return NextResponse.json(
        { error: 'Missing required fields: media_url, media_type, event_id' },
        { status: 400 }
      )
    }

    // Validate media_type
    if (!['image', 'video'].includes(body.media_type)) {
      return NextResponse.json(
        { error: 'media_type must be "image" or "video"' },
        { status: 400 }
      )
    }

    // Get max display_order to set new item at the top
    const { data: maxOrder } = await supabase
      .from('discovery')
      .select('display_order')
      .order('display_order', { ascending: false })
      .limit(1)
      .single()

    const newDisplayOrder = (maxOrder?.display_order || 0) + 1

    // Create discovery item
    const { data: newItem, error } = await supabase
      .from('discovery')
      .insert({
        media_url: body.media_url,
        media_type: body.media_type,
        thumbnail_url: body.thumbnail_url,
        event_id: body.event_id,
        title: body.title,
        description: body.description,
        display_order: body.display_order ?? newDisplayOrder,
        is_active: body.is_active ?? true,
        start_date: body.start_date,
        end_date: body.end_date,
        created_by: user.id,
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating discovery item:', error)
      return NextResponse.json(
        { error: 'Failed to create discovery item' },
        { status: 500 }
      )
    }

    return NextResponse.json({ item: newItem }, { status: 201 })
  } catch (error) {
    console.error('Error in admin discovery POST:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}









