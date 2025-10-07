import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
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
      .select('*')
      .eq('id', conversationId)
      .eq('user_id', user.id)
      .single()

    if (conversationError) {
      if (conversationError.code === 'PGRST116') {
        return Response.json({ error: 'Conversation not found' }, { status: 404 })
      }
      console.error('Error fetching conversation:', conversationError)
      return Response.json({ error: 'Failed to fetch conversation' }, { status: 500 })
    }

    // Fetch all messages for this conversation
    const { data: messages, error: messagesError } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('timestamp', { ascending: true })

    if (messagesError) {
      console.error('Error fetching messages:', messagesError)
      return Response.json({ error: 'Failed to fetch messages' }, { status: 500 })
    }

    return Response.json({
      conversation,
      messages: messages || [],
    })
  } catch (error) {
    console.error('Error in GET /api/chat/conversations/[id]:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/chat/conversations/[id] - Delete conversation
export async function DELETE(
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

    // Delete conversation (cascade will delete messages)
    const { error: deleteError } = await supabase
      .from('chat_conversations')
      .delete()
      .eq('id', conversationId)

    if (deleteError) {
      console.error('Error deleting conversation:', deleteError)
      return Response.json({ error: 'Failed to delete conversation' }, { status: 500 })
    }

    return Response.json({ message: 'Conversation deleted successfully' })
  } catch (error) {
    console.error('Error in DELETE /api/chat/conversations/[id]:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}