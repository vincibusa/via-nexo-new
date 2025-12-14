import { NextRequest, NextResponse } from 'next/server'

/**
 * CSRF Protection Implementation
 * SICUREZZA: Prevenire Cross-Site Request Forgery attacks
 */

const CSRF_TOKEN_HEADER = 'X-CSRF-Token'
const CSRF_SECRET_HEADER = 'X-Requested-With'
const CSRF_COOKIE_NAME = '__Host-csrf-token'

/**
 * Genera token CSRF sicuro
 */
export function generateCSRFToken(): string {
  // Use Web Crypto API (Edge Runtime compatible)
  const buffer = new Uint8Array(32)
  crypto.getRandomValues(buffer)

  // Convert to hex string
  return Array.from(buffer)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Verifica se la richiesta è considerata "safe" (GET, HEAD, OPTIONS)
 */
function isSafeMethod(method: string): boolean {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
}

/**
 * Verifica se la richiesta proviene dallo stesso origin
 */
function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')
  
  if (!origin && !referer) {
    // Se non abbiamo origin né referer, consideriamo sicura solo per GET
    return isSafeMethod(request.method)
  }
  
  // Estrae l'host dalla URL della richiesta
  const requestHost = request.nextUrl.host
  
  if (origin) {
    try {
      const originHost = new URL(origin).host
      return originHost === requestHost
    } catch {
      return false
    }
  }
  
  if (referer) {
    try {
      const refererHost = new URL(referer).host
      return refererHost === requestHost
    } catch {
      return false
    }
  }
  
  return false
}

/**
 * Verifica header X-Requested-With (protezione base AJAX)
 */
function hasValidXRequestedWith(request: NextRequest): boolean {
  const xRequestedWith = request.headers.get(CSRF_SECRET_HEADER)
  // Accetta XMLHttpRequest (standard) o applicazione specifica
  return xRequestedWith === 'XMLHttpRequest' || xRequestedWith === 'NextApp'
}

/**
 * Middleware di protezione CSRF
 */
export function checkCSRFProtection(request: NextRequest): {
  allowed: boolean
  error?: string
  needsToken?: boolean
} {
  // Metodi safe non richiedono protezione CSRF
  if (isSafeMethod(request.method)) {
    return { allowed: true }
  }

  // Controllo 1: Same Origin Policy
  if (!isSameOrigin(request)) {
    return {
      allowed: false,
      error: 'Cross-origin request blocked'
    }
  }

  // Controllo 2: X-Requested-With header (protezione base)
  if (!hasValidXRequestedWith(request)) {
    return {
      allowed: false,
      error: 'Missing or invalid X-Requested-With header'
    }
  }

  // Per API di autenticazione, richiediamo controlli aggiuntivi
  const isAuthAPI = request.nextUrl.pathname.startsWith('/api/auth/')
  
  if (isAuthAPI) {
    // Controllo 3: CSRF token per API sensitive
    const csrfToken = request.headers.get(CSRF_TOKEN_HEADER)
    const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value
    
    if (!csrfToken || !csrfCookie) {
      return {
        allowed: false,
        error: 'CSRF token required for authentication endpoints',
        needsToken: true
      }
    }
    
    // Verifica che token header e cookie coincidano
    if (csrfToken !== csrfCookie) {
      return {
        allowed: false,
        error: 'Invalid CSRF token'
      }
    }
  }

  return { allowed: true }
}

/**
 * Crea response con errore CSRF
 */
export function createCSRFErrorResponse(
  request: NextRequest,
  error: string,
  needsToken: boolean = false
): NextResponse {
  const response = NextResponse.json(
    {
      error: 'CSRF Protection Error',
      message: error,
      csrfTokenRequired: needsToken,
    },
    { status: 403 }
  )

  // Se serve un token, generalo e impostalo come cookie
  if (needsToken) {
    const token = generateCSRFToken()
    
    response.cookies.set(CSRF_COOKIE_NAME, token, {
      httpOnly: false, // Deve essere accessibile da JavaScript
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24, // 24 ore
    })

    // Aggiungi header per informare il client
    response.headers.set('X-CSRF-Token-Required', 'true')
    response.headers.set('X-CSRF-Token-Name', CSRF_TOKEN_HEADER)
  }

  return response
}

/**
 * Genera e imposta CSRF token per richieste GET
 */
export function setCSRFTokenForSafeRequest(response: NextResponse): NextResponse {
  // Genera sempre un nuovo token per le richieste safe
  const token = generateCSRFToken()
  
  response.cookies.set(CSRF_COOKIE_NAME, token, {
    httpOnly: false, // Accessibile da JavaScript
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 24, // 24 ore
  })

  // Aggiungi header per debug (solo in dev)
  if (process.env.NODE_ENV === 'development') {
    response.headers.set('X-CSRF-Token-Set', token)
  }

  return response
}

/**
 * Utility per ottenere il nome dell'header CSRF (per client)
 */
export function getCSRFHeaderName(): string {
  return CSRF_TOKEN_HEADER
}

/**
 * Utility per ottenere il nome del cookie CSRF (per client)
 */
export function getCSRFCookieName(): string {
  return CSRF_COOKIE_NAME
}

/**
 * Statistiche CSRF (per monitoring)
 */
const csrfStats = {
  blocked: 0,
  sameOriginBlocked: 0,
  missingHeaderBlocked: 0,
  invalidTokenBlocked: 0,
  allowed: 0,
}

export function recordCSRFEvent(event: 'blocked' | 'allowed', reason?: string): void {
  if (event === 'blocked') {
    csrfStats.blocked++
    if (reason?.includes('origin')) csrfStats.sameOriginBlocked++
    if (reason?.includes('header')) csrfStats.missingHeaderBlocked++
    if (reason?.includes('token')) csrfStats.invalidTokenBlocked++
  } else {
    csrfStats.allowed++
  }
}

export function getCSRFStats(): typeof csrfStats {
  return { ...csrfStats }
}