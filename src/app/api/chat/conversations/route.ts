import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

// Validation schemas
const createConversationSchema = z.object({
  title: z.string().max(255).optional(),
  initial_message: z.string().min(1).max(1000),
})

const updateConversationSchema = z.object({
  title: z.string().max(255).optional(),
})

// GET /api/chat/conversations - List user conversations
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
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = parseInt(searchParams.get('offset') || '0')

    // Fetch conversations with pagination
    const { data: conversations, error, count } = await supabase
      .from('chat_conversations')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('Error fetching conversations:', error)
      return Response.json({ error: 'Failed to fetch conversations' }, { status: 500 })
    }

    return Response.json({
      conversations: conversations || [],
      total: count || 0,
      hasMore: (count || 0) > offset + limit,
    })
  } catch (error) {
    console.error('Error in GET /api/chat/conversations:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/chat/conversations - Create new conversation
export async function POST(request: NextRequest) {
  const supabase = await createClient()

  try {
    // Get current user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse and validate request body
    const body = await request.json()
    const validatedInput = createConversationSchema.parse(body)

    // Generate title from initial message if not provided
    const title = validatedInput.title || 
      (validatedInput.initial_message.length > 50 
        ? validatedInput.initial_message.substring(0, 47) + '...'
        : validatedInput.initial_message
      )

    // Create conversation
    const { data: conversation, error: conversationError } = await supabase
      .from('chat_conversations')
      .insert({
        user_id: user.id,
        title,
        last_message_preview: validatedInput.initial_message,
      })
      .select()
      .single()

    if (conversationError) {
      console.error('Error creating conversation:', conversationError)
      return Response.json({ error: 'Failed to create conversation' }, { status: 500 })
    }

    // Add initial message with message_order = 1
    const { data: message, error: messageError } = await supabase
      .from('chat_messages')
      .insert({
        conversation_id: conversation.id,
        content: validatedInput.initial_message,
        is_user: true,
        message_order: 1,
      })
      .select()
      .single()

    if (messageError) {
      console.error('Error adding initial message:', messageError)
      // Rollback conversation creation
      await supabase.from('chat_conversations').delete().eq('id', conversation.id)
      return Response.json({ error: 'Failed to add initial message' }, { status: 500 })
    }

    return Response.json({
      conversation: {
        ...conversation,
        messages: [message]
      },
      message: 'Conversation created successfully'
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: 'Invalid input', details: error.issues }, { status: 400 })
    }
    console.error('Error in POST /api/chat/conversations:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}