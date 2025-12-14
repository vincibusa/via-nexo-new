import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { handleCorsPreflight, withCors } from '@/lib/cors'
import { checkRateLimit, createRateLimitResponse, getRateLimitHeaders } from '@/lib/rate-limit'
import { createSecureErrorResponse, createSecureError, sanitizeError, recordErrorStat } from '@/lib/error-handler'

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

  // SICUREZZA: Rate limiting per prevenire brute force
  const rateLimitResult = checkRateLimit(request, '/api/auth/login')
  if (!rateLimitResult.allowed) {
    return createRateLimitResponse('/api/auth/login', rateLimitResult.error!, rateLimitResult.resetTime)
  }

  try {
    const { email, password } = await request.json()

    // Validation
    if (!email || !password) {
      recordErrorStat('AUTH_MISSING_FIELDS')
      const secureError = createSecureError('AUTH_MISSING_FIELDS')
      return withCors(
        request,
        NextResponse.json(
          { error: { code: secureError.code, message: secureError.message } },
          { status: secureError.statusCode }
        )
      )
    }

    const supabase = await createClient()

    // Sign in user
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (authError) {
      recordErrorStat('AUTH_INVALID_CREDENTIALS')
      const sanitizedError = sanitizeError(authError, 'supabase')
      return withCors(
        request,
        NextResponse.json(
          { error: { code: sanitizedError.code, message: sanitizedError.publicMessage || sanitizedError.message } },
          { status: sanitizedError.statusCode }
        )
      )
    }

    if (!authData.user) {
      recordErrorStat('AUTH_INVALID_CREDENTIALS')
      const secureError = createSecureError('AUTH_INVALID_CREDENTIALS')
      return withCors(
        request,
        NextResponse.json(
          { error: { code: secureError.code, message: secureError.message } },
          { status: secureError.statusCode }
        )
      )
    }

    // Fetch user profile with role
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, display_name, avatar_url')
      .eq('id', authData.user.id)
      .single()

    if (profileError) {
      recordErrorStat('AUTH_PROFILE_NOT_FOUND')
      // Logout user if profile not found
      await supabase.auth.signOut()
      const secureError = createSecureError('AUTH_PROFILE_NOT_FOUND')
      return withCors(
        request,
        NextResponse.json(
          { error: { code: secureError.code, message: secureError.message } },
          { status: secureError.statusCode }
        )
      )
    }

    // Check if user has admin or manager role
    if (profile.role !== 'admin' && profile.role !== 'manager') {
      recordErrorStat('AUTH_ACCESS_DENIED')
      // Logout the user
      await supabase.auth.signOut()
      const secureError = createSecureError('AUTH_ACCESS_DENIED', 'Solo admin e manager possono accedere')
      return withCors(
        request,
        NextResponse.json(
          { error: { code: secureError.code, message: secureError.message } },
          { status: secureError.statusCode }
        )
      )
    }

    const successHeaders = getRateLimitHeaders('/api/auth/login', rateLimitResult.remainingAttempts, rateLimitResult.resetTime)
    
    return withCors(
      request,
      NextResponse.json({
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
      }, { headers: successHeaders })
    )
  } catch (error) {
    recordErrorStat('INTERNAL_ERROR')
    return createSecureErrorResponse(request, error, {
      endpoint: '/api/auth/login',
      method: request.method,
      timestamp: new Date(),
      userAgent: request.headers.get('user-agent') || undefined,
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    })
  }
}
