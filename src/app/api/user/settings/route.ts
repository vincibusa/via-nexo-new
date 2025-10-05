import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

// Settings schema
const settingsSchema = z.object({
  push_token: z.string().optional().nullable(),
  push_enabled: z.boolean().optional(),
  language: z.enum(['it', 'en']).optional(),
  default_radius_km: z.number().min(0.5).max(50).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
})

/**
 * GET /api/user/settings
 * Get user settings from profiles.metadata
 */
export async function GET(request: NextRequest) {
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

    // Get profile with metadata
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('metadata')
      .eq('id', user.id)
      .single()

    if (profileError) {
      console.error('Error fetching profile:', profileError)
      return NextResponse.json(
        { error: 'Failed to fetch settings' },
        { status: 500 }
      )
    }

    // Extract settings from metadata (with defaults)
    const metadata = (profile?.metadata as any) || {}
    const settings = {
      push_token: metadata.push_token || null,
      push_enabled: metadata.push_enabled ?? true,
      language: metadata.language || 'it',
      default_radius_km: metadata.default_radius_km || 5,
      theme: metadata.theme || 'system',
    }

    return NextResponse.json({ settings })
  } catch (error) {
    console.error('Error in GET /api/user/settings:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/user/settings
 * Update user settings in profiles.metadata
 */
export async function PATCH(request: NextRequest) {
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
    const validatedSettings = settingsSchema.parse(body)

    // Get current metadata
    const { data: profile, error: fetchError } = await supabase
      .from('profiles')
      .select('metadata')
      .eq('id', user.id)
      .single()

    if (fetchError) {
      console.error('Error fetching profile:', fetchError)
      return NextResponse.json(
        { error: 'Failed to fetch profile' },
        { status: 500 }
      )
    }

    // Merge new settings with existing metadata
    const currentMetadata = (profile?.metadata as any) || {}
    const updatedMetadata = {
      ...currentMetadata,
      ...validatedSettings,
      updated_at: new Date().toISOString(),
    }

    // Update profile metadata
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ metadata: updatedMetadata })
      .eq('id', user.id)

    if (updateError) {
      console.error('Error updating settings:', updateError)
      return NextResponse.json(
        { error: 'Failed to update settings' },
        { status: 500 }
      )
    }

    // Return updated settings
    const settings = {
      push_token: updatedMetadata.push_token || null,
      push_enabled: updatedMetadata.push_enabled ?? true,
      language: updatedMetadata.language || 'it',
      default_radius_km: updatedMetadata.default_radius_km || 5,
      theme: updatedMetadata.theme || 'system',
    }

    return NextResponse.json({
      settings,
      message: 'Settings updated successfully',
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

    console.error('Error in PATCH /api/user/settings:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
