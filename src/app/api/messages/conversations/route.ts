import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

// Validation schemas
const createConversationSchema = z.object({
  other_user_id: z.string().uuid(),
})

// GET /api/messages/conversations - List user conversations
export async function GET(request: NextRequest) {
  const supabase = await createClient()

  try {
    // Get current user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    // Fetch conversations where user is a participant
    const { data: participations, error: participationError } = await supabase
      .from('conversation_participants')
      .select(`
        conversation_id,
        last_read_at,
        last_read_message_id,
        is_muted,
        conversations (
          id,
          created_at,
          updated_at,
          last_message_at
        )
      `)
      .eq('user_id', user.id)
      .order('joined_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (participationError) {
      console.error('Error fetching participations:', participationError)
      return Response.json({ error: 'Failed to fetch conversations' }, { status: 500 })
    }

    if (!participations || participations.length === 0) {
      return Response.json({
        conversations: [],
        pagination: { total: 0, limit, offset }
      })
    }

    // Get other participants for each conversation
    const conversationIds = participations.map(p => p.conversation_id)

    const { data: otherParticipants, error: otherParticipantsError } = await supabase
      .from('conversation_participants')
      .select(`
        conversation_id,
        user_id,
        profiles!conversation_participants_user_id_fkey (
          id,
          email,
          display_name,
          avatar_url
        )
      `)
      .in('conversation_id', conversationIds)
      .neq('user_id', user.id)

    if (otherParticipantsError) {
      console.error('Error fetching other participants:', otherParticipantsError)
    }

    console.log('[GET /api/messages/conversations] Other participants:', JSON.stringify(otherParticipants, null, 2))

    // Get last message for each conversation
    const { data: lastMessages, error: lastMessagesError } = await supabase
      .from('messages')
      .select('id, conversation_id, content, message_type, created_at, sender_id')
      .in('conversation_id', conversationIds)
      .order('created_at', { ascending: false })

    if (lastMessagesError) {
      console.error('Error fetching last messages:', lastMessagesError)
    }

    // OPTIMIZED: Get unread counts in a single RPC call instead of N+1 queries
    const lastReadAts: Record<string, string> = {}
    participations.forEach(p => {
      if (p.last_read_at) {
        lastReadAts[p.conversation_id] = p.last_read_at
      }
    })

    const { data: unreadCounts, error: unreadError } = await supabase
      .rpc('get_unread_message_counts', {
        p_conversation_ids: conversationIds,
        p_user_id: user.id,
        p_last_read_ats: lastReadAts
      })

    if (unreadError) {
      console.error('Error fetching unread counts:', unreadError)
    }

    // Build response
    const conversations = participations.map(p => {
      const conversation = Array.isArray(p.conversations) ? p.conversations[0] : p.conversations
      const otherParticipant = otherParticipants?.find(op => op.conversation_id === p.conversation_id)
      const lastMessage = lastMessages?.find(m => m.conversation_id === p.conversation_id)
      const unreadData = unreadCounts.find(uc => uc.conversation_id === p.conversation_id)

      // Handle profiles as array (Supabase returns arrays for relations)
      const profile = otherParticipant?.profiles 
        ? (Array.isArray(otherParticipant.profiles) ? otherParticipant.profiles[0] : otherParticipant.profiles)
        : null;

      return {
        id: conversation?.id,
        created_at: conversation?.created_at,
        updated_at: conversation?.updated_at,
        last_message_at: conversation?.last_message_at,
        other_user: profile ? {
          id: profile.id,
          email: profile.email,
          displayName: profile.display_name,
          avatarUrl: profile.avatar_url,
        } : null,
        last_message: lastMessage ? {
          id: lastMessage.id,
          content: lastMessage.content,
          message_type: lastMessage.message_type,
          created_at: lastMessage.created_at,
          sender_id: lastMessage.sender_id,
        } : null,
        unread_count: unreadData?.unread_count || 0,
        is_muted: p.is_muted,
      }
    })

    return Response.json({
      conversations,
      pagination: {
        total: participations.length,
        limit,
        offset,
      },
    })
  } catch (error) {
    console.error('Error in GET /api/messages/conversations:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/messages/conversations - Create new conversation
export async function POST(request: NextRequest) {
  const supabase = await createClient()

  try {
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    console.log('[POST /api/messages/conversations] Auth check:', {
      hasUser: !!user,
      userId: user?.id,
      authError: authError?.message
    })

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse and validate request body
    const body = await request.json()
    const validatedInput = createConversationSchema.parse(body)

    console.log('[POST /api/messages/conversations] Creating conversation:', {
      currentUserId: user.id,
      otherUserId: validatedInput.other_user_id
    })

    // Use the security definer function to create/get conversation
    const { data: conversationId, error: functionError } = await supabase
      .rpc('create_conversation_with_participants', {
        p_user_id: user.id,
        p_other_user_id: validatedInput.other_user_id
      })

    if (functionError) {
      console.error('[POST /api/messages/conversations] Error in create_conversation_with_participants:', functionError)
      return Response.json({ error: 'Failed to create conversation' }, { status: 500 })
    }

    if (!conversationId) {
      console.error('[POST /api/messages/conversations] No conversation ID returned from function')
      return Response.json({ error: 'Failed to create conversation' }, { status: 500 })
    }

    console.log('[POST /api/messages/conversations] Conversation created/retrieved:', conversationId)

    return Response.json({
      conversation_id: conversationId,
      created: true,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: 'Invalid input', details: error.issues }, { status: 400 })
    }
    console.error('Error in POST /api/messages/conversations:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
