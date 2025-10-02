import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { embedEvent } from '@/lib/jobs/embedding-job'

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

    const from = (page - 1) * limit
    const to = from + limit - 1

    // Build query - only manager's own events
    let query = supabase
      .from('events')
      .select('*', { count: 'exact' })
      .eq('owner_id', user.id)
      .order('start_datetime', { ascending: false })

    // Apply filters
    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`)
    }

    if (filter === 'published') {
      query = query.eq('is_published', true)
    } else if (filter === 'unpublished') {
      query = query.eq('is_published', false)
    } else if (filter === 'upcoming') {
      query = query.gte('start_datetime', new Date().toISOString())
    } else if (filter === 'past') {
      query = query.lt('start_datetime', new Date().toISOString())
    }

    // Apply pagination
    query = query.range(from, to)

    const { data: events, error, count } = await query

    if (error) {
      console.error('Error fetching events:', error)
      return NextResponse.json(
        { error: 'Failed to fetch events' },
        { status: 500 }
      )
    }

    const totalPages = Math.ceil((count || 0) / limit)

    return NextResponse.json({
      events: events || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages,
      },
    })
  } catch (error) {
    console.error('Error in manager events API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
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

    const body = await request.json()

    // Auto-set owner_id and default values
    const eventData = {
      ...body,
      owner_id: user.id,
      verification_status: 'pending',
      embeddings_status: 'pending',
    }

    const { data: event, error } = await supabase
      .from('events')
      .insert(eventData)
      .select()
      .single()

    if (error) {
      console.error('Error creating event:', error)
      return NextResponse.json(
        { error: 'Failed to create event' },
        { status: 500 }
      )
    }

    // Trigger automatic embedding if published
    if (event.is_published) {
      try {
        console.log(`[Manager API] Triggering embedding for new event ${event.id}`)
        await embedEvent(event.id, supabase)
      } catch (embedError) {
        console.error('Error embedding event after creation:', embedError)
        // Don't fail the request, just log the error
        // Status will remain 'pending' and can be retried later
      }
    }

    return NextResponse.json({ event }, { status: 201 })
  } catch (error) {
    console.error('Error in create event API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
