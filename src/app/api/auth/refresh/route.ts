import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { handleCorsPreflight, withCors } from '@/lib/cors'
import { checkRateLimit, createRateLimitResponse, getRateLimitHeaders } from '@/lib/rate-limit'
import { createSecureErrorResponse, createSecureError, recordErrorStat } from '@/lib/error-handler'

export async function OPTIONS(request: NextRequest) {
  const preflightResponse = handleCorsPreflight(request)
  if (preflightResponse) {
    return preflightResponse
  }
  return new Response(null, { status: 204 })
}

export async function POST(request: NextRequest) {
  // Handle CORS preflight
  const preflightResponse = handleCorsPreflight(request)
  if (preflightResponse) {
    return preflightResponse
  }

  // Rate limiting per prevenire abusi
  const rateLimitResult = checkRateLimit(request, '/api/auth/refresh')
  if (!rateLimitResult.allowed) {
    return createRateLimitResponse('/api/auth/refresh', rateLimitResult.error!, rateLimitResult.resetTime)
  }

  try {
    const { refreshToken } = await request.json()

    // Validation
    if (!refreshToken) {
      recordErrorStat('AUTH_MISSING_REFRESH_TOKEN')
      const secureError = createSecureError('AUTH_MISSING_FIELDS', 'Refresh token is required')
      return withCors(
        request,
        NextResponse.json(
          { error: { code: secureError.code, message: secureError.message } },
          { status: secureError.statusCode }
        )
      )
    }

    const supabase = await createClient()

    // Use the refresh token to get a new session
    const { data: authData, error: authError } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    })

    if (authError) {
      recordErrorStat('AUTH_REFRESH_FAILED')
      return withCors(
        request,
        NextResponse.json(
          { error: { code: 'AUTH_REFRESH_FAILED', message: 'Session refresh failed. Please login again.' } },
          { status: 401 }
        )
      )
    }

    if (!authData.session || !authData.user) {
      recordErrorStat('AUTH_REFRESH_FAILED')
      return withCors(
        request,
        NextResponse.json(
          { error: { code: 'AUTH_REFRESH_FAILED', message: 'Invalid refresh token. Please login again.' } },
          { status: 401 }
        )
      )
    }

    // Fetch user profile with role
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, display_name, avatar_url, metadata')
      .eq('id', authData.user.id)
      .single()

    if (profileError) {
      recordErrorStat('AUTH_PROFILE_NOT_FOUND')
      const secureError = createSecureError('AUTH_PROFILE_NOT_FOUND')
      return withCors(
        request,
        NextResponse.json(
          { error: { code: secureError.code, message: secureError.message } },
          { status: secureError.statusCode }
        )
      )
    }

    const successHeaders = getRateLimitHeaders('/api/auth/refresh', rateLimitResult.remainingAttempts, rateLimitResult.resetTime)

    return withCors(
      request,
      NextResponse.json({
        user: {
          id: authData.user.id,
          email: authData.user.email,
          role: profile.role,
          displayName: profile.display_name,
          avatarUrl: profile.avatar_url,
          gender: profile.metadata?.gender || null,
          age: profile.metadata?.age || null,
          onboardingCompleted: profile.metadata?.onboarding_completed ?? null,
          initialPreferences: profile.metadata?.initial_preferences ?? null,
        },
        session: {
          accessToken: authData.session.access_token,
          refreshToken: authData.session.refresh_token,
          expiresAt: authData.session.expires_at,
        },
        message: 'Session refreshed successfully',
      }, { headers: successHeaders })
    )
  } catch (error) {
    recordErrorStat('INTERNAL_ERROR')
    return createSecureErrorResponse(request, error, {
      endpoint: '/api/auth/refresh',
      method: request.method,
      timestamp: new Date(),
      userAgent: request.headers.get('user-agent') || undefined,
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    })
  }
}
