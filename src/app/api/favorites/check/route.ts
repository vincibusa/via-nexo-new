import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/favorites/check?resource_type=place&resource_id=xxx
 * Check if a resource is in user's favorites
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get query parameters
    const { searchParams } = new URL(request.url)
    const entity_type = searchParams.get('entity_type') || searchParams.get('resource_type')
    const entity_id = searchParams.get('entity_id') || searchParams.get('resource_id')

    if (!entity_type || !entity_id) {
      return NextResponse.json(
        { error: 'Missing entity_type or entity_id' },
        { status: 400 }
      )
    }

    if (entity_type !== 'place' && entity_type !== 'event') {
      return NextResponse.json(
        { error: 'Invalid entity_type. Must be "place" or "event"' },
        { status: 400 }
      )
    }

    // Check if favorite exists
    const { data: favorite, error: fetchError } = await supabase
      .from('favorites')
      .select('id')
      .eq('user_id', user.id)
      .eq('entity_type', entity_type)
      .eq('entity_id', entity_id)
      .maybeSingle()

    if (fetchError) {
      console.error('Error checking favorite:', fetchError)
      return NextResponse.json(
        { error: 'Failed to check favorite status' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      is_favorite: !!favorite,
      favorite_id: favorite?.id || null,
    })
  } catch (error) {
    console.error('Error in GET /api/favorites/check:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
