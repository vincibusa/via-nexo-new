import { SupabaseClient } from '@supabase/supabase-js'

interface EventNotificationPayload {
  eventId: string
  eventTitle: string
  placeId: string
  placeName?: string
  startDatetime: string
  latitude?: number
  longitude?: number
}

/**
 * Send push notifications to users near a newly published event
 * Uses PostGIS to find users within radius of the event venue
 */
export async function notifyUsersAboutNewEvent(
  supabase: SupabaseClient,
  eventPayload: EventNotificationPayload,
  radiusKm: number = 20 // Default 20km radius
): Promise<{ sent: number; failed: number; error?: string }> {
  try {
    const { eventId, eventTitle, placeId, placeName, startDatetime, latitude, longitude } = eventPayload

    console.log(`[Event Notifications] Processing notifications for event "${eventTitle}" (${eventId})`)

    // If we don't have coordinates, fetch them from the place
    let eventLat = latitude
    let eventLon = longitude

    if (!eventLat || !eventLon) {
      const { data: place, error: placeError } = await supabase
        .from('places')
        .select('latitude, longitude, name')
        .eq('id', placeId)
        .single()

      if (placeError || !place) {
        console.error('[Event Notifications] Failed to fetch place coordinates:', placeError)
        return { sent: 0, failed: 0, error: 'Failed to fetch place coordinates' }
      }

      eventLat = place.latitude
      eventLon = place.longitude
    }

    // Get users with push tokens enabled within radius
    // Use RPC function to bypass RLS and get users efficiently
    const { data: eligibleUsers, error: usersError } = await supabase
      .rpc('get_users_for_event_notification', {
        event_lat: eventLat,
        event_lon: eventLon,
        radius_km: radiusKm
      })

    if (usersError) {
      console.error('[Event Notifications] Error fetching eligible users:', usersError)
      // Fallback: get all users with push enabled (no location filtering)
      const { data: allUsers } = await supabase
        .rpc('get_profiles_with_push_tokens')
      
      if (!allUsers || allUsers.length === 0) {
        console.log('[Event Notifications] No users with push tokens found')
        return { sent: 0, failed: 0 }
      }

      // Use all users as fallback
      return await sendNotificationsToUsers(allUsers, eventTitle, placeName || '', eventId, startDatetime)
    }

    if (!eligibleUsers || eligibleUsers.length === 0) {
      console.log('[Event Notifications] No eligible users found within radius')
      return { sent: 0, failed: 0 }
    }

    console.log(`[Event Notifications] Found ${eligibleUsers.length} eligible users within ${radiusKm}km`)

    return await sendNotificationsToUsers(eligibleUsers, eventTitle, placeName || '', eventId, startDatetime)
  } catch (error) {
    console.error('[Event Notifications] Unexpected error:', error)
    return { 
      sent: 0, 
      failed: 0, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
}

/**
 * Send notifications to a list of users
 */
async function sendNotificationsToUsers(
  users: any[],
  eventTitle: string,
  placeName: string,
  eventId: string,
  startDatetime: string
): Promise<{ sent: number; failed: number }> {
  // Collect all push tokens
  const allPushTokens: string[] = []
  
  users.forEach((user: any) => {
    if (user.push_tokens && Array.isArray(user.push_tokens)) {
      user.push_tokens.forEach((tokenObj: any) => {
        if (tokenObj.token) {
          allPushTokens.push(tokenObj.token)
        }
      })
    }
  })

  if (allPushTokens.length === 0) {
    console.log('[Event Notifications] No valid push tokens found')
    return { sent: 0, failed: 0 }
  }

  // Format event date for notification
  const eventDate = new Date(startDatetime)
  const dateStr = eventDate.toLocaleDateString('it-IT', {
    day: 'numeric',
    month: 'short',
  })

  // Prepare notification messages
  const notificationBody = placeName 
    ? `${dateStr} • ${placeName}`
    : `${dateStr}`

  const messages = allPushTokens.map(token => ({
    to: token,
    sound: 'default',
    title: `🎉 ${eventTitle}`,
    body: notificationBody,
    data: {
      type: 'new_event',
      entity_id: eventId,
      entity_type: 'event',
      deep_link: `/event/${eventId}`,
    },
  }))

  try {
    // Send via Expo Push Notification service
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    })

    const result = await response.json()

    if (result.data) {
      const errors = result.data.filter((item: any) => item.status === 'error')
      const successes = result.data.filter((item: any) => item.status === 'ok')

      console.log('[Event Notifications] Push notification results:', {
        total_tokens: allPushTokens.length,
        successful: successes.length,
        failed: errors.length,
      })

      if (errors.length > 0) {
        console.warn('[Event Notifications] Some notifications failed:', 
          errors.slice(0, 3).map((e: any) => e.message)
        )
      }

      return {
        sent: successes.length,
        failed: errors.length,
      }
    } else {
      console.error('[Event Notifications] Unexpected Expo response:', result)
      return { sent: 0, failed: allPushTokens.length }
    }
  } catch (error) {
    console.error('[Event Notifications] Error sending push notifications:', error)
    return { sent: 0, failed: allPushTokens.length }
  }
}

/**
 * Send reminder notifications for favorite events starting soon
 * This should be called by a cron job or scheduled task
 */
export async function sendFavoriteEventReminders(
  supabase: SupabaseClient,
  hoursBeforeEvent: number = 2
): Promise<{ sent: number; failed: number }> {
  try {
    const now = new Date()
    const targetTime = new Date(now.getTime() + hoursBeforeEvent * 60 * 60 * 1000)
    const windowStart = new Date(targetTime.getTime() - 15 * 60 * 1000) // 15 min before
    const windowEnd = new Date(targetTime.getTime() + 15 * 60 * 1000) // 15 min after

    // Get favorite events starting in the target window
    const { data: upcomingFavorites, error } = await supabase
      .from('favorites')
      .select(`
        user_id,
        events!inner (
          id,
          title,
          start_datetime,
          places!inner (
            name
          )
        )
      `)
      .eq('entity_type', 'event')
      .gte('events.start_datetime', windowStart.toISOString())
      .lte('events.start_datetime', windowEnd.toISOString())

    if (error || !upcomingFavorites || upcomingFavorites.length === 0) {
      console.log('[Favorite Reminders] No upcoming favorite events found')
      return { sent: 0, failed: 0 }
    }

    console.log(`[Favorite Reminders] Found ${upcomingFavorites.length} favorite events to notify`)

    let totalSent = 0
    let totalFailed = 0

    // Send notifications for each favorite event
    for (const favorite of upcomingFavorites) {
      const event = (favorite as any).events
      const placeName = event.places?.name || ''

      // Get user's push tokens
      const { data: profile } = await supabase
        .from('profiles')
        .select('push_tokens')
        .eq('id', (favorite as any).user_id)
        .single()

      if (!profile || !profile.push_tokens || profile.push_tokens.length === 0) {
        continue
      }

      const result = await sendNotificationsToUsers(
        [profile],
        event.title,
        placeName,
        event.id,
        event.start_datetime
      )

      totalSent += result.sent
      totalFailed += result.failed
    }

    return { sent: totalSent, failed: totalFailed }
  } catch (error) {
    console.error('[Favorite Reminders] Error:', error)
    return { sent: 0, failed: 0 }
  }
}

