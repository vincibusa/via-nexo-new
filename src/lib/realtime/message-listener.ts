import { createClient } from '@supabase/supabase-js'
import { handleNewMessage, NewMessagePayload } from '@/lib/services/message-notifications'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

/**
 * Initialize Supabase Realtime listener for new messages
 * This subscribes to INSERT events on the messages table
 * and triggers push notifications to conversation participants
 */
export function initializeMessageListener() {
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[Realtime] Missing Supabase environment variables')
    return null
  }

  // Create client with service role key for realtime
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    },
    realtime: {
      params: {
        eventsPerSecond: 10
      }
    }
  })

  console.log('[Realtime] Initializing message listener...')

  try {
    // Subscribe to messages table INSERT events
    const channel = supabase
      .channel('db-messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages'
        },
        async (payload) => {
          try {
            console.log('[Realtime] New message detected:', payload.new.id)

            // Extract message data
            const newMessage = payload.new as any
            const messagePayload: NewMessagePayload = {
              message_id: newMessage.id,
              conversation_id: newMessage.conversation_id,
              sender_id: newMessage.sender_id,
              content: newMessage.content,
              message_type: newMessage.message_type,
              created_at: newMessage.created_at
            }

            // Handle the new message (send push notifications)
            await handleNewMessage(messagePayload)
          } catch (error) {
            console.error('[Realtime] Error processing new message:', error)
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Realtime] Successfully subscribed to messages table')
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[Realtime] Channel error')
        } else if (status === 'TIMED_OUT') {
          console.error('[Realtime] Subscription timed out')
        }
        console.log('[Realtime] Subscription status:', status)
      })

    // Handle subscription errors
    channel.on('system', {}, (payload) => {
      console.log('[Realtime] System event:', payload)
    })

    return channel
  } catch (error) {
    console.error('[Realtime] Error initializing message listener:', error)
    return null
  }
}

/**
 * Gracefully shutdown the listener
 */
export function shutdownMessageListener(channel: any) {
  if (channel) {
    channel.unsubscribe()
    console.log('[Realtime] Message listener shut down')
  }
}
