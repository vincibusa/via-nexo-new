import { NextRequest } from 'next/server'
import { z } from 'zod'
import { generateObject, streamObject } from 'ai'
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

// Input validation schema - accepts natural language message
const chatRequestSchema = z.object({
  message: z.string().min(1).max(500),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  }),
  radius_km: z.number().min(0.5).max(50).optional().default(5),
})

// Parameter extraction schema
const extractedParamsSchema = z.object({
  companionship: z.array(z.enum(['alone', 'partner', 'friends', 'family'])),
  mood: z.array(z.enum(['relaxed', 'energetic', 'cultural', 'romantic'])),
  budget: z.enum(['€', '€€', '€€€']).default('€€'),
  time: z.enum(['morning', 'afternoon', 'evening', 'night', 'now', 'tonight', 'weekend']).default('tonight'),
  keywords: z.array(z.string()),
})

// Suggestion response schema
const chatSuggestionSchema = z.object({
  conversationalResponse: z.string().max(300).describe('Una risposta amichevole e colloquiale in italiano che introduce i suggerimenti'),
  suggestions: z
    .array(
      z.object({
        placeId: z.string().uuid(),
        reason: z.string().max(200).describe('Spiega perché questo posto è perfetto per la loro richiesta'),
        matchScore: z.number().min(0).max(1),
        confidence: z.enum(['high', 'medium', 'low']),
      })
    )
    .min(1)
    .max(3),
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
    const validatedInput = chatRequestSchema.parse(body)

    const startTime = Date.now()

    console.log(`[Chat] User message: "${validatedInput.message}"`)

    // Load extraction system prompt
    const extractionPromptPath = path.join(
      process.cwd(),
      'src/lib/ai/prompts/system-chat-extraction.txt'
    )
    const extractionPrompt = fs.readFileSync(extractionPromptPath, 'utf-8')

    // STEP 1: Extract structured parameters from natural language
    console.log(`[Chat] Step 1 - Extracting parameters...`)
    const { object: extractedParams } = await generateObject({
      model: 'openai/gpt-5-mini',
      schema: extractedParamsSchema,
      system: extractionPrompt,
      prompt: validatedInput.message,
    })

    console.log(`[Chat] ✅ Extracted params:`, extractedParams)

    // Convert extracted params to SuggestionContext
    const context: SuggestionContext = {
      companionship: extractedParams.companionship[0], // Take first value
      mood: extractedParams.mood[0], // Take first value
      budget: extractedParams.budget,
      time: extractedParams.time === 'now' || extractedParams.time === 'tonight' || extractedParams.time === 'weekend'
        ? 'evening' // Default fallback
        : extractedParams.time,
      location: validatedInput.location,
      radius_km: validatedInput.radius_km,
      preferences: extractedParams.keywords.length > 0 ? extractedParams.keywords : undefined,
    }

    // Check Supabase cache first (L2 cache)
    const cacheKey = createCacheKey(context)
    console.log(`[Chat] Cache key: ${cacheKey}`)

    const { data: cached } = await supabase
      .from('embeddings_cache')
      .select('similar_places')
      .eq('query_hash', cacheKey)
      .gte('expires_at', new Date().toISOString())
      .maybeSingle()

    let topN: any[] = []
    let totalCandidates = 0
    let cacheUsed = false
    let semanticQuery = ''

    if (cached?.similar_places) {
      // Cache hit - use cached suggestions for LLM
      console.log(`[Chat] ✅ Cache HIT for key: ${cacheKey}`)
      cacheUsed = true

      // Increment hit count (fire and forget)
      Promise.resolve(
        supabase.from('embeddings_cache')
          .update({ hit_count: (cached.similar_places.searchMetadata?.hit_count || 0) + 1 })
          .eq('query_hash', cacheKey)
      ).then(() => console.log(`[Cache] Incremented hit_count for key: ${cacheKey}`))
        .catch((err) => console.error('[Cache] Failed to increment hit_count:', err))

      // Extract place IDs from cached suggestions
      const cachedPlaceIds = cached.similar_places.suggestions.map((s: any) => s.placeId)

      // Fetch full place details for LLM context
      const { data: places } = await supabase
        .from('places')
        .select('*')
        .in('id', cachedPlaceIds)

      if (places) {
        topN = places.map((place: any) => ({
          placeId: place.id,
          score: 0.9, // High score for cached results
          metadata: {
            name: place.name,
            place_type: place.place_type,
            description: place.description,
            address: place.address,
            city: place.city,
            distance_km: 0, // Will be recalculated if needed
            price_range: place.price_range,
            ambience_tags: place.ambience_tags,
            music_genre: place.music_genre,
            verification_status: place.verification_status,
            suggestions_count: 0,
          }
        }))
      }

      semanticQuery = buildSemanticQuery(context)
      totalCandidates = cached.similar_places.searchMetadata?.totalCandidates || 0
    } else {
      console.log(`[Chat] ❌ Cache MISS for key: ${cacheKey}`)

      // STEP 2: Run full RAG pipeline
      // Step A: Geo filter
      const candidateIds = await geoFilterPlaces(
        context.location.lat,
        context.location.lon,
        context.radius_km || 5
      )
      console.log(`[Chat] Step A - Geo Filter: Found ${candidateIds.length} candidates`)

      totalCandidates = candidateIds.length

      if (candidateIds.length === 0) {
        console.log(`[Chat] ⚠️  No candidates found in geo filter`)
        return new Response(
          JSON.stringify({
            conversationalResponse: 'Mi dispiace, non ho trovato nessun locale nella tua zona. Prova ad ampliare il raggio di ricerca! 📍',
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
      semanticQuery = buildSemanticQuery(context)
      console.log(`[Chat] Step B - Semantic Query: "${semanticQuery}"`)

      const queryEmbedding = await generateEmbedding(semanticQuery)
      console.log(`[Chat] Step B - Generated embedding with ${queryEmbedding.length} dimensions`)

      // Step C: Vector search
      const vectorResults = await vectorSearch(queryEmbedding, candidateIds, 12)
      console.log(`[Chat] Step C - Vector Search: Found ${vectorResults.length} similar places`)

      if (vectorResults.length === 0) {
        console.log(`[Chat] ⚠️  No results from vector search`)
        return new Response(
          JSON.stringify({
            conversationalResponse: 'Hmm, non trovo nulla che corrisponda esattamente. Prova a descrivere cosa cerchi in modo diverso! 🤔',
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
      console.log(`[Chat] Step D - Re-ranking: ${reranked.length} places ranked`)

      topN = reranked.slice(0, 6)
      console.log(`[Chat] Top 6 places for LLM:`)
      topN.forEach((item, idx) => {
        console.log(`  ${idx + 1}. ${item.metadata.name} (score: ${item.score.toFixed(2)}, distance: ${item.metadata.distance_km.toFixed(1)}km)`)
      })
    }

    // STEP 3: Generate conversational response with suggestions
    console.log(`[Chat] Step 3 - Generating conversational response...`)

    // Load response system prompt
    const responsePromptPath = path.join(
      process.cwd(),
      'src/lib/ai/prompts/system-chat-response.txt'
    )
    const responsePrompt = fs.readFileSync(responsePromptPath, 'utf-8')

    // Build user prompt for LLM
    const userPrompt = `
RICHIESTA ORIGINALE UTENTE:
"${validatedInput.message}"

PARAMETRI ESTRATTI:
- Compagnia: ${extractedParams.companionship.join(', ') || 'Non specificato'}
- Mood: ${extractedParams.mood.join(', ') || 'Non specificato'}
- Budget: ${extractedParams.budget}
- Quando: ${extractedParams.time}
- Keyword: ${extractedParams.keywords.join(', ') || 'Nessuna'}

LOCALI DISPONIBILI (ordinati per rilevanza):
${topN
  .map(
    (item, idx) => `
${idx + 1}. ${item.metadata.name} (ID: ${item.placeId})
   - Tipo: ${item.metadata.place_type}
   - Descrizione: ${item.metadata.description || 'N/A'}
   - Indirizzo: ${item.metadata.address}, ${item.metadata.city}
   - Distanza: ${item.metadata.distance_km?.toFixed(1) || 'N/A'} km
   - Fascia prezzo: ${item.metadata.price_range || 'N/A'}
   - Atmosfera: ${item.metadata.ambience_tags?.join(', ') || 'N/A'}
   - Generi musicali: ${item.metadata.music_genre?.join(', ') || 'N/A'}
   - Verificato: ${item.metadata.verification_status === 'approved' ? 'Sì' : 'No'}
   - Match Score: ${item.score.toFixed(2)}
`
  )
  .join('\n')}

Rispondi in modo amichevole alla richiesta dell'utente e seleziona da 1 a 3 locali dalla lista sopra che meglio corrispondono.
Spiega brevemente perché ogni locale è perfetto per loro.
`

    // Stream LLM Generation via AI Gateway
    const result = streamObject({
      model: 'openai/gpt-5-mini',
      schema: chatSuggestionSchema,
      system: responsePrompt,
      prompt: userPrompt,
      onFinish: async ({ object }) => {
        console.log(`[Chat] ✅ LLM generation completed`)
        console.log(`[Chat] Generated ${object?.suggestions?.length || 0} suggestions`)

        // Log LLM response details
        if (object?.suggestions) {
          console.log(`[Chat] 📋 LLM Suggestions:`)
          object.suggestions.forEach((s: any, i: number) => {
            console.log(`  ${i + 1}. Place ID: ${s.placeId}`)
            console.log(`     Reason: "${s.reason}"`)
            console.log(`     Match Score: ${s.matchScore} | Confidence: ${s.confidence}`)
          })
        }

        // Cache the result if not already cached (fire and forget)
        if (!cacheUsed && object?.suggestions) {
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h TTL

          try {
            const queryEmbedding = await generateEmbedding(semanticQuery)

            await supabase.from('embeddings_cache').upsert({
              query_hash: cacheKey,
              query_text: semanticQuery,
              query_embedding: queryEmbedding,
              similar_places: {
                suggestions: object.suggestions,
                searchMetadata: {
                  totalCandidates,
                  processingTime: Date.now() - startTime,
                  cacheUsed: false,
                },
              },
              expires_at: expiresAt.toISOString(),
            })
            console.log(`[Cache] ✅ Saved result for key: ${cacheKey}`)
          } catch (err) {
            console.error('[Cache] ❌ Failed to save:', err)
          }
        }
      },
    })

    // Return streaming response
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

    console.error('Error in chat suggest API:', error)
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
