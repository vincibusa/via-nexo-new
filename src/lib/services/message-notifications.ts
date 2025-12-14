import { getServiceClient } from '@/lib/supabase/connection-pool'
import { sendPushNotification } from '@/lib/services/push-notifications'
import { createNotification } from '@/lib/services/notifications'

export interface NewMessagePayload {
  message_id: string
  conversation_id: string
  sender_id: string
  content: string
  message_type: string
  created_at: string
}

/**
 * Handle new message - send push notifications to participants
 * This is called when a new message is inserted in the messages table
 */
export async function handleNewMessage(payload: NewMessagePayload) {
  const supabase = getServiceClient()

  try {
    // Get conversation participants (excluding sender)
    const { data: participations, error: participationsError } = await supabase
      .from('conversation_participants')
      .select(`
        user_id,
        profiles!conversation_participants_user_id_fkey (
          id,
          display_name,
          push_tokens
        )
      `)
      .eq('conversation_id', payload.conversation_id)
      .neq('user_id', payload.sender_id)

    if (participationsError) {
      console.error('[Message Notifications] Error fetching participants:', participationsError)
      return
    }

    if (!participations || participations.length === 0) {
      console.log('[Message Notifications] No participants found for conversation:', payload.conversation_id)
      return
    }

    // Get sender info for notification
    const { data: sender, error: senderError } = await supabase
      .from('profiles')
      .select('id, display_name')
      .eq('id', payload.sender_id)
      .single()

    if (senderError) {
      console.error('[Message Notifications] Error fetching sender:', senderError)
      return
    }

    const senderName = sender?.display_name || 'Someone'

    // Send push notification to each participant
    for (const participation of participations) {
      const profile = participation.profiles as any

      if (!profile) {
        console.warn('[Message Notifications] No profile found for user:', participation.user_id)
        continue
      }

      const pushTokens = profile.push_tokens || []

      // Create notification content
      const title = senderName
      const body = payload.message_type === 'text'
        ? payload.content.substring(0, 100)
        : `Sent a ${payload.message_type}`

      // Create in-app notification record
      try {
        await createNotification({
          user_id: participation.user_id,
          actor_id: payload.sender_id,
          type: 'message',
          entity_type: 'conversation',
          entity_id: payload.conversation_id,
          content: `${senderName}: ${body}`,
          metadata: {
            message_id: payload.message_id,
            message_type: payload.message_type,
            conversation_id: payload.conversation_id
          }
        })
      } catch (error) {
        console.error('[Message Notifications] Error creating in-app notification:', error)
      }

      // Send push notifications to each token
      if (pushTokens.length > 0) {
        for (const tokenData of pushTokens) {
          try {
            await sendPushNotification({
              to: tokenData.token || tokenData,
              title,
              body,
              data: {
                type: 'message',
                conversationId: payload.conversation_id,
                messageId: payload.message_id,
                senderId: payload.sender_id
              },
              sound: 'default',
              badge: 1
            })
          } catch (error) {
            console.error('[Message Notifications] Error sending push notification:', error)
          }
        }
      }
    }

    console.log(`[Message Notifications] Sent notifications for message ${payload.message_id}`)
  } catch (error) {
    console.error('[Message Notifications] Unexpected error handling new message:', error)
  }
}
