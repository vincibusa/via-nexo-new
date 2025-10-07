import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { embedEvent } from '@/lib/jobs/embedding-job'
import { notifyUsersAboutNewEvent } from '@/lib/notifications/event-notifications'

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
    const eventType = searchParams.get('eventType') || ''
    const placeId = searchParams.get('placeId') || ''
    const dateFilter = searchParams.get('dateFilter') || 'all' // all, upcoming, past, today
    const offset = (page - 1) * limit

    // Build query
    let query = supabase
      .from('events')
      .select(`
        id,
        title,
        start_datetime,
        end_datetime,
        event_type,
        verification_status,
        is_published,
        is_listed,
        is_cancelled,
        embeddings_status,
        created_at,
        updated_at,
        place:places!events_place_id_fkey(id, name, city),
        owner:profiles!events_owner_id_fkey(id, display_name, email)
      `, { count: 'exact' })

    // Apply search
    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`)
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

    if (eventType && eventType !== 'all') {
      query = query.eq('event_type', eventType)
    }

    if (placeId) {
      query = query.eq('place_id', placeId)
    }

    // Date filters
    const now = new Date().toISOString()
    if (dateFilter === 'upcoming') {
      query = query.gte('start_datetime', now)
    } else if (dateFilter === 'past') {
      query = query.lt('end_datetime', now)
    } else if (dateFilter === 'today') {
      const startOfDay = new Date()
      startOfDay.setHours(0, 0, 0, 0)
      const endOfDay = new Date()
      endOfDay.setHours(23, 59, 59, 999)
      query = query
        .gte('start_datetime', startOfDay.toISOString())
        .lte('start_datetime', endOfDay.toISOString())
    }

    // Apply pagination and sorting
    query = query.range(offset, offset + limit - 1).order('start_datetime', { ascending: false })

    const { data: events, error, count } = await query

    if (error) {
      console.error('Error fetching events:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      events,
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

    // Get event data
    const eventData = await request.json()

    // Validate required fields
    if (!eventData.title || !eventData.place_id || !eventData.start_datetime || !eventData.end_datetime) {
      return NextResponse.json(
        { error: 'Missing required fields: title, place_id, start_datetime, end_datetime' },
        { status: 400 }
      )
    }

    // Validate dates
    if (new Date(eventData.end_datetime) <= new Date(eventData.start_datetime)) {
      return NextResponse.json(
        { error: 'end_datetime must be after start_datetime' },
        { status: 400 }
      )
    }

    // Insert event
    const { data: event, error } = await supabase
      .from('events')
      .insert({
        ...eventData,
        owner_id: eventData.owner_id || user.id, // Admin can assign to specific manager or self
        verification_status: eventData.verification_status || 'approved', // Admin can create pre-approved
        is_published: eventData.is_published !== undefined ? eventData.is_published : false,
        is_listed: eventData.is_listed !== undefined ? eventData.is_listed : true,
        is_cancelled: eventData.is_cancelled !== undefined ? eventData.is_cancelled : false,
        embeddings_status: 'pending',
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating event:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Trigger embedding if event is published
    if (event.is_published) {
      try {
        await embedEvent(event.id)
      } catch (embedError) {
        console.error('Error embedding event:', embedError)
        // Continue anyway, don't fail the creation
      }
    }

    // Send push notifications to nearby users if event is published and listed
    if (event.is_published && event.is_listed && !event.is_cancelled) {
      try {
        // Fetch place info for notification
        const { data: place } = await supabase
          .from('places')
          .select('name, lat, lon')
          .eq('id', event.place_id)
          .single()

        if (place) {
          console.log('[Admin Events] Sending notifications for event:', event.id)
          const notificationResult = await notifyUsersAboutNewEvent(supabase, {
            eventId: event.id,
            eventTitle: event.title,
            placeId: event.place_id,
            placeName: place.name,
            startDatetime: event.start_datetime,
            latitude: place.lat,
            longitude: place.lon,
          })

          console.log('[Admin Events] Notification result:', notificationResult)
        } else {
          console.warn('[Admin Events] Place not found, skipping notifications')
        }
      } catch (notifyError) {
        console.error('[Admin Events] Error sending notifications:', notifyError)
        // Don't fail the request if notifications fail
      }
    }

    return NextResponse.json({ event }, { status: 201 })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
