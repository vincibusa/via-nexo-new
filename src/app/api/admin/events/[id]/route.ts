import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { embedEvent } from '@/lib/jobs/embedding-job'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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

    // Fetch event
    const { data: event, error } = await supabase
      .from('events')
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Event not found' }, { status: 404 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Fetch related data separately to avoid schema cache issues
    if (event?.place_id) {
      const { data: place } = await supabase
        .from('places')
        .select('id, name, city')
        .eq('id', event.place_id)
        .single()
      if (place) event.place = place
    }

    if (event?.owner_id) {
      const { data: owner } = await supabase
        .from('profiles')
        .select('id, display_name, email')
        .eq('id', event.owner_id)
        .single()
      if (owner) event.owner = owner
    }

    return NextResponse.json({ event })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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

    // Get update data
    const body = await request.json()

    // Whitelist of fields that can be updated
    const allowedFields = [
      'title',
      'description',
      'event_type',
      'start_datetime',
      'end_datetime',
      'place_id',
      'location',
      'genre',
      'lineup',
      'performers',
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

    // Validate dates if provided
    if (updates.start_datetime && updates.end_datetime) {
      if (new Date(updates.end_datetime) <= new Date(updates.start_datetime)) {
        return NextResponse.json(
          { error: 'end_datetime must be after start_datetime' },
          { status: 400 }
        )
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
      .select('*')
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Event not found' }, { status: 404 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Check if semantic fields were changed (trigger re-embedding)
    const semanticFields = ['title', 'description', 'genre', 'lineup']
    const changedSemanticFields = semanticFields.some(field => field in updates)

    if (changedSemanticFields && event.is_published) {
      try {
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

    // Fetch related data separately
    if (event?.place_id) {
      const { data: place } = await supabase
        .from('places')
        .select('id, name, city')
        .eq('id', event.place_id)
        .single()
      if (place) event.place = place
    }

    if (event?.owner_id) {
      const { data: owner } = await supabase
        .from('profiles')
        .select('id, display_name, email')
        .eq('id', event.owner_id)
        .single()
      if (owner) event.owner = owner
    }

    return NextResponse.json({ event })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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

    // Delete embeddings first (cascade should handle this, but being explicit)
    await supabase
      .from('embeddings')
      .delete()
      .eq('entity_type', 'event')
      .eq('entity_id', id)

    // Delete event
    const { error } = await supabase
      .from('events')
      .delete()
      .eq('id', id)

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Event not found' }, { status: 404 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
