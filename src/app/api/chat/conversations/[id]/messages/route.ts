import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

// Validation schema for adding messages
const addMessageSchema = z.object({
  content: z.string().min(1).max(5000),
  is_user: z.boolean(),
  suggestions_data: z.any().optional(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()

  try {
    // Get current user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const conversationId = id

    // Verify user owns this conversation
    const { data: conversation, error: conversationError } = await supabase
      .from('chat_conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('user_id', user.id)
      .single()

    if (conversationError) {
      if (conversationError.code === 'PGRST116') {
        return Response.json({ error: 'Conversation not found' }, { status: 404 })
      }
      console.error('Error verifying conversation:', conversationError)
      return Response.json({ error: 'Failed to verify conversation' }, { status: 500 })
    }

    // Parse and validate request body
    const body = await request.json()
    const validatedInput = addMessageSchema.parse(body)

    // Get current message count for this conversation to determine order
    const { count } = await supabase
      .from('chat_messages')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)

    const nextOrder = (count || 0) + 1

    // Add message to conversation with sequential order
    const { data: message, error: messageError } = await supabase
      .from('chat_messages')
      .insert({
        conversation_id: conversationId,
        content: validatedInput.content,
        is_user: validatedInput.is_user,
        suggestions_data: validatedInput.suggestions_data,
        message_order: nextOrder,
      })
      .select()
      .single()

    if (messageError) {
      console.error('Error adding message:', messageError)
      return Response.json({ error: 'Failed to add message' }, { status: 500 })
    }

    // Fetch updated conversation
    const { data: updatedConversation } = await supabase
      .from('chat_conversations')
      .select('*')
      .eq('id', conversationId)
      .single()

    return Response.json({
      message,
      conversation: updatedConversation,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: 'Invalid input', details: error.issues }, { status: 400 })
    }
    console.error('Error in POST /api/chat/conversations/[id]/messages:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}