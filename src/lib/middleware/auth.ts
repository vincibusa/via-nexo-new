/**
 * Middleware di autenticazione e autorizzazione
 * SICUREZZA: Centralizzato verifiche di ruolo per route protette
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export type AllowedRole = 'user' | 'manager' | 'admin'

export interface AuthContext {
  userId: string
  email: string
  role: AllowedRole
  displayName?: string
  avatarUrl?: string
}

/**
 * Middleware per verificare autenticazione e ruolo
 */
export async function checkAuth(request: NextRequest): Promise<{ user?: AuthContext; error?: string }> {
  try {
    // Verificare se l'utente è autenticato via header Authorization
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return { error: 'Missing authorization token' }
    }

    const supabase = await createClient()

    // Verify token
    const { data: userData, error: userError } = await supabase.auth.getUser(token)

    if (userError || !userData.user) {
      return { error: 'Invalid or expired token' }
    }

    // Fetch user profile with role
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, display_name, avatar_url')
      .eq('id', userData.user.id)
      .single()

    if (profileError || !profile) {
      return { error: 'User profile not found' }
    }

    return {
      user: {
        userId: userData.user.id,
        email: userData.user.email || '',
        role: profile.role as AllowedRole,
        displayName: profile.display_name,
        avatarUrl: profile.avatar_url,
      },
    }
  } catch (error) {
    return { error: 'Authentication check failed' }
  }
}

/**
 * Middleware wrapper per verificare autorizzazione basata sul ruolo
 */
export async function requireRole(
  request: NextRequest,
  allowedRoles: AllowedRole[]
): Promise<{ authorized: boolean; user?: AuthContext; error?: string }> {
  const authResult = await checkAuth(request)

  if (authResult.error) {
    return {
      authorized: false,
      error: authResult.error,
    }
  }

  const user = authResult.user!

  if (!allowedRoles.includes(user.role)) {
    return {
      authorized: false,
      error: `Access denied. Required role: ${allowedRoles.join(' or ')}`,
    }
  }

  return {
    authorized: true,
    user,
  }
}

/**
 * Crea risposta di errore di autorizzazione
 */
export function createAuthErrorResponse(error: string, statusCode: number = 401): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: statusCode === 403 ? 'FORBIDDEN' : 'UNAUTHORIZED',
        message: error,
      },
    },
    { status: statusCode }
  )
}

/**
 * Wrapper per API route che richiede autenticazione e ruolo specifico
 */
export function withRoleProtection(
  handler: (request: NextRequest, user: AuthContext) => Promise<NextResponse>,
  allowedRoles: AllowedRole[]
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const authResult = await requireRole(request, allowedRoles)

    if (!authResult.authorized) {
      const statusCode = authResult.error?.includes('denied') ? 403 : 401
      return createAuthErrorResponse(authResult.error || 'Unauthorized', statusCode)
    }

    try {
      return await handler(request, authResult.user!)
    } catch (error) {
      console.error('Route handler error:', error)
      return NextResponse.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred',
          },
        },
        { status: 500 }
      )
    }
  }
}
