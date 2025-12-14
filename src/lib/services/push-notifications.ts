/**
 * Push Notifications Service
 * Sends push notifications via Expo Push Notifications API
 */

export interface PushNotificationPayload {
  to: string // Expo push token
  title: string
  body: string
  data?: Record<string, any>
  sound?: 'default' | 'silent'
  badge?: number
  ttl?: number
}

const EXPO_PUSH_API = 'https://exp.host/--/api/v2/push/send'

/**
 * Send a push notification via Expo Push Service
 */
export async function sendPushNotification(payload: PushNotificationPayload): Promise<void> {
  try {
    const response = await fetch(EXPO_PUSH_API, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: payload.to,
        title: payload.title,
        body: payload.body,
        data: payload.data || {},
        sound: payload.sound || 'default',
        badge: payload.badge || 0,
        ttl: payload.ttl || 3600 // 1 hour default
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(`Push notification failed: ${JSON.stringify(error)}`)
    }

    const result = await response.json()

    // Log result for monitoring
    console.log('[Push Notifications] Sent successfully:', {
      token: payload.to.substring(0, 20) + '...',
      title: payload.title,
      id: result.id
    })
  } catch (error) {
    console.error('[Push Notifications] Error sending notification:', error)
    // Don't rethrow - handle gracefully
  }
}

/**
 * Send multiple push notifications
 */
export async function sendBatchPushNotifications(
  messages: PushNotificationPayload[]
): Promise<void> {
  try {
    const response = await fetch(EXPO_PUSH_API, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        messages.map(msg => ({
          to: msg.to,
          title: msg.title,
          body: msg.body,
          data: msg.data || {},
          sound: msg.sound || 'default',
          badge: msg.badge || 0,
          ttl: msg.ttl || 3600
        }))
      ),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(`Batch push notifications failed: ${JSON.stringify(error)}`)
    }

    console.log('[Push Notifications] Batch sent successfully:', messages.length, 'notifications')
  } catch (error) {
    console.error('[Push Notifications] Error sending batch notifications:', error)
  }
}
