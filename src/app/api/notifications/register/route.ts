import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

// Register push token schema
const registerTokenSchema = z.object({
  push_token: z.string(),
  platform: z.enum(['ios', 'android']),
})

/**
 * POST /api/notifications/register
 * Register push token for user
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

    // Parse and validate request body
    const body = await request.json()
    const { push_token, platform } = registerTokenSchema.parse(body)

    // Get current profile and push tokens
    const { data: profile, error: fetchError } = await supabase
      .from('profiles')
      .select('metadata, push_tokens')
      .eq('id', user.id)
      .single()

    if (fetchError) {
      console.error('Error fetching profile:', fetchError)
      return NextResponse.json(
        { error: 'Failed to fetch profile' },
        { status: 500 }
      )
    }

    // Create new push token object
    const newPushToken = {
      token: push_token,
      platform,
      created_at: new Date().toISOString(),
    }

    // Get current push tokens array or initialize empty array
    const currentPushTokens = profile?.push_tokens || []
    
    // Remove existing token for this platform to avoid duplicates
    const filteredTokens = currentPushTokens.filter((token: any) => 
      token.platform !== platform
    )
    
    // Add new token
    const updatedPushTokens = [...filteredTokens, newPushToken]

    // Update profile with push token in dedicated column
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ 
        push_tokens: updatedPushTokens,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id)

    if (updateError) {
      console.error('Error updating push token:', updateError)
      return NextResponse.json(
        { error: 'Failed to register push token' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      message: 'Push token registered successfully',
    })
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

    console.error('Error in POST /api/notifications/register:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}