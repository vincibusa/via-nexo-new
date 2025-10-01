import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const { email, password, displayName } = await request.json()

    // Validation
    if (!email || !password) {
      return NextResponse.json(
        { error: { code: 'MISSING_FIELDS', message: 'Email and password are required' } },
        { status: 400 }
      )
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: { code: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters' } },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Sign up user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    })

    if (authError) {
      return NextResponse.json(
        { error: { code: authError.code || 'AUTH_ERROR', message: authError.message } },
        { status: 400 }
      )
    }

    if (!authData.user) {
      return NextResponse.json(
        { error: { code: 'SIGNUP_FAILED', message: 'Failed to create user' } },
        { status: 500 }
      )
    }

    // Create profile (using service role to bypass RLS)
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: authData.user.id,
        email: authData.user.email!,
        role: 'user',
        display_name: displayName || email.split('@')[0],
      })

    if (profileError) {
      console.error('Profile creation error:', profileError)
      // Don't fail the signup, profile can be created later
    }

    return NextResponse.json({
      user: {
        id: authData.user.id,
        email: authData.user.email,
        role: 'user',
      },
      message: 'Signup successful. Please check your email for verification.',
    })
  } catch (error) {
    console.error('Signup error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } },
      { status: 500 }
    )
  }
}
