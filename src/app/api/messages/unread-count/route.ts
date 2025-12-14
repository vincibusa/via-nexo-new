import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'edge'

/**
 * GET /api/messages/unread-count
 * Returns total unread message count across all user's conversations
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Authenticate user
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Get user's conversation participations with last read times
    const { data: participations, error: participationError } = await supabase
      .from('conversation_participants')
      .select('conversation_id, last_read_at')
      .eq('user_id', user.id)

    if (participationError) {
      console.error('Error fetching participations:', participationError)
      return NextResponse.json(
        { error: 'Failed to get conversations' },
        { status: 500 }
      )
    }

    if (!participations || participations.length === 0) {
      return NextResponse.json({
        unreadCount: 0,
        timestamp: new Date().toISOString()
      })
    }

    // Build parameters for RPC function
    const conversationIds = participations.map(p => p.conversation_id)
    const lastReadAts: Record<string, string> = {}
    participations.forEach(p => {
      if (p.last_read_at) {
        lastReadAts[p.conversation_id] = p.last_read_at
      }
    })

    // Call optimized RPC function
    const { data: unreadCounts, error: rpcError } = await supabase
      .rpc('get_unread_message_counts', {
        p_conversation_ids: conversationIds,
        p_user_id: user.id,
        p_last_read_ats: lastReadAts
      })

    if (rpcError) {
      console.error('Error getting unread counts:', rpcError)
      return NextResponse.json(
        { error: 'Failed to get unread counts' },
        { status: 500 }
      )
    }

    // Sum all unread counts
    const totalUnread = unreadCounts?.reduce(
      (sum: number, item: any) => sum + (item.unread_count || 0),
      0
    ) || 0

    return NextResponse.json({
      unreadCount: totalUnread,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('Unread count endpoint error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
