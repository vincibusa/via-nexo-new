import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { runRAGPipeline, SuggestionContext } from '@/lib/ai/rag-pipeline'
import { logSuggestion } from '@/lib/ai/suggestion-logging'
import { createClient } from '@/lib/supabase/server'
import { handleCorsPreflight, withCors } from '@/lib/cors'
import { checkRateLimit, createRateLimitResponse, getRateLimitHeaders } from '@/lib/rate-limit'

// Input validation schema
const suggestionRequestSchema = z.object({
  companionship: z
    .enum(['alone', 'partner', 'friends', 'family'])
    .optional(),
  mood: z
    .enum(['relaxed', 'energetic', 'romantic', 'adventurous'])
    .optional(),
  budget: z.enum(['€', '€€', '€€€', '€€€€']).optional(),
  time: z.enum(['morning', 'afternoon', 'evening', 'night']).optional(),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  }),
  radius_km: z.number().min(0.5).max(50).optional().default(5),
  preferences: z.array(z.string()).optional(),
  datetime: z.string().datetime().optional(),
})

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

  // SICUREZZA: Rate limiting per AI suggestions
  const rateLimitResult = checkRateLimit(request, '/api/suggest')
  if (!rateLimitResult.allowed) {
    return createRateLimitResponse('/api/suggest', rateLimitResult.error!, rateLimitResult.resetTime)
  }

  try {
    // Parse and validate input
    const body = await request.json()
    const validatedInput = suggestionRequestSchema.parse(body)

    // Get user if authenticated (optional)
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // Build context
    const context: SuggestionContext = {
      ...validatedInput,
    }

    // Run RAG pipeline
    const result = await runRAGPipeline(context)

    // Log suggestion (non-blocking)
    const logId = await logSuggestion(
      context,
      result,
      [], // queryEmbedding will be added in next iteration
      {
        candidatesCount: result.searchMetadata.totalCandidates,
        topKIds: [],
        rerankedIds: [],
        userId: user?.id,
        appVersion: request.headers.get('x-app-version') || undefined,
        locale: request.headers.get('accept-language') || undefined,
      }
    )

    // Return result with log ID e rate limit headers
    const successHeaders = getRateLimitHeaders('/api/suggest', rateLimitResult.remainingAttempts, rateLimitResult.resetTime)
    
    return withCors(
      request,
      NextResponse.json({
        ...result,
        logId,
      }, { headers: successHeaders })
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return withCors(
        request,
        NextResponse.json(
          {
            error: 'Invalid input',
            details: error.issues,
          },
          { status: 400 }
        )
      )
    }

    console.error('Error in suggest API:', error)
    return withCors(
      request,
      NextResponse.json(
        {
          error: error instanceof Error ? error.message : 'Internal server error',
        },
        { status: 500 }
      )
    )
  }
}
