import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

// Send notification schema
const sendNotificationSchema = z.object({
  title: z.string().min(1).max(100),
  body: z.string().min(1).max(255),
  data: z.object({
    type: z.enum(['new_event', 'favorite_event_reminder', 'manager_approved']),
    entity_id: z.string().uuid().optional(),
    entity_type: z.enum(['place', 'event']).optional(),
    deep_link: z.string().optional(),
  }).optional(),
  target_users: z.array(z.string().uuid()).optional(), // Specific user IDs
  target_radius: z.object({
    lat: z.number(),
    lon: z.number(),
    radius_km: z.number().min(0.5).max(100),
  }).optional(), // Users within radius
})

/**
 * POST /api/notifications/send
 * Send push notifications to users (admin only)
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Parse and validate request body
    const body = await request.json()
    const { title, body: message, data, target_users, target_radius } = sendNotificationSchema.parse(body)

    // Get target users based on criteria
    let targetUserIds: string[] = []

    if (target_users && target_users.length > 0) {
      // Specific users provided
      targetUserIds = target_users
    } else if (target_radius) {
      // Users within radius (requires location data in profiles)
      const { data: usersInRadius } = await supabase
        .from('profiles')
        .select('id')
        .not('metadata->location', 'is', null)
        .eq('metadata->push_enabled', true)
        // Note: This would require a PostGIS function to calculate distance
        // For now, we'll just get all users with push enabled
      
      if (usersInRadius) {
        targetUserIds = usersInRadius.map(u => u.id)
      }
    } else {
      // All users with push enabled
      const { data: allUsers } = await supabase
        .from('profiles')
        .select('id')
        .eq('metadata->push_enabled', true)

      if (allUsers) {
        targetUserIds = allUsers.map(u => u.id)
      }
    }

    if (targetUserIds.length === 0) {
      return NextResponse.json(
        { error: 'No target users found' },
        { status: 400 }
      )
    }

    // Get push tokens for target users (only those with actual tokens, not empty arrays)
    const { data: profilesWithTokens } = await supabase
      .from('profiles')
      .select('id, push_tokens')
      .in('id', targetUserIds)
      .not('push_tokens', 'eq', '{}')
      .not('push_tokens', 'is', null)

    if (!profilesWithTokens || profilesWithTokens.length === 0) {
      return NextResponse.json(
        { error: 'No users with push tokens found' },
        { status: 400 }
      )
    }

    // Prepare notification payload
    const notificationPayload = {
      title,
      body: message,
      data: data || {},
    }

    // Collect all push tokens
    const allPushTokens: string[] = []
    profilesWithTokens.forEach(profile => {
      if (profile.push_tokens && Array.isArray(profile.push_tokens)) {
        profile.push_tokens.forEach((tokenObj: any) => {
          if (tokenObj.token) {
            allPushTokens.push(tokenObj.token)
          }
        })
      }
    })

    if (allPushTokens.length === 0) {
      return NextResponse.json(
        { error: 'No valid push tokens found' },
        { status: 400 }
      )
    }

    // Send notifications via Expo Push Notifications
    const messages = allPushTokens.map(token => ({
      to: token,
      sound: 'default',
      title,
      body: message,
      data: data || {},
    }))

    try {
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
        // Check for errors in the response
        const errors = result.data.filter((item: any) => item.status === 'error')
        const successes = result.data.filter((item: any) => item.status === 'ok')

        console.log('Expo push notification result:', {
          total: result.data.length,
          successful: successes.length,
          failed: errors.length,
          errors: errors.map((e: any) => ({ token: e.to, message: e.message }))
        })

        return NextResponse.json({
          message: `Notifications sent to ${successes.length} devices`,
          sent_count: successes.length,
          failed_count: errors.length,
          total_targets: profilesWithTokens.length,
          user_ids: profilesWithTokens.map(p => p.id),
        })
      } else {
        console.error('Unexpected response from Expo:', result)
        return NextResponse.json(
          { error: 'Failed to send notifications' },
          { status: 500 }
        )
      }
    } catch (error) {
      console.error('Error sending push notifications:', error)
      return NextResponse.json(
        { error: 'Failed to send notifications' },
        { status: 500 }
      )
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Invalid input',
          details: error.issues,
        },
        { status: 400 }
      )
    }

    console.error('Error in POST /api/notifications/send:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}