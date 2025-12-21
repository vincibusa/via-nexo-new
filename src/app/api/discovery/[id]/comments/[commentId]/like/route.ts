import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  try {
    const { commentId } = await params
    const supabase = await createClient()

    // Check authentication
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify comment exists
    const { data: comment, error: commentError } = await supabase
      .from('discovery_comments')
      .select('id')
      .eq('id', commentId)
      .single()

    if (commentError || !comment) {
      return NextResponse.json(
        { error: 'Comment not found' },
        { status: 404 }
      )
    }

    // Toggle like using RPC
    const { data: isLiked, error: rpcError } = await supabase.rpc(
      'increment_discovery_comment_likes',
      {
        comment_id_param: commentId,
        user_id_param: user.id,
      }
    )

    if (rpcError) {
      console.error('Error toggling comment like:', rpcError)
      throw rpcError
    }

    // Get updated likes count
    const { data: updatedComment } = await supabase
      .from('discovery_comments')
      .select('likes_count')
      .eq('id', commentId)
      .single()

    return NextResponse.json({
      is_liked: isLiked || false,
      likes_count: updatedComment?.likes_count || 0,
    })
  } catch (error) {
    console.error('Error in POST /api/discovery/[id]/comments/[commentId]/like:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

