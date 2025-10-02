import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { embedPlace } from '@/lib/jobs/embedding-job'

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

    // Fetch place with owner info
    console.log(`[GET] Fetching place with id: ${id}`)
    const { data: place, error } = await supabase
      .from('places')
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      console.error(`[GET] Error fetching place:`, error)
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Place not found' }, { status: 404 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    console.log(`[GET] Place found:`, place?.id)

    // Fetch owner separately to avoid schema cache issues
    if (place?.owner_id) {
      const { data: owner } = await supabase
        .from('profiles')
        .select('id, display_name, email')
        .eq('id', place.owner_id)
        .single()

      if (owner) {
        place.owner = owner
      }
    }

    return NextResponse.json({ place })
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
    console.log(`[PATCH] Received fields:`, Object.keys(body))

    // Whitelist of fields that can be updated
    const allowedFields = [
      'name',
      'description',
      'place_type',
      'address',
      'city',
      'postal_code',
      'country',
      'location',
      'lat',
      'lon',
      'phone',
      'website',
      'instagram_handle',
      'facebook_url',
      'opening_hours',
      'cover_image_url',
      'image_urls',
      'verification_status',
      'is_published',
      'is_listed',
      'price_range',
      'ambience_tags',
      'music_genre',
      'avg_age_range',
      'capacity',
      'google_place_id',
      'metadata'
    ]

    // Filter to only allowed fields
    const updates: any = {}
    for (const field of allowedFields) {
      if (field in body) {
        updates[field] = body[field]
      }
    }

    console.log(`[PATCH] Updating place ${id} with:`, Object.keys(updates))

    // Update place
    const { data: place, error } = await supabase
      .from('places')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single()

    if (error) {
      console.error(`[PATCH] Error updating place:`, error)
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Place not found' }, { status: 404 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    console.log(`[PATCH] Place updated successfully:`, place?.id)

    // Check if semantic fields were changed (trigger re-embedding)
    const semanticFields = ['name', 'description', 'ambience_tags', 'music_genre']
    const changedSemanticFields = semanticFields.some(field => field in updates)

    if (changedSemanticFields && place.is_published && place.is_listed) {
      try {
        await embedPlace(place.id)
      } catch (embedError) {
        console.error('Error embedding place after update:', embedError)
        // Set status to pending if embedding fails
        await supabase
          .from('places')
          .update({ embeddings_status: 'pending' })
          .eq('id', id)
      }
    }

    // Fetch owner info separately if needed
    if (place.owner_id) {
      const { data: owner } = await supabase
        .from('profiles')
        .select('id, display_name, email')
        .eq('id', place.owner_id)
        .single()

      if (owner) {
        place.owner = owner
      }
    }

    return NextResponse.json({ place })
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
      .eq('entity_type', 'place')
      .eq('entity_id', id)

    // Delete place
    const { error } = await supabase
      .from('places')
      .delete()
      .eq('id', id)

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Place not found' }, { status: 404 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
