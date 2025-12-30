import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { handleCorsPreflight } from '@/lib/cors'

export interface RaveScoreEvent {
  id: string
  type: string
  eventTitle: string | null
  eventDate: string | null
  pointsImpact: number | null
  occurredAt: string
}

export interface RaveScoreEventsResponse {
  events: RaveScoreEvent[]
  total: number
  hasMore: boolean
}

export async function OPTIONS(request: NextRequest) {
  const preflightResponse = handleCorsPreflight(request)
  if (preflightResponse) {
    return preflightResponse
  }
  return new Response(null, { status: 204 })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params
    const supabase = await createClient()

    // Get query params
    const searchParams = request.nextUrl.searchParams
    const type = searchParams.get('type') // presence|trust|crew
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100)
    const offset = parseInt(searchParams.get('offset') || '0')

    // Build query
    let query = supabase
      .from('rave_score_events')
      .select('id, event_type, event_title, event_date, points_impact, occurred_at', {
        count: 'exact',
      })
      .eq('user_id', userId)
      .order('occurred_at', { ascending: false })

    // Filter by type if provided
    if (type) {
      const typeMap: Record<string, string[]> = {
        presence: ['check_in'],
        trust: ['show', 'early_cancel', 'late_cancel', 'no_show'],
        crew: ['hosted_guest_show'],
      }

      const types = typeMap[type] || []
      if (types.length > 0) {
        query = query.in('event_type', types)
      }
    }

    // Paginate
    query = query.range(offset, offset + limit - 1)

    const { data, error, count } = await query

    if (error) {
      console.error('Error fetching RAVE score events:', error)
      return NextResponse.json(
        { error: 'Failed to fetch events' },
        { status: 500 }
      )
    }

    const events: RaveScoreEvent[] = (data || []).map((event: any) => ({
      id: event.id,
      type: event.event_type,
      eventTitle: event.event_title,
      eventDate: event.event_date,
      pointsImpact: event.points_impact,
      occurredAt: event.occurred_at,
    }))

    return NextResponse.json({
      events,
      total: count || 0,
      hasMore: (offset + limit) < (count || 0),
    } as RaveScoreEventsResponse)
  } catch (error) {
    console.error('RAVE score events API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
