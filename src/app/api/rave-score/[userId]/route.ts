import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { handleCorsPreflight } from '@/lib/cors'

interface RaveScoreRow {
  presence_score: number
  trust_score: number
  crew_bonus: number
  total_score: number
  check_ins_90d: number
  presence_label: string
  shows: number
  early_cancels: number
  late_cancels: number
  no_shows: number
  trust_rate: number | null
  trust_label: string
  hosted_guests_90d: number
  hosted_shows: number
  hosted_show_rate: number | null
  crew_label: string
}

export interface RaveScoreResponse {
  userId: string
  totalScore: number
  updatedAt: string
  presence: {
    score: number
    maxScore: number
    checkIns90d: number
    label: 'Regular' | 'Active' | 'Elite'
  }
  trust: {
    score: number
    maxScore: number
    rate: number | null
    label: 'Reliable' | 'Risk' | 'No-Show'
    breakdown: {
      shows: number
      earlyCancels: number
      lateCancels: number
      noShows: number
    }
  }
  crew: {
    score: number
    maxScore: number
    hostedGuests90d: number
    hostedShows: number
    showRate: number | null
    label: 'Connector' | 'Promoter' | 'Legend'
  }
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

    // Check cache first
    const { data: cachedScore, error: cacheError } = await supabase
      .from('rave_scores')
      .select('*')
      .eq('user_id', userId)
      .gt('expires_at', 'now()')
      .single()

    if (cachedScore && !cacheError) {
      // Return cached data
      return NextResponse.json({
        userId,
        totalScore: cachedScore.total_score,
        updatedAt: cachedScore.updated_at,
        presence: {
          score: cachedScore.presence_score,
          maxScore: 50,
          checkIns90d: cachedScore.check_ins_90d,
          label: cachedScore.presence_label,
        },
        trust: {
          score: cachedScore.trust_score,
          maxScore: 50,
          rate: cachedScore.trust_rate,
          label: cachedScore.trust_label,
          breakdown: {
            shows: cachedScore.shows,
            earlyCancels: cachedScore.early_cancels,
            lateCancels: cachedScore.late_cancels,
            noShows: cachedScore.no_shows,
          },
        },
        crew: {
          score: cachedScore.crew_bonus,
          maxScore: 10,
          hostedGuests90d: cachedScore.hosted_guests_90d,
          hostedShows: cachedScore.hosted_shows,
          showRate: cachedScore.hosted_show_rate,
          label: cachedScore.crew_label,
        },
      } as RaveScoreResponse)
    }

    // Calculate fresh score
    const { data: calculatedScore, error: calcError } = await supabase.rpc(
      'calculate_rave_score',
      { p_user_id: userId }
    )

    if (calcError || !calculatedScore || calculatedScore.length === 0) {
      return NextResponse.json(
        { error: 'Failed to calculate RAVE score' },
        { status: 500 }
      )
    }

    const scoreData = (calculatedScore as RaveScoreRow[])[0]

    // Upsert cache - Get existing ID first
    const { data: existingScore } = await supabase
      .from('rave_scores')
      .select('id')
      .eq('user_id', userId)
      .single()

    const { error: upsertError } = await supabase
      .from('rave_scores')
      .upsert({
        id: existingScore?.id, // Include primary key for proper upsert
        user_id: userId,
        presence_score: scoreData.presence_score,
        trust_score: scoreData.trust_score,
        crew_bonus: scoreData.crew_bonus,
        check_ins_90d: scoreData.check_ins_90d,
        presence_label: scoreData.presence_label,
        shows: scoreData.shows,
        early_cancels: scoreData.early_cancels,
        late_cancels: scoreData.late_cancels,
        no_shows: scoreData.no_shows,
        trust_rate: scoreData.trust_rate,
        trust_label: scoreData.trust_label,
        hosted_guests_90d: scoreData.hosted_guests_90d,
        hosted_shows: scoreData.hosted_shows,
        hosted_show_rate: scoreData.hosted_show_rate,
        crew_label: scoreData.crew_label,
        calculated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour
      })

    if (upsertError) {
      console.error('Cache upsert error:', upsertError)
    }

    return NextResponse.json({
      userId,
      totalScore: scoreData.total_score,
      updatedAt: new Date().toISOString(),
      presence: {
        score: scoreData.presence_score,
        maxScore: 50,
        checkIns90d: scoreData.check_ins_90d,
        label: scoreData.presence_label,
      },
      trust: {
        score: scoreData.trust_score,
        maxScore: 50,
        rate: scoreData.trust_rate,
        label: scoreData.trust_label,
        breakdown: {
          shows: scoreData.shows,
          earlyCancels: scoreData.early_cancels,
          lateCancels: scoreData.late_cancels,
          noShows: scoreData.no_shows,
        },
      },
      crew: {
        score: scoreData.crew_bonus,
        maxScore: 10,
        hostedGuests90d: scoreData.hosted_guests_90d,
        hostedShows: scoreData.hosted_shows,
        showRate: scoreData.hosted_show_rate,
        label: scoreData.crew_label,
      },
    } as RaveScoreResponse)
  } catch (error) {
    console.error('RAVE score API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
