/**
 * Notifications Service
 * FASE 3A: Sistema Follow/Unfollow Notifications
 */

import { getServiceClient, getBatchClient } from '@/lib/supabase/connection-pool'
import { sendPushNotification as sendExpoPush } from './push-notifications'

export interface NotificationData {
  user_id: string
  actor_id?: string
  type: NotificationType
  entity_type?: string
  entity_id?: string
  content?: string
  metadata?: Record<string, unknown>
}

export type NotificationType = 
  | 'new_follower'
  | 'post_like'
  | 'post_comment'
  | 'comment_like'
  | 'mention'
  | 'message'
  | 'event_reminder'
  | 'friend_going_to_event'
  | 'community_invite'
  | 'story_view'
  | 'story_created'
  | 'new_story'
  | 'story_engagement'
  | 'daily_digest'

/**
 * Crea una notifica nel database
 * Uses service role client to bypass RLS
 */
export async function createNotification(data: NotificationData): Promise<string> {
  try {
    const supabase = getServiceClient()

    const { data: notification, error } = await supabase
      .from('notifications')
      .insert({
        user_id: data.user_id,
        actor_id: data.actor_id,
        type: data.type,
        entity_type: data.entity_type,
        entity_id: data.entity_id,
        content: data.content,
        metadata: data.metadata || {}
      })
      .select('id')
      .single()

    if (error) {
      console.error('[Notifications] Failed to create notification:', error)
      throw new Error(`Failed to create notification: ${error.message}`)
    }

    console.log(`[Notifications] Created ${data.type} notification for user ${data.user_id}`)

    // Trigger push notification async
    triggerPushNotification(data).catch(err =>
      console.warn('[Notifications] Failed to trigger push notification:', err)
    )

    return notification.id
  } catch (error) {
    console.error('[Notifications] Error creating notification:', error)
    throw error
  }
}

/**
 * Trigger push notification (Expo, FCM, etc.)
 * Uses service role client for system operations
 */
async function triggerPushNotification(data: NotificationData): Promise<void> {
  try {
    // Get user's push tokens
    const supabase = getServiceClient()
    const { data: profile } = await supabase
      .from('profiles')
      .select('push_tokens')
      .eq('id', data.user_id)
      .single()

    if (!profile?.push_tokens || profile.push_tokens.length === 0) {
      console.log(`[Notifications] No push tokens for user ${data.user_id}`)
      return
    }

    // Get actor profile for notification title
    let actorName = 'Qualcuno'
    if (data.actor_id) {
      const { data: actorProfile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', data.actor_id)
        .single()

      if (actorProfile?.display_name) {
        actorName = actorProfile.display_name
      }
    }

    // Build notification content based on type
    const { title, body } = getNotificationContent(data.type, actorName, data.metadata)

    // Send push notification to each device token
    const pushPromises = profile.push_tokens.map(async (tokenData: { token?: string; platform?: string }) => {
      if (!tokenData?.token) return

      try {
        await sendExpoPush({
          to: tokenData.token,
          title,
          body,
          data: {
            notificationId: data.entity_id,
            type: data.type,
            actorId: data.actor_id,
            entityType: data.entity_type,
            entityId: data.entity_id,
            metadata: data.metadata
          },
          sound: 'default',
          badge: 1
        })
      } catch (error) {
        console.warn(`[Notifications] Failed to send push to token ${tokenData.token}:`, error)
      }
    })

    await Promise.allSettled(pushPromises)
    console.log(`[Notifications] Sent push notifications to ${profile.push_tokens.length} devices for user ${data.user_id}`)
  } catch (error) {
    console.error('[Notifications] Error triggering push notification:', error)
  }
}

/**
 * Genera titolo e corpo della notifica in base al tipo
 */
function getNotificationContent(
  type: NotificationType,
  actorName: string,
  metadata?: Record<string, unknown>
): { title: string; body: string } {
  switch (type) {
    case 'new_follower':
      return {
        title: 'Nuovo follower',
        body: `${actorName} ti ha iniziato a seguire`
      }
    
    case 'post_like':
      return {
        title: 'Nuovo like',
        body: `${actorName} ha messo like al tuo post`
      }
    
    case 'post_comment':
      return {
        title: 'Nuovo commento',
        body: `${actorName} ha commentato il tuo post`
      }
    
    case 'message':
      return {
        title: 'Nuovo messaggio',
        body: `${actorName}: ${metadata?.messagePreview || 'Ti ha inviato un messaggio'}`
      }
    
    case 'event_reminder':
      return {
        title: 'Promemoria evento',
        body: `L'evento "${metadata?.eventTitle || ''}" inizia tra 1 ora`
      }
    
    case 'friend_going_to_event':
      return {
        title: 'Amico all\'evento',
        body: `${actorName} parteciperà a "${metadata?.eventTitle || ''}"`
      }
    
    case 'story_view':
      return {
        title: 'Nuova visualizzazione',
        body: `${actorName} ha visto la tua story`
      }
    
    default:
      return {
        title: 'Nuova notifica',
        body: 'Hai una nuova notifica'
      }
  }
}

/**
 * Segna notifica come letta
 */
export async function markNotificationAsRead(notificationId: string): Promise<void> {
  try {
    const supabase = await getBatchClient()
    
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId)

    if (error) {
      console.error('[Notifications] Failed to mark notification as read:', error)
      throw new Error(`Failed to mark notification as read: ${error.message}`)
    }

    console.log(`[Notifications] Marked notification ${notificationId} as read`)
  } catch (error) {
    console.error('[Notifications] Error marking notification as read:', error)
    throw error
  }
}

/**
 * Segna tutte le notifiche come lette per un utente
 */
export async function markAllNotificationsAsRead(userId: string): Promise<void> {
  try {
    const supabase = await getBatchClient()
    
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false)

    if (error) {
      console.error('[Notifications] Failed to mark all notifications as read:', error)
      throw new Error(`Failed to mark all notifications as read: ${error.message}`)
    }

    console.log(`[Notifications] Marked all notifications as read for user ${userId}`)
  } catch (error) {
    console.error('[Notifications] Error marking all notifications as read:', error)
    throw error
  }
}

/**
 * Elimina notifica
 */
export async function deleteNotification(notificationId: string): Promise<void> {
  try {
    const supabase = await getBatchClient()
    
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', notificationId)

    if (error) {
      console.error('[Notifications] Failed to delete notification:', error)
      throw new Error(`Failed to delete notification: ${error.message}`)
    }

    console.log(`[Notifications] Deleted notification ${notificationId}`)
  } catch (error) {
    console.error('[Notifications] Error deleting notification:', error)
    throw error
  }
}

/**
 * Ottieni notifiche per un utente (paginato)
 */
export async function getUserNotifications(
  userId: string,
  options: {
    limit?: number
    offset?: number
    unreadOnly?: boolean
    types?: NotificationType[]
  } = {}
): Promise<{
  notifications: unknown[]
  total: number
  unreadCount: number
}> {
  try {
    const { limit = 20, offset = 0, unreadOnly = false, types } = options
    
    const supabase = await getBatchClient()
    
    // Query base
    let query = supabase
      .from('notifications')
      .select(`
        *,
        actor:profiles!actor_id(
          id,
          display_name,
          avatar_url,
          is_verified
        )
      `, { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    // Filtri
    if (unreadOnly) {
      query = query.eq('is_read', false)
    }
    
    if (types && types.length > 0) {
      query = query.in('type', types)
    }

    // Paginazione
    const { data: notifications, error, count } = await query
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('[Notifications] Failed to fetch notifications:', error)
      throw new Error(`Failed to fetch notifications: ${error.message}`)
    }

    // Conta notifiche non lette
    const { count: unreadCount } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false)

    return {
      notifications: notifications || [],
      total: count || 0,
      unreadCount: unreadCount || 0
    }
  } catch (error) {
    console.error('[Notifications] Error fetching notifications:', error)
    throw error
  }
}

/**
 * Registra token push per un utente
 */
export async function registerPushToken(
  userId: string,
  token: string,
  platform: 'ios' | 'android'
): Promise<void> {
  try {
    const supabase = await getBatchClient()
    
    // Get current push tokens
    const { data: profile } = await supabase
      .from('profiles')
      .select('push_tokens')
      .eq('id', userId)
      .single()

    const currentTokens = profile?.push_tokens || []
    
    // Check if token already exists
    const existingToken = currentTokens.find((t: { token?: string }) => t.token === token)
    if (existingToken) {
      console.log(`[Notifications] Push token already registered for user ${userId}`)
      return
    }

    // Add new token
    const newToken = {
      token,
      platform,
      created_at: new Date().toISOString()
    }

    const { error } = await supabase
      .from('profiles')
      .update({ 
        push_tokens: [...currentTokens, newToken]
      })
      .eq('id', userId)

    if (error) {
      console.error('[Notifications] Failed to register push token:', error)
      throw new Error(`Failed to register push token: ${error.message}`)
    }

    console.log(`[Notifications] Registered push token for user ${userId} (${platform})`)
  } catch (error) {
    console.error('[Notifications] Error registering push token:', error)
    throw error
  }
}

/**
 * Rimuovi token push per un utente
 */
export async function unregisterPushToken(userId: string, token: string): Promise<void> {
  try {
    const supabase = await getBatchClient()
    
    // Get current push tokens
    const { data: profile } = await supabase
      .from('profiles')
      .select('push_tokens')
      .eq('id', userId)
      .single()

    const currentTokens = profile?.push_tokens || []
    
    // Filter out the token
    const updatedTokens = currentTokens.filter((t: { token?: string }) => t.token !== token)

    const { error } = await supabase
      .from('profiles')
      .update({ push_tokens: updatedTokens })
      .eq('id', userId)

    if (error) {
      console.error('[Notifications] Failed to unregister push token:', error)
      throw new Error(`Failed to unregister push token: ${error.message}`)
    }

    console.log(`[Notifications] Unregistered push token for user ${userId}`)
  } catch (error) {
    console.error('[Notifications] Error unregistering push token:', error)
    throw error
  }
}