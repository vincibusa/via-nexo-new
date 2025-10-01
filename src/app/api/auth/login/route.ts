import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json()

    // Validation
    if (!email || !password) {
      return NextResponse.json(
        { error: { code: 'MISSING_FIELDS', message: 'Email and password are required' } },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Sign in user
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (authError) {
      return NextResponse.json(
        { error: { code: authError.code || 'AUTH_ERROR', message: authError.message } },
        { status: 401 }
      )
    }

    if (!authData.user) {
      return NextResponse.json(
        { error: { code: 'LOGIN_FAILED', message: 'Invalid credentials' } },
        { status: 401 }
      )
    }

    // Fetch user profile with role
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, display_name, avatar_url')
      .eq('id', authData.user.id)
      .single()

    if (profileError) {
      console.error('Profile fetch error:', profileError)
      // Logout user if profile not found
      await supabase.auth.signOut()
      return NextResponse.json(
        { error: { code: 'PROFILE_NOT_FOUND', message: 'User profile not found' } },
        { status: 404 }
      )
    }

    // Check if user has admin or manager role
    if (profile.role !== 'admin' && profile.role !== 'manager') {
      // Logout the user
      await supabase.auth.signOut()
      return NextResponse.json(
        {
          error: {
            code: 'ACCESS_DENIED',
            message: 'Only admins and managers can access this panel'
          }
        },
        { status: 403 }
      )
    }

    return NextResponse.json({
      user: {
        id: authData.user.id,
        email: authData.user.email,
        role: profile.role,
        displayName: profile.display_name,
        avatarUrl: profile.avatar_url,
      },
      session: {
        accessToken: authData.session?.access_token,
        refreshToken: authData.session?.refresh_token,
        expiresAt: authData.session?.expires_at,
      },
      message: 'Login successful',
    })
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } },
      { status: 500 }
    )
  }
}
