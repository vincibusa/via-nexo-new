import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

// Validation schemas
const sendMessageSchema = z.object({
  content: z.string().optional(),
  message_type: z.enum(['text', 'image', 'voice']).default('text'),
  media_url: z.string().url().optional(),
  media_thumbnail_url: z.string().url().optional(),
  media_size: z.number().optional(),
  media_duration: z.number().optional(),
  reply_to_message_id: z.string().uuid().optional(),
})

// GET /api/messages/conversations/[id]/messages - Get messages in a conversation
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { id: conversationId } = await params

  try {
    // Get current user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify user is participant in this conversation
    const { data: participant, error: participantError } = await supabase
      .from('conversation_participants')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('user_id', user.id)
      .single()

    if (participantError || !participant) {
      return Response.json({ error: 'Not authorized to view this conversation' }, { status: 403 })
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '50')
    const before = searchParams.get('before') // message ID for pagination
    const after = searchParams.get('after')   // message ID for pagination

    // Build query
    let query = supabase
      .from('messages')
      .select(`
        id,
        conversation_id,
        sender_id,
        content,
        message_type,
        media_url,
        media_thumbnail_url,
        media_duration,
        created_at,
        is_deleted,
        reply_to_message_id,
        profiles!sender_id (
          id,
          display_name,
          avatar_url
        )
      `)
      .eq('conversation_id', conversationId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(limit)

    // Add pagination filters
    if (before) {
      const { data: beforeMsg } = await supabase
        .from('messages')
        .select('created_at')
        .eq('id', before)
        .single()

      if (beforeMsg) {
        query = query.lt('created_at', beforeMsg.created_at)
      }
    }

    if (after) {
      const { data: afterMsg } = await supabase
        .from('messages')
        .select('created_at')
        .eq('id', after)
        .single()

      if (afterMsg) {
        query = query.gt('created_at', afterMsg.created_at)
      }
    }

    const { data: messages, error: messagesError } = await query

    if (messagesError) {
      console.error('Error fetching messages:', messagesError)
      return Response.json({ error: 'Failed to fetch messages' }, { status: 500 })
    }

    if (!messages || messages.length === 0) {
      return Response.json({
        messages: [],
        pagination: {
          has_more: false,
          oldest_message_id: null,
          newest_message_id: null,
        },
      })
    }

    // Get read receipts for these messages
    const messageIds = messages.map(m => m.id)
    const { data: readReceipts } = await supabase
      .from('message_read_receipts')
      .select('message_id, user_id, read_at')
      .in('message_id', messageIds)

    // Map read receipts to messages
    const messagesWithReceipts = messages.map(msg => {
      // Handle profiles as array (Supabase returns arrays for relations)
      const profile = Array.isArray(msg.profiles) ? msg.profiles[0] : msg.profiles;
      
      return {
        id: msg.id,
        conversation_id: msg.conversation_id,
        sender_id: msg.sender_id,
        content: msg.content,
        message_type: msg.message_type,
        media_url: msg.media_url,
        media_thumbnail_url: msg.media_thumbnail_url,
        media_duration: msg.media_duration,
        created_at: msg.created_at,
        is_deleted: msg.is_deleted,
        reply_to_message_id: msg.reply_to_message_id,
        sender: {
          id: profile?.id,
          displayName: profile?.display_name,
          avatarUrl: profile?.avatar_url,
        },
        read_by: readReceipts
          ?.filter(r => r.message_id === msg.id)
          .map(r => ({
            user_id: r.user_id,
            read_at: r.read_at,
          })) || [],
      };
    })

    // Reverse to get chronological order (oldest first)
    const chronologicalMessages = messagesWithReceipts.reverse()

    return Response.json({
      messages: chronologicalMessages,
      pagination: {
        has_more: messages.length === limit,
        oldest_message_id: chronologicalMessages[0]?.id,
        newest_message_id: chronologicalMessages[chronologicalMessages.length - 1]?.id,
      },
    })
  } catch (error) {
    console.error('Error in GET /api/messages/conversations/[id]/messages:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/messages/conversations/[id]/messages - Send a message
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { id: conversationId } = await params

  try {
    // Get current user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify user is participant in this conversation
    const { data: participant, error: participantError } = await supabase
      .from('conversation_participants')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('user_id', user.id)
      .single()

    if (participantError || !participant) {
      return Response.json({ error: 'Not authorized to message in this conversation' }, { status: 403 })
    }

    // Parse and validate request body
    const body = await request.json()
    const validatedInput = sendMessageSchema.parse(body)

    // Validate content based on message type
    if (validatedInput.message_type === 'text' && !validatedInput.content) {
      return Response.json({ error: 'Content required for text messages' }, { status: 400 })
    }

    if ((validatedInput.message_type === 'image' || validatedInput.message_type === 'voice') && !validatedInput.media_url) {
      return Response.json({ error: 'Media URL required for image/voice messages' }, { status: 400 })
    }

    // Insert message
    const { data: message, error: messageError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: user.id,
        content: validatedInput.content,
        message_type: validatedInput.message_type,
        media_url: validatedInput.media_url,
        media_thumbnail_url: validatedInput.media_thumbnail_url,
        media_size: validatedInput.media_size,
        media_duration: validatedInput.media_duration,
        reply_to_message_id: validatedInput.reply_to_message_id,
      })
      .select()
      .single()

    if (messageError) {
      console.error('Error creating message:', messageError)
      return Response.json({ error: 'Failed to send message' }, { status: 500 })
    }

    // Mark as read for sender
    await supabase
      .from('message_read_receipts')
      .insert({
        message_id: message.id,
        user_id: user.id,
      })

    return Response.json({
      message: {
        id: message.id,
        conversation_id: message.conversation_id,
        sender_id: message.sender_id,
        content: message.content,
        message_type: message.message_type,
        media_url: message.media_url,
        created_at: message.created_at,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: 'Invalid input', details: error.issues }, { status: 400 })
    }
    console.error('Error in POST /api/messages/conversations/[id]/messages:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
