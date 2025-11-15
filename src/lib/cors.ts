import { NextRequest, NextResponse } from 'next/server'

/**
 * CORS configuration
 * Permette tutte le origini per default
 */
export const corsConfig = {
  // Permette tutte le origini (puoi restringere con ALLOWED_ORIGINS se necessario)
  allowedOrigins: process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : ['*'], // Default: tutte le origini
  
  allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'x-app-version',
    'accept-language',
  ],
  exposedHeaders: ['Content-Length', 'Content-Type'],
  maxAge: 86400, // 24 hours
  credentials: true,
}

/**
 * Get allowed origin for the request
 */
function getAllowedOrigin(request: NextRequest): string | null {
  const origin = request.headers.get('origin')
  
  if (!origin) {
    return null
  }

  // Se configurato per permettere tutte le origini
  if (corsConfig.allowedOrigins.includes('*')) {
    return origin
  }

  // Altrimenti controlla se l'origine è nella lista consentita
  if (corsConfig.allowedOrigins.includes(origin)) {
    return origin
  }

  return null
}

/**
 * Create CORS headers for a response
 */
export function getCorsHeaders(request: NextRequest): Record<string, string> {
  const origin = getAllowedOrigin(request)
  
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': corsConfig.allowedMethods.join(', '),
    'Access-Control-Allow-Headers': corsConfig.allowedHeaders.join(', '),
    'Access-Control-Expose-Headers': corsConfig.exposedHeaders.join(', '),
    'Access-Control-Max-Age': corsConfig.maxAge.toString(),
  }

  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin
    if (corsConfig.credentials) {
      headers['Access-Control-Allow-Credentials'] = 'true'
    }
  }

  return headers
}

/**
 * Handle CORS preflight (OPTIONS) request
 */
export function handleCorsPreflight(request: NextRequest): NextResponse | null {
  if (request.method === 'OPTIONS') {
    const headers = getCorsHeaders(request)
    return new NextResponse(null, {
      status: 204,
      headers,
    })
  }
  return null
}

/**
 * Add CORS headers to a response
 */
export function withCors(
  request: NextRequest,
  response: NextResponse
): NextResponse {
  const corsHeaders = getCorsHeaders(request)
  
  // Add CORS headers to response
  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value)
  })

  return response
}

/**
 * Create a CORS-enabled response
 */
export function corsResponse(
  request: NextRequest,
  data: any,
  status: number = 200,
  additionalHeaders: Record<string, string> = {}
): NextResponse {
  const corsHeaders = getCorsHeaders(request)
  const allHeaders = { ...corsHeaders, ...additionalHeaders }

  return NextResponse.json(data, {
    status,
    headers: allHeaders,
  })
}

