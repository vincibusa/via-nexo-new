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

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = parseInt(searchParams.get('offset') || '0')

    // Fetch active discovery items ordered by display_order and created_at
    const { data: discoveryItems, error } = await supabase
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
        created_at,
        event:events!discovery_event_id_fkey(
          id,
          title,
          start_datetime,
          cover_image_url,
          description,
          place:places!events_place_id_fkey(
            id,
            name
          )
        )
      `)
      .eq('is_active', true)
      .order('display_order', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('Error fetching discovery items:', error)
      return NextResponse.json(
        { error: 'Failed to fetch discovery items' },
        { status: 500 }
      )
    }

    // Check which items the user has liked
    if (discoveryItems && discoveryItems.length > 0) {
      const itemIds = discoveryItems.map((item) => item.id)
      const { data: userLikes } = await supabase
        .from('discovery_likes')
        .select('discovery_id')
        .eq('user_id', user.id)
        .in('discovery_id', itemIds)

      const likedIds = new Set(userLikes?.map((like) => like.discovery_id) || [])

      // Add is_liked flag to each item
      const itemsWithLikes = discoveryItems.map((item) => ({
        ...item,
        is_liked: likedIds.has(item.id),
      }))

      return NextResponse.json({ items: itemsWithLikes })
    }

    return NextResponse.json({ items: [] })
  } catch (error) {
    console.error('Error in discovery GET:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}







