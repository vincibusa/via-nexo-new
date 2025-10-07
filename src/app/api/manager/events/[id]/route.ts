import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { embedEvent } from '@/lib/jobs/embedding-job'
import { notifyUsersAboutNewEvent } from '@/lib/notifications/event-notifications'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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

    // Fetch event - ensure it belongs to this manager
    const { data: event, error } = await supabase
      .from('events')
      .select('*')
      .eq('id', id)
      .eq('owner_id', user.id)
      .single()

    if (error || !event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    // Fetch place info separately if needed
    if (event?.place_id) {
      const { data: place } = await supabase
        .from('places')
        .select('id, name, city')
        .eq('id', event.place_id)
        .single()
      if (place) event.place = place
    }

    return NextResponse.json({ event })
  } catch (error) {
    console.error('Error fetching event:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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

    // Verify ownership and get current state
    const { data: existingEvent } = await supabase
      .from('events')
      .select('owner_id, is_published, is_listed, is_cancelled')
      .eq('id', id)
      .single()

    if (!existingEvent || existingEvent.owner_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const wasUnpublished = !existingEvent.is_published

    const body = await request.json()

    // Managers cannot change verification_status
    delete body.verification_status

    // Whitelist of fields that can be updated
    const allowedFields = [
      'title',
      'description',
      'event_type',
      'start_datetime',
      'end_datetime',
      'place_id',
      'genre',
      'lineup',
      'ticket_url',
      'ticket_price_min',
      'ticket_price_max',
      'cover_image_url',
      'image_urls',
      'is_published',
      'is_featured',
      'age_restriction',
      'capacity',
      'metadata'
    ]

    // Filter to only allowed fields
    const updates: any = {}
    for (const field of allowedFields) {
      if (field in body) {
        updates[field] = body[field]
      }
    }

    // Update event
    const { data: event, error } = await supabase
      .from('events')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('owner_id', user.id)
      .select('*')
      .single()

    if (error) {
      console.error('Error updating event:', error)
      return NextResponse.json(
        { error: 'Failed to update event' },
        { status: 500 }
      )
    }

    // Check if semantic fields were changed (trigger re-embedding)
    const semanticFields = ['title', 'description', 'genre', 'lineup']
    const changedSemanticFields = semanticFields.some(field => field in updates)

    if (changedSemanticFields && event.is_published) {
      try {
        console.log(`[Manager API] Triggering re-embedding for updated event ${event.id}`)
        await embedEvent(event.id, supabase)
      } catch (embedError) {
        console.error('Error embedding event after update:', embedError)
        // Set status to pending if embedding fails
        await supabase
          .from('events')
          .update({ embeddings_status: 'pending' })
          .eq('id', id)
      }
    }

    // Send notifications if event was just published (went from unpublished to published)
    const nowPublished = updates.is_published === true && wasUnpublished
    if (nowPublished && event.is_listed && !event.is_cancelled) {
      try {
        // Fetch place info for notification
        const { data: place } = await supabase
          .from('places')
          .select('name, lat, lon')
          .eq('id', event.place_id)
          .single()

        if (place) {
          console.log('[Manager Events PATCH] Sending notifications for newly published event:', event.id)
          const notificationResult = await notifyUsersAboutNewEvent(supabase, {
            eventId: event.id,
            eventTitle: event.title,
            placeId: event.place_id,
            placeName: place.name,
            startDatetime: event.start_datetime,
            latitude: place.lat,
            longitude: place.lon,
          })

          console.log('[Manager Events PATCH] Notification result:', notificationResult)
        } else {
          console.warn('[Manager Events PATCH] Place not found, skipping notifications')
        }
      } catch (notifyError) {
        console.error('[Manager Events PATCH] Error sending notifications:', notifyError)
        // Don't fail the request if notifications fail
      }
    }

    // Fetch related data separately
    if (event?.place_id) {
      const { data: place } = await supabase
        .from('places')
        .select('id, name, city')
        .eq('id', event.place_id)
        .single()
      if (place) event.place = place
    }

    return NextResponse.json({ event })
  } catch (error) {
    console.error('Error in update event API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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

    // Delete embeddings first (cascade should handle this, but being explicit)
    await supabase
      .from('embeddings')
      .delete()
      .eq('entity_type', 'event')
      .eq('entity_id', id)

    // Delete event - RLS will ensure only owned events can be deleted
    const { error } = await supabase
      .from('events')
      .delete()
      .eq('id', id)
      .eq('owner_id', user.id)

    if (error) {
      console.error('Error deleting event:', error)
      return NextResponse.json(
        { error: 'Failed to delete event' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in delete event API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
