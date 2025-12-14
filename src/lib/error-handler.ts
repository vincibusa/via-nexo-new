import { NextRequest, NextResponse } from 'next/server'
import { withCors } from '@/lib/cors'

/**
 * Error Handler Centralizzato
 * SICUREZZA: Gestione sicura degli errori senza esposizione dati sensibili
 */

export interface ErrorContext {
  userId?: string
  endpoint: string
  userAgent?: string
  ip?: string
  method: string
  timestamp: Date
}

export interface SecureError {
  code: string
  message: string
  statusCode: number
  publicMessage: string
  internalDetails?: any
}

/**
 * Codici errore standardizzati
 */
export const ERROR_CODES = {
  // Authentication
  AUTH_INVALID_CREDENTIALS: {
    code: 'AUTH_INVALID_CREDENTIALS',
    message: 'Credenziali non valide',
    statusCode: 401
  },
  AUTH_MISSING_FIELDS: {
    code: 'AUTH_MISSING_FIELDS', 
    message: 'Campi obbligatori mancanti',
    statusCode: 400
  },
  AUTH_ACCESS_DENIED: {
    code: 'AUTH_ACCESS_DENIED',
    message: 'Accesso negato',
    statusCode: 403
  },
  AUTH_PROFILE_NOT_FOUND: {
    code: 'AUTH_PROFILE_NOT_FOUND',
    message: 'Profilo utente non trovato',
    statusCode: 404
  },
  
  // Validation
  VALIDATION_ERROR: {
    code: 'VALIDATION_ERROR',
    message: 'Dati non validi',
    statusCode: 400
  },
  
  // Rate Limiting
  RATE_LIMIT_EXCEEDED: {
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Troppi tentativi. Riprova più tardi',
    statusCode: 429
  },
  
  // CSRF
  CSRF_PROTECTION_ERROR: {
    code: 'CSRF_PROTECTION_ERROR',
    message: 'Errore di sicurezza',
    statusCode: 403
  },
  
  // Database
  DATABASE_ERROR: {
    code: 'DATABASE_ERROR',
    message: 'Errore del database',
    statusCode: 500
  },
  
  // AI Services
  AI_SERVICE_ERROR: {
    code: 'AI_SERVICE_ERROR',
    message: 'Servizio AI temporaneamente non disponibile',
    statusCode: 503
  },
  
  // Generic
  INTERNAL_ERROR: {
    code: 'INTERNAL_ERROR',
    message: 'Errore interno del server',
    statusCode: 500
  },
  
  NOT_FOUND: {
    code: 'NOT_FOUND',
    message: 'Risorsa non trovata',
    statusCode: 404
  }
} as const

/**
 * Sanitizza errori di Supabase per non esporre dettagli interni
 */
function sanitizeSupabaseError(error: any): SecureError {
  if (!error) {
    return ERROR_CODES.INTERNAL_ERROR
  }
  
  // Errori di autenticazione Supabase
  if (error.code === 'invalid_credentials' || error.message?.includes('Invalid login')) {
    return ERROR_CODES.AUTH_INVALID_CREDENTIALS
  }
  
  if (error.code === 'email_not_confirmed' || error.message?.includes('email not confirmed')) {
    return {
      ...ERROR_CODES.AUTH_ACCESS_DENIED,
      message: 'Email non confermata'
    }
  }
  
  // Errori di database
  if (error.code?.startsWith('23') || error.message?.includes('duplicate')) {
    return {
      code: 'DUPLICATE_ERROR',
      message: 'Risorsa già esistente',
      statusCode: 409,
      publicMessage: 'Risorsa già esistente'
    }
  }
  
  // Errori di permessi
  if (error.code === 'insufficient_permissions' || error.message?.includes('permission')) {
    return ERROR_CODES.AUTH_ACCESS_DENIED
  }
  
  // Default: errore generico senza dettagli
  return ERROR_CODES.INTERNAL_ERROR
}

/**
 * Sanitizza errori di validazione Zod
 */
function sanitizeZodError(error: any): SecureError {
  // Non esporre la struttura interna di Zod
  const issueCount = error.issues?.length || 0
  
  return {
    ...ERROR_CODES.VALIDATION_ERROR,
    message: `Errore di validazione (${issueCount} problemi)`,
    internalDetails: process.env.NODE_ENV === 'development' ? error.issues : undefined
  }
}

/**
 * Sanitizza errori API esterni (OpenAI, etc.)
 */
function sanitizeExternalAPIError(error: any): SecureError {
  if (error?.code?.includes('rate_limit')) {
    return ERROR_CODES.RATE_LIMIT_EXCEEDED
  }
  
  if (error?.code?.includes('insufficient_quota') || error?.message?.includes('quota')) {
    return ERROR_CODES.AI_SERVICE_ERROR
  }
  
  // Non esporre mai dettagli di API esterne
  return ERROR_CODES.AI_SERVICE_ERROR
}

/**
 * Logger sicuro per errori
 */
function logError(error: any, context: ErrorContext, sanitizedError: SecureError): void {
  // Log completo solo in sviluppo
  if (process.env.NODE_ENV === 'development') {
    console.error('[Error Handler] Full error:', {
      originalError: error,
      context,
      sanitized: sanitizedError,
      stack: error?.stack
    })
  } else {
    // In produzione, log minimo ma sicuro
    console.error('[Error Handler]', {
      code: sanitizedError.code,
      endpoint: context.endpoint,
      method: context.method,
      userId: context.userId,
      timestamp: context.timestamp.toISOString(),
      // NON loggare mai dati sensibili in produzione
    })
  }
}

/**
 * Sanitizza qualsiasi tipo di errore
 */
export function sanitizeError(error: any, type?: 'supabase' | 'zod' | 'external' | 'unknown'): SecureError {
  // Auto-detect tipo errore se non specificato
  if (!type) {
    if (error?.name === 'ZodError' || error?.issues) {
      type = 'zod'
    } else if (error?.code || error?.message?.includes('supabase')) {
      type = 'supabase'
    } else if (error?.response?.status || error?.code?.includes('api')) {
      type = 'external'
    } else {
      type = 'unknown'
    }
  }
  
  switch (type) {
    case 'supabase':
      return sanitizeSupabaseError(error)
    case 'zod':
      return sanitizeZodError(error)
    case 'external':
      return sanitizeExternalAPIError(error)
    default:
      return ERROR_CODES.INTERNAL_ERROR
  }
}

/**
 * Crea response sicura con errore sanitizzato
 */
export function createSecureErrorResponse(
  request: NextRequest,
  error: any,
  context: ErrorContext,
  additionalHeaders: Record<string, string> = {}
): NextResponse {
  const sanitizedError = sanitizeError(error)
  
  // Log sicuro
  logError(error, context, sanitizedError)
  
  // Response pulita per client
  const responseData = {
    error: {
      code: sanitizedError.code,
      message: sanitizedError.publicMessage || sanitizedError.message
    },
    timestamp: new Date().toISOString(),
    // In development, includi dettagli aggiuntivi
    ...(process.env.NODE_ENV === 'development' && sanitizedError.internalDetails && {
      debug: sanitizedError.internalDetails
    })
  }
  
  return withCors(
    request,
    NextResponse.json(responseData, {
      status: sanitizedError.statusCode,
      headers: additionalHeaders
    })
  )
}

/**
 * Wrapper per API routes con error handling automatico
 */
export function withSecureErrorHandling(
  handler: (request: NextRequest, context: ErrorContext) => Promise<NextResponse>,
  endpoint: string
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const context: ErrorContext = {
      endpoint,
      method: request.method,
      timestamp: new Date(),
      userAgent: request.headers.get('user-agent') || undefined,
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
          request.headers.get('x-real-ip') || 
          'unknown'
    }
    
    try {
      return await handler(request, context)
    } catch (error) {
      return createSecureErrorResponse(request, error, context)
    }
  }
}

/**
 * Utility per creare errori custom sicuri
 */
export function createSecureError(
  code: keyof typeof ERROR_CODES,
  customMessage?: string,
  internalDetails?: any
): SecureError {
  const baseError = ERROR_CODES[code]
  
  return {
    ...baseError,
    ...(customMessage && { message: customMessage, publicMessage: customMessage }),
    ...(internalDetails && process.env.NODE_ENV === 'development' && { internalDetails })
  }
}

/**
 * Statistiche errori per monitoring
 */
const errorStats = new Map<string, number>()

export function recordErrorStat(code: string): void {
  errorStats.set(code, (errorStats.get(code) || 0) + 1)
}

export function getErrorStats(): Record<string, number> {
  return Object.fromEntries(errorStats.entries())
}