import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { withSecureErrorHandling, ErrorContext, createSecureError } from '@/lib/error-handler'
import { withCors } from '@/lib/cors'
import { checkRateLimit, createRateLimitResponse, getRateLimitHeaders } from '@/lib/rate-limit'

async function handleSignup(request: NextRequest, context: ErrorContext): Promise<NextResponse> {
  // SICUREZZA: Rate limiting per prevenire brute force su signup
  const rateLimitResult = checkRateLimit(request, '/api/auth/signup')
  if (!rateLimitResult.allowed) {
    return createRateLimitResponse('/api/auth/signup', rateLimitResult.error!, rateLimitResult.resetTime)
  }

  const { email, password, displayName, gender, date_of_birth } = await request.json()

  // Validation
  if (!email || !password) {
    const secureError = createSecureError('AUTH_MISSING_FIELDS')
    return withCors(
      request,
      NextResponse.json(
        { error: { code: secureError.code, message: secureError.message } },
        { status: secureError.statusCode }
      )
    )
  }

  if (password.length < 8) {
    const secureError = createSecureError('VALIDATION_ERROR', 'Password must be at least 8 characters')
    return withCors(
      request,
      NextResponse.json(
        { error: { code: secureError.code, message: secureError.message } },
        { status: secureError.statusCode }
      )
    )
  }

  // Validate gender if provided
  if (gender !== undefined && gender !== null && gender !== '') {
    if (gender !== 'Maschio' && gender !== 'Femmina') {
      const secureError = createSecureError('VALIDATION_ERROR', 'Gender must be Maschio or Femmina')
      return withCors(
        request,
        NextResponse.json(
          { error: { code: secureError.code, message: secureError.message } },
          { status: secureError.statusCode }
        )
      )
    }
  }

  // Validate and calculate age from date_of_birth
  let age: number | undefined;
  if (date_of_birth) {
    const birthDate = new Date(date_of_birth);
    const today = new Date();

    if (isNaN(birthDate.getTime())) {
      const secureError = createSecureError('VALIDATION_ERROR', 'Invalid date of birth')
      return withCors(
        request,
        NextResponse.json(
          { error: { code: secureError.code, message: secureError.message } },
          { status: secureError.statusCode }
        )
      )
    }

    // Calculate age
    age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }

    // Validate minimum age (18 years)
    if (age < 18) {
      const secureError = createSecureError('VALIDATION_ERROR', 'You must be at least 18 years old')
      return withCors(
        request,
        NextResponse.json(
          { error: { code: secureError.code, message: secureError.message } },
          { status: secureError.statusCode }
        )
      )
    }
  }

  const supabase = await createClient()

  // Sign up user with metadata (trigger will create profile automatically)
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName || email.split('@')[0],
        gender: gender || null,
        age: age || null,
        onboarding_completed: false,
      },
    },
  })

  if (authError) {
    const secureError = createSecureError('AUTH_INVALID_CREDENTIALS', authError.message)
    return withCors(
      request,
      NextResponse.json(
        { error: { code: secureError.code, message: secureError.message } },
        { status: secureError.statusCode }
      )
    )
  }

  if (!authData.user) {
    const secureError = createSecureError('INTERNAL_ERROR', 'Failed to create user')
    return withCors(
      request,
      NextResponse.json(
        { error: { code: secureError.code, message: secureError.message } },
        { status: secureError.statusCode }
      )
    )
  }

  // Profile is automatically created by database trigger
  const successHeaders = getRateLimitHeaders('/api/auth/signup', rateLimitResult.remainingAttempts, rateLimitResult.resetTime)

  return withCors(
    request,
    NextResponse.json({
      user: {
        id: authData.user.id,
        email: authData.user.email,
        role: 'user', // Default role set by trigger
      },
      message: 'Signup successful. Please check your email for verification.',
    }, { headers: successHeaders })
  )
}

export const POST = withSecureErrorHandling(handleSignup, '/api/auth/signup')
