import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const markAsReadSchema = z.object({
  message_id: z.string().uuid(),
})

// POST /api/messages/conversations/[id]/read - Mark messages as read
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

    // Parse request body
    const body = await request.json()
    const { message_id } = markAsReadSchema.parse(body)

    // Update last_read_at for this user's participation
    const { error: updateError } = await supabase
      .from('conversation_participants')
      .update({
        last_read_at: new Date().toISOString(),
        last_read_message_id: message_id,
      })
      .eq('conversation_id', conversationId)
      .eq('user_id', user.id)

    if (updateError) {
      console.error('Error updating read status:', updateError)
      return Response.json({ error: 'Failed to update read status' }, { status: 500 })
    }

    return Response.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: 'Invalid input', details: error.issues }, { status: 400 })
    }
    console.error('Error in POST /api/messages/conversations/[id]/read:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
