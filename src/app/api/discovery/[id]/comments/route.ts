import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const createCommentSchema = z.object({
  content: z.string().min(1).max(500),
})

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    // Check authentication to get current user for is_liked
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    // Fetch comments with user profiles
    let commentsQuery = supabase
      .from('discovery_comments')
      .select(
        `
        id,
        content,
        likes_count,
        created_at,
        updated_at,
        user:profiles!discovery_comments_user_id_fkey (
          id,
          display_name,
          email,
          avatar_url,
          is_verified
        )
      `,
        { count: 'exact' }
      )
      .eq('discovery_id', id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    const { data: comments, error, count } = await commentsQuery

    if (error) {
      console.error('Error fetching comments:', error)
      return NextResponse.json(
        { error: 'Failed to fetch comments' },
        { status: 500 }
      )
    }

    // Get current user's likes for these comments if authenticated
    const commentsWithLikes = await Promise.all(
      (comments || []).map(async (comment) => {
        let is_liked = false
        if (user?.id) {
          const { data: like } = await supabase
            .from('discovery_comment_likes')
            .select('id')
            .eq('comment_id', comment.id)
            .eq('user_id', user.id)
            .maybeSingle()

          is_liked = !!like
        }

        const userProfile = Array.isArray(comment.user) 
          ? comment.user[0] 
          : comment.user;

        return {
          ...comment,
          is_liked,
          user: userProfile
            ? {
                id: userProfile.id,
                username: userProfile.display_name || userProfile.email?.split('@')[0] || 'Anonymous',
                avatar_url: userProfile.avatar_url || null,
                is_verified: userProfile.is_verified || false,
              }
            : null,
        }
      })
    )

    return NextResponse.json({
      comments: commentsWithLikes,
      total: count || 0,
      limit,
      offset,
    })
  } catch (error) {
    console.error('Error in GET /api/discovery/[id]/comments:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

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

    // Verify discovery item exists
    const { data: discoveryItem, error: discoveryError } = await supabase
      .from('discovery')
      .select('id')
      .eq('id', id)
      .single()

    if (discoveryError || !discoveryItem) {
      return NextResponse.json(
        { error: 'Discovery item not found' },
        { status: 404 }
      )
    }

    // Parse and validate request body
    const body = await request.json()
    const validatedInput = createCommentSchema.parse(body)

    // Create comment
    const { data: comment, error: insertError } = await supabase
      .from('discovery_comments')
      .insert({
        discovery_id: id,
        user_id: user.id,
        content: validatedInput.content,
      })
      .select(
        `
        id,
        content,
        likes_count,
        created_at,
        updated_at,
        user:profiles!discovery_comments_user_id_fkey (
          id,
          display_name,
          email,
          avatar_url,
          is_verified
        )
      `
      )
      .single()

    if (insertError) {
      console.error('Error creating comment:', insertError)
      return NextResponse.json(
        { error: 'Failed to create comment' },
        { status: 500 }
      )
    }

    // Format response
    const userProfile = Array.isArray(comment.user) 
      ? comment.user[0] 
      : comment.user;

    const formattedComment = {
      ...comment,
      is_liked: false,
      user: userProfile
        ? {
            id: userProfile.id,
            username: userProfile.display_name || userProfile.email?.split('@')[0] || 'Anonymous',
            avatar_url: userProfile.avatar_url || null,
            is_verified: userProfile.is_verified || false,
          }
        : null,
    }

    return NextResponse.json({ comment: formattedComment }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.issues },
        { status: 400 }
      )
    }
    console.error('Error in POST /api/discovery/[id]/comments:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

