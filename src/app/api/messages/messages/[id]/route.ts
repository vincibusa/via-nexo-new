import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// DELETE /api/messages/messages/[id] - Delete a message
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { id: messageId } = await params

  try {
    // Get current user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get the message to verify ownership
    const { data: message, error: fetchError } = await supabase
      .from('messages')
      .select('sender_id')
      .eq('id', messageId)
      .single()

    if (fetchError || !message) {
      return Response.json({ error: 'Message not found' }, { status: 404 })
    }

    // Only allow the sender to delete their own message
    if (message.sender_id !== user.id) {
      return Response.json({ error: 'Not authorized to delete this message' }, { status: 403 })
    }

    // Soft delete: mark as deleted
    const { error: deleteError } = await supabase
      .from('messages')
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
      })
      .eq('id', messageId)

    if (deleteError) {
      console.error('Error deleting message:', deleteError)
      return Response.json({ error: 'Failed to delete message' }, { status: 500 })
    }

    return Response.json({ success: true })
  } catch (error) {
    console.error('Error in DELETE /api/messages/messages/[id]:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
