import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Webhook to invalidate cache when places/events are updated
 * Called by Supabase triggers
 */
export async function POST(request: NextRequest) {
  try {
    const { type, record } = await request.json()

    const supabase = await createClient()

    // Invalidate cache entries related to this place/event
    if (type === 'place.updated' || type === 'event.updated') {
      // Delete all cache entries (simple approach)
      // Alternative: delete only entries containing this place_id
      const { error } = await supabase
        .from('embeddings_cache')
        .delete()
        .lt('created_at', new Date().toISOString())

      if (error) {
        console.error('Error invalidating cache:', error)
      }

      return NextResponse.json({
        success: true,
        message: 'Cache invalidated',
      })
    }

    return NextResponse.json({
      success: true,
      message: 'No action needed',
    })
  } catch (error) {
    console.error('Error in cache invalidation webhook:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
