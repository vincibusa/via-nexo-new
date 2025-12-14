import { NextRequest, NextResponse } from 'next/server'

/**
 * Rate Limiting Implementation
 * SICUREZZA: Prevenire brute force e spam
 * Implementazione custom senza dipendenze esterne
 */

interface RateLimitEntry {
  attempts: number
  resetTime: number
  blocked?: boolean
}

// In-memory store per rate limiting (in produzione considera Redis)
const rateLimitStore = new Map<string, RateLimitEntry>()

/**
 * Configurazione rate limits per endpoint
 */
const RATE_LIMITS = {
  '/api/auth/login': {
    maxAttempts: 10,
    windowMs: 5 * 60 * 1000, // 5 minuti
    blockDurationMs: 15 * 60 * 1000, // 15 minuti di block
  },
  '/api/suggest': {
    maxAttempts: 20,
    windowMs: 60 * 1000, // 1 minuto
    blockDurationMs: 2 * 60 * 1000, // 2 minuti di block
  },
  '/api/chat/suggest-stream': {
    maxAttempts: 10,
    windowMs: 60 * 1000, // 1 minuto  
    blockDurationMs: 5 * 60 * 1000, // 5 minuti di block
  },
  '/api/chat/suggest': {
    maxAttempts: 15,
    windowMs: 60 * 1000, // 1 minuto
    blockDurationMs: 3 * 60 * 1000, // 3 minuti di block
  }
} as const

/**
 * Ottiene l'IP del client considerando proxy headers
 */
function getClientIP(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const realIP = request.headers.get('x-real-ip')
  const ip = forwarded?.split(',')[0] || realIP || request.ip || 'unknown'
  return ip.trim()
}

/**
 * Crea chiave unica per il rate limiting
 */
function createRateLimitKey(endpoint: string, identifier: string): string {
  return `rl:${endpoint}:${identifier}`
}

/**
 * Pulisce automaticamente entries scadute
 */
function cleanupExpiredEntries(): void {
  const now = Date.now()
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now && !entry.blocked) {
      rateLimitStore.delete(key)
    }
  }
}

/**
 * Middleware di rate limiting
 */
export function checkRateLimit(
  request: NextRequest,
  endpoint: string
): { 
  allowed: boolean
  remainingAttempts?: number
  resetTime?: number
  error?: string
} {
  const config = RATE_LIMITS[endpoint as keyof typeof RATE_LIMITS]
  if (!config) {
    return { allowed: true } // Nessun limit configurato
  }

  const clientIP = getClientIP(request)
  const key = createRateLimitKey(endpoint, clientIP)
  const now = Date.now()
  
  // Cleanup periodico (ogni 100 richieste circa)
  if (Math.random() < 0.01) {
    cleanupExpiredEntries()
  }

  let entry = rateLimitStore.get(key)

  // Prima richiesta o window scaduta
  if (!entry || entry.resetTime < now) {
    entry = {
      attempts: 1,
      resetTime: now + config.windowMs,
    }
    rateLimitStore.set(key, entry)
    
    return {
      allowed: true,
      remainingAttempts: config.maxAttempts - 1,
      resetTime: entry.resetTime,
    }
  }

  // Check se bloccato
  if (entry.blocked && entry.resetTime > now) {
    return {
      allowed: false,
      error: `Troppi tentativi. Riprova tra ${Math.ceil((entry.resetTime - now) / 1000)} secondi.`,
      resetTime: entry.resetTime,
    }
  }

  // Incrementa tentativi
  entry.attempts++

  // Limite raggiunto - blocca
  if (entry.attempts > config.maxAttempts) {
    entry.blocked = true
    entry.resetTime = now + config.blockDurationMs
    rateLimitStore.set(key, entry)

    return {
      allowed: false,
      error: `Limite raggiunto. Bloccato per ${config.blockDurationMs / 1000 / 60} minuti.`,
      resetTime: entry.resetTime,
    }
  }

  // Aggiorna entry
  rateLimitStore.set(key, entry)

  return {
    allowed: true,
    remainingAttempts: config.maxAttempts - entry.attempts,
    resetTime: entry.resetTime,
  }
}

/**
 * Headers per informare il client sui limits
 */
export function getRateLimitHeaders(
  endpoint: string,
  remainingAttempts?: number,
  resetTime?: number
): Record<string, string> {
  const config = RATE_LIMITS[endpoint as keyof typeof RATE_LIMITS]
  if (!config) return {}

  return {
    'X-RateLimit-Limit': config.maxAttempts.toString(),
    'X-RateLimit-Remaining': (remainingAttempts ?? 0).toString(),
    'X-RateLimit-Reset': resetTime ? Math.ceil(resetTime / 1000).toString() : '0',
  }
}

/**
 * Response per rate limit exceeded
 */
export function createRateLimitResponse(
  endpoint: string,
  error: string,
  resetTime?: number
): NextResponse {
  const config = RATE_LIMITS[endpoint as keyof typeof RATE_LIMITS]
  
  return NextResponse.json(
    {
      error: 'Rate limit exceeded',
      message: error,
      retryAfter: resetTime ? Math.ceil((resetTime - Date.now()) / 1000) : config?.blockDurationMs ? config.blockDurationMs / 1000 : 300,
    },
    {
      status: 429,
      headers: getRateLimitHeaders(endpoint, 0, resetTime),
    }
  )
}

/**
 * Utility per reset manuale (per testing)
 */
export function resetRateLimit(endpoint: string, identifier: string): void {
  const key = createRateLimitKey(endpoint, identifier)
  rateLimitStore.delete(key)
}

/**
 * Statistiche rate limiting (per monitoring)
 */
export function getRateLimitStats(): {
  totalEntries: number
  blockedIPs: number
  topEndpoints: Array<{ endpoint: string; requests: number }>
} {
  const stats = {
    totalEntries: rateLimitStore.size,
    blockedIPs: 0,
    endpointCounts: new Map<string, number>()
  }

  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.blocked) {
      stats.blockedIPs++
    }

    const endpoint = key.split(':')[1]
    stats.endpointCounts.set(endpoint, (stats.endpointCounts.get(endpoint) || 0) + entry.attempts)
  }

  return {
    totalEntries: stats.totalEntries,
    blockedIPs: stats.blockedIPs,
    topEndpoints: Array.from(stats.endpointCounts.entries())
      .map(([endpoint, requests]) => ({ endpoint, requests }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 10)
  }
}