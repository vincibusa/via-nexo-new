import { NextRequest } from 'next/server'
import { z } from 'zod'
import { streamObject } from 'ai'
import {
  geoFilterPlaces,
  buildSemanticQuery,
  vectorSearch,
  reRank,
  SuggestionContext,
} from '@/lib/ai/rag-pipeline'
import { generateEmbedding } from '@/lib/ai/embedding'
import { createClient } from '@/lib/supabase/server'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

// Allow streaming responses up to 30 seconds
export const maxDuration = 30

// Helper: Create cache key from context
function createCacheKey(context: SuggestionContext): string {
  const data = JSON.stringify({
    companionship: context.companionship,
    mood: context.mood,
    budget: context.budget,
    time: context.time,
    lat: context.location.lat.toFixed(3),
    lon: context.location.lon.toFixed(3),
    radius: context.radius_km,
    preferences: context.preferences?.sort(),
  })
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16)
}

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

const suggestionSchema = z.object({
  suggestions: z
    .array(
      z.object({
        placeId: z.string().uuid(),
        reason: z.string().max(200),
        matchScore: z.number().min(0).max(1),
        confidence: z.enum(['high', 'medium', 'low']),
      })
    )
    .length(3),
  searchMetadata: z.object({
    totalCandidates: z.number(),
    processingTime: z.number(),
    cacheUsed: z.boolean(),
  }),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()

  try {
    // Parse and validate input
    const body = await request.json()
    const validatedInput = suggestionRequestSchema.parse(body)

    const startTime = Date.now()

    // Build context
    const context: SuggestionContext = {
      ...validatedInput,
    }

    // Check Supabase cache first (L2 cache)
    const cacheKey = createCacheKey(context)
    console.log(`[RAG] Cache key: ${cacheKey}`)

    const { data: cached } = await supabase
      .from('embeddings_cache')
      .select('similar_places')
      .eq('query_hash', cacheKey)
      .gte('expires_at', new Date().toISOString())
      .maybeSingle()

    if (cached?.similar_places) {
      // Cache hit - return immediately
      console.log(`[RAG] ✅ Cache HIT for key: ${cacheKey}`)
      return new Response(JSON.stringify(cached.similar_places), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    console.log(`[RAG] ❌ Cache MISS for key: ${cacheKey}`)

    // Step A: Geo filter
    const candidateIds = await geoFilterPlaces(
      context.location.lat,
      context.location.lon,
      context.radius_km || 5
    )
    console.log(`[RAG] Step A - Geo Filter: Found ${candidateIds.length} candidates`)

    if (candidateIds.length === 0) {
      console.log(`[RAG] ⚠️  No candidates found in geo filter`)
      return new Response(
        JSON.stringify({
          suggestions: [],
          searchMetadata: {
            totalCandidates: 0,
            processingTime: Date.now() - startTime,
            cacheUsed: false,
          },
        }),
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    }

    // Step B: Generate query embedding
    const semanticQuery = buildSemanticQuery(context)
    console.log(`[RAG] Step B - Semantic Query: "${semanticQuery}"`)

    const queryEmbedding = await generateEmbedding(semanticQuery)
    console.log(`[RAG] Step B - Generated embedding with ${queryEmbedding.length} dimensions`)

    // Step C: Vector search
    const vectorResults = await vectorSearch(queryEmbedding, candidateIds, 12)
    console.log(`[RAG] Step C - Vector Search: Found ${vectorResults.length} similar places`)

    if (vectorResults.length === 0) {
      console.log(`[RAG] ⚠️  No results from vector search`)
      return new Response(
        JSON.stringify({
          suggestions: [],
          searchMetadata: {
            totalCandidates: candidateIds.length,
            processingTime: Date.now() - startTime,
            cacheUsed: false,
          },
        }),
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    }

    // Step D: Re-ranking
    const topKIds = vectorResults.map((r) => r.placeId)
    const reranked = await reRank(topKIds, context)
    console.log(`[RAG] Step D - Re-ranking: ${reranked.length} places ranked`)

    const topN = reranked.slice(0, 6)
    console.log(`[RAG] Top 6 places for LLM:`)
    topN.forEach((item, idx) => {
      console.log(`  ${idx + 1}. ${item.metadata.name} (score: ${item.score.toFixed(2)}, distance: ${item.metadata.distance_km.toFixed(1)}km)`)
    })

    // Load system prompt
    const systemPromptPath = path.join(
      process.cwd(),
      'src/lib/ai/prompts/system-rag.txt'
    )
    const systemPrompt = fs.readFileSync(systemPromptPath, 'utf-8')

    // Build user prompt
    const userPrompt = `
CONTESTO UTENTE:
${semanticQuery}

LOCALI DISPONIBILI (ordinati per rilevanza):
${topN
  .map(
    (item, idx) => `
${idx + 1}. ${item.metadata.name} (ID: ${item.placeId})
   - Tipo: ${item.metadata.place_type}
   - Descrizione: ${item.metadata.description || 'N/A'}
   - Indirizzo: ${item.metadata.address}, ${item.metadata.city}
   - Distanza: ${item.metadata.distance_km.toFixed(1)} km
   - Fascia prezzo: ${item.metadata.price_range || 'N/A'}
   - Atmosfera: ${item.metadata.ambience_tags?.join(', ') || 'N/A'}
   - Generi musicali: ${item.metadata.music_genre?.join(', ') || 'N/A'}
   - Verificato: ${item.metadata.verification_status === 'approved' ? 'Sì' : 'No'}
   - Popolarità: ${item.metadata.suggestions_count} suggerimenti
   - Match Score: ${item.score.toFixed(2)}
`
  )
  .join('\n')}

Seleziona ESATTAMENTE 3 locali dalla lista sopra che meglio corrispondono al contesto dell'utente.
`

    // Step E: Stream LLM Generation via AI Gateway
    console.log(`[RAG] Step E - Starting LLM generation with gpt-5-mini...`)

    const result = streamObject({
      model: 'openai/gpt-5-mini', // Gateway routes automatically (reasoning model, no temperature)
      schema: suggestionSchema,
      system: systemPrompt,
      prompt: userPrompt,
      onFinish: async ({ object }) => {
        console.log(`[RAG] ✅ LLM generation completed`)
        console.log(`[RAG] Generated ${object?.suggestions?.length || 0} suggestions`)

        // Log LLM response details
        if (object?.suggestions) {
          console.log(`[RAG] 📋 LLM Suggestions:`)
          object.suggestions.forEach((s: any, i: number) => {
            console.log(`  ${i + 1}. Place ID: ${s.placeId}`)
            console.log(`     Reason: "${s.reason}"`)
            console.log(`     Match Score: ${s.matchScore} | Confidence: ${s.confidence}`)
          })
        }

        // Cache the final result in Supabase (fire and forget)
        if (!object) return

        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h TTL

        try {
          await supabase.from('embeddings_cache').upsert({
            query_hash: cacheKey,
            query_text: semanticQuery,
            similar_places: {
              ...object,
              searchMetadata: {
                ...object.searchMetadata,
                processingTime: Date.now() - startTime,
                cacheUsed: false,
              },
            },
            expires_at: expiresAt.toISOString(),
          })
          console.log(`[Cache] Saved result for key: ${cacheKey}`)
        } catch (err) {
          console.error('[Cache] Failed to save:', err)
        }
      },
    })

    // Return streaming response (streamObject uses toTextStreamResponse)
    return result.toTextStreamResponse()
  } catch (error) {
    if (error instanceof z.ZodError) {
      return new Response(
        JSON.stringify({
          error: 'Invalid input',
          details: error.issues,
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    }

    console.error('Error in suggest stream API:', error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Internal server error',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    )
  }
}
