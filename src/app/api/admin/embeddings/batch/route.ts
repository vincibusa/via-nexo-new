import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import {
  getPlacesPendingEmbedding,
  getEventsPendingEmbedding,
  batchEmbedPlaces,
  batchEmbedEvents,
} from '@/lib/jobs/embedding-job'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check if user is admin
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

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { action, limit = 100 } = body

    if (action === 'embed_pending_places') {
      const placeIds = await getPlacesPendingEmbedding(limit)

      if (placeIds.length === 0) {
        return NextResponse.json({
          success: true,
          message: 'No pending places to embed',
          results: { success: 0, failed: 0 },
        })
      }

      const results = await batchEmbedPlaces(placeIds, 500)

      return NextResponse.json({
        success: true,
        message: `Embedded ${results.success} places, ${results.failed} failed`,
        results,
      })
    } else if (action === 'embed_pending_events') {
      const eventIds = await getEventsPendingEmbedding(limit)

      if (eventIds.length === 0) {
        return NextResponse.json({
          success: true,
          message: 'No pending events to embed',
          results: { success: 0, failed: 0 },
        })
      }

      const results = await batchEmbedEvents(eventIds, 500)

      return NextResponse.json({
        success: true,
        message: `Embedded ${results.success} events, ${results.failed} failed`,
        results,
      })
    } else if (action === 'retry_failed_places') {
      const { data: places } = await supabase
        .from('places')
        .select('id')
        .eq('embeddings_status', 'failed')
        .limit(limit)

      const placeIds = places?.map((p) => p.id) || []

      if (placeIds.length === 0) {
        return NextResponse.json({
          success: true,
          message: 'No failed places to retry',
          results: { success: 0, failed: 0 },
        })
      }

      const results = await batchEmbedPlaces(placeIds, 500)

      return NextResponse.json({
        success: true,
        message: `Retried ${results.success} places, ${results.failed} failed`,
        results,
      })
    } else if (action === 'retry_failed_events') {
      const { data: events } = await supabase
        .from('events')
        .select('id')
        .eq('embeddings_status', 'failed')
        .limit(limit)

      const eventIds = events?.map((e) => e.id) || []

      if (eventIds.length === 0) {
        return NextResponse.json({
          success: true,
          message: 'No failed events to retry',
          results: { success: 0, failed: 0 },
        })
      }

      const results = await batchEmbedEvents(eventIds, 500)

      return NextResponse.json({
        success: true,
        message: `Retried ${results.success} events, ${results.failed} failed`,
        results,
      })
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    console.error('Error in batch embedding:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
}
