import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(
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

    // Toggle like using RPC
    const { data: isLiked, error: rpcError } = await supabase.rpc('increment_discovery_likes', {
      discovery_id_param: id,
      user_id_param: user.id,
    })

    if (rpcError) {
      throw rpcError
    }

    // Get updated likes count
    const { data: discoveryItem } = await supabase
      .from('discovery')
      .select('likes_count')
      .eq('id', id)
      .single()

    const likesCount = discoveryItem?.likes_count || 0

    return NextResponse.json({
      is_liked: isLiked || false,
      likes_count: likesCount,
    })
  } catch (error) {
    console.error('Error in discovery like POST:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

