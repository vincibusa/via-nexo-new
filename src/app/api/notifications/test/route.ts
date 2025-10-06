import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

// Test notification schema (simplified, no auth required)
const testNotificationSchema = z.object({
  title: z.string().min(1).max(100).default('Test Notification'),
  body: z.string().min(1).max(255).default('This is a test notification from Nexo!'),
  data: z.object({
    type: z.enum(['new_event', 'favorite_event_reminder', 'manager_approved']).optional(),
    entity_id: z.string().uuid().optional(),
    entity_type: z.enum(['place', 'event']).optional(),
    deep_link: z.string().optional(),
  }).optional().default({}),
})

/**
 * POST /api/notifications/test
 * Send test push notification (development only)
 */
export async function POST(request: NextRequest) {
  // Only allow in development
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json(
      { error: 'Test endpoint only available in development' },
      { status: 403 }
    )
  }

  try {
    // Use regular client but we'll use a different approach
    const supabase = await createClient()

    // Parse and validate request body
    const rawBody = await request.text()
    console.log('Raw request body:', rawBody)
    
    const body = JSON.parse(rawBody)
    const { title, body: message, data } = testNotificationSchema.parse(body)

    console.log('Test notification request:', { title, body: message, data })

    // Get all users with push tokens using a custom function that bypasses RLS
    const { data: profilesWithTokens, error: queryError } = await supabase
      .rpc('get_profiles_with_push_tokens')

    console.log('Query result:', { profilesWithTokens, queryError })

    // Debug: get all profiles to see what's in the database
    const { data: allProfiles } = await supabase
      .rpc('get_profiles_with_push_tokens')
    
    console.log('All profiles sample:', allProfiles)

    if (queryError) {
      console.error('Database query error:', queryError)
      return NextResponse.json(
        { error: 'Database query failed', details: queryError },
        { status: 500 }
      )
    }

    if (!profilesWithTokens || profilesWithTokens.length === 0) {
      return NextResponse.json(
        { 
          error: 'No users with push tokens found',
          suggestion: 'Make sure the mobile app is running and has registered push tokens'
        },
        { status: 400 }
      )
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

    console.log(`Sending test notification to ${allPushTokens.length} devices`)

    // Send notifications via Expo Push Notifications
    const messages = allPushTokens.map(token => ({
      to: token,
      sound: 'default',
      title,
      body: message,
      data: data || {},
    }))

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

      console.log('Test notification result:', {
        total_devices: allPushTokens.length,
        successful: successes.length,
        failed: errors.length,
        errors: errors.map((e: any) => ({ 
          token: e.to?.substring(0, 20) + '...', 
          message: e.message 
        }))
      })

      return NextResponse.json({
        message: `Test notification sent to ${successes.length} devices`,
        details: {
          total_targets: profilesWithTokens.length,
          total_devices: allPushTokens.length,
          successful: successes.length,
          failed: errors.length,
          user_ids: profilesWithTokens.map(p => p.id),
        },
        result: result.data
      })
    } else {
      console.error('Unexpected response from Expo:', result)
      return NextResponse.json(
        { error: 'Failed to send test notifications', details: result },
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

    console.error('Error in POST /api/notifications/test:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}