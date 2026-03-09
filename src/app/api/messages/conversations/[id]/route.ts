import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/messages/conversations/[id] - Get single conversation (for detail page)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { id: conversationId } = await params

  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: participation, error: partError } = await supabase
      .from('conversation_participants')
      .select(`
        conversation_id,
        last_read_at,
        last_read_message_id,
        is_muted,
        conversations (
          id,
          type,
          title,
          is_group,
          created_at,
          updated_at,
          last_message_at
        )
      `)
      .eq('conversation_id', conversationId)
      .eq('user_id', user.id)
      .single()

    if (partError || !participation) {
      return Response.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const conversation = Array.isArray(participation.conversations)
      ? participation.conversations[0]
      : participation.conversations

    if (!conversation) {
      return Response.json({ error: 'Conversation not found' }, { status: 404 })
    }

    // Other participant(s) - for direct chat we need the other user's profile
    const { data: otherParticipants } = await supabase
      .from('conversation_participants')
      .select(`
        user_id,
        profiles!conversation_participants_user_id_fkey (
          id,
          email,
          display_name,
          avatar_url
        )
      `)
      .eq('conversation_id', conversationId)
      .neq('user_id', user.id)

    const resolveAvatarUrl = (avatarUrl: string | null | undefined): string | null => {
      if (!avatarUrl) return null
      if (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://')) return avatarUrl
      const { data } = supabase.storage.from('avatars').getPublicUrl(avatarUrl)
      return data.publicUrl
    }

    const otherParticipant = otherParticipants?.[0]
    const profile = otherParticipant?.profiles
      ? (Array.isArray(otherParticipant.profiles) ? otherParticipant.profiles[0] : otherParticipant.profiles)
      : null

    const other_user = profile
      ? {
          id: profile.id,
          email: profile.email,
          displayName: profile.display_name,
          avatarUrl: resolveAvatarUrl(profile.avatar_url) ?? undefined,
        }
      : null

    return Response.json({
      conversation: {
        id: conversation.id,
        type: conversation.type || 'direct',
        title: conversation.title || null,
        is_group: conversation.is_group || false,
        created_at: conversation.created_at,
        updated_at: conversation.updated_at,
        last_message_at: conversation.last_message_at,
        other_user,
        unread_count: 0,
        is_muted: participation.is_muted,
      },
    })
  } catch (error) {
    console.error('Error in GET /api/messages/conversations/[id]:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
