import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

    const { data: discoveryItem, error } = await supabase
      .from('discovery')
      .select(`
        *,
        event:events!discovery_event_id_fkey(
          id,
          title
        )
      `)
      .eq('id', id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Discovery item not found' }, { status: 404 })
      }
      console.error('Error fetching discovery item:', error)
      return NextResponse.json(
        { error: 'Failed to fetch discovery item' },
        { status: 500 }
      )
    }

    return NextResponse.json({ item: discoveryItem })
  } catch (error) {
    console.error('Error in admin discovery GET by ID:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PUT(
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

    const body = await request.json()

    // Whitelist of fields that can be updated
    const allowedFields = [
      'media_url',
      'media_type',
      'thumbnail_url',
      'event_id',
      'title',
      'description',
      'display_order',
      'is_active',
      'start_date',
      'end_date',
    ]

    // Filter to only allowed fields
    const updates: any = {}
    for (const field of allowedFields) {
      if (field in body) {
        updates[field] = body[field]
      }
    }

    // Validate media_type if provided
    if (updates.media_type && !['image', 'video'].includes(updates.media_type)) {
      return NextResponse.json(
        { error: 'media_type must be "image" or "video"' },
        { status: 400 }
      )
    }

    const { data: updatedItem, error } = await supabase
      .from('discovery')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating discovery item:', error)
      return NextResponse.json(
        { error: 'Failed to update discovery item' },
        { status: 500 }
      )
    }

    return NextResponse.json({ item: updatedItem })
  } catch (error) {
    console.error('Error in admin discovery PUT:', error)
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

    const { error } = await supabase
      .from('discovery')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting discovery item:', error)
      return NextResponse.json(
        { error: 'Failed to delete discovery item' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in admin discovery DELETE:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

