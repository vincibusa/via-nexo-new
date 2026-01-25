import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { withRoleProtection, AuthContext } from '@/lib/middleware/auth'
import {
  getPlacesPendingEmbedding,
  getEventsPendingEmbedding,
  batchEmbedPlaces,
  batchEmbedEvents,
} from '@/lib/jobs/embedding-job'

async function handleBatchEmbedding(request: NextRequest, user: AuthContext): Promise<NextResponse> {
  const supabase = await createClient()

  const body = await request.json()
  const { action, limit = 100 } = body

  // VALIDATION: Require action parameter
  if (!action) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Action parameter is required' } },
      { status: 400 }
    )
  }

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
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid action' } },
      { status: 400 }
    )
  }
}

export const POST = withRoleProtection(handleBatchEmbedding, ['admin'])
