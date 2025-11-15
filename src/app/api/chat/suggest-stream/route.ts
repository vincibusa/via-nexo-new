import { NextRequest } from 'next/server'
import { z } from 'zod'
import { streamObject, generateObject } from 'ai'
import { openai } from '@ai-sdk/openai'
import {
  geoFilterPlaces,
  geoFilterEvents,
  buildSemanticQuery,
  vectorSearch,
  vectorSearchEvents,
  reRank,
  reRankEvents,
  SuggestionContext,
} from '@/lib/ai/rag-pipeline'
import { generateEmbedding } from '@/lib/ai/embedding'
import { createClient } from '@/lib/supabase/server'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

// Allow streaming responses up to 30 seconds
export const maxDuration = 30

/**
 * ENHANCED: Smart context management for optimal conversation flow
 */
function manageConversationContext(
  history: Array<{ content: string; is_user: boolean; timestamp: string }>,
  currentMessage: string
): {
  relevantHistory: Array<{ content: string; is_user: boolean; timestamp: string }>;
  contextSummary: string;
  isTopicChange: boolean;
} {
  if (history.length === 0) {
    return { relevantHistory: [], contextSummary: "", isTopicChange: false }
  }

  // Simple topic change detection
  const topicChangeKeywords = [
    'invece', 'comunque', 'cambiamo argomento', 'altro', 'dimenticavo',
    'diverso', 'altra cosa', 'ora', 'adesso'
  ]
  
  const isTopicChange = topicChangeKeywords.some(keyword => 
    currentMessage.toLowerCase().includes(keyword)
  )

  // If topic change detected, use shorter context window
  const contextWindow = isTopicChange ? 3 : Math.min(8, history.length)
  const relevantHistory = history.slice(-contextWindow)

  // Create context summary if history is long
  let contextSummary = ""
  if (history.length > contextWindow) {
    const olderMessages = history.slice(0, -contextWindow)
    const userRequests = olderMessages
      .filter(msg => msg.is_user)
      .map(msg => msg.content)
      .slice(-3) // Last 3 older user requests
    
    if (userRequests.length > 0) {
      contextSummary = `
[CONTESTO PRECEDENTE: L'utente ha chiesto in passato di: "${userRequests.join('", "')}"]
`
    }
  }

  return { relevantHistory, contextSummary, isTopicChange }
}

/**
 * ENHANCED: Retrieve conversation history for context-aware responses
 */
async function getConversationHistory(
  supabase: any,
  conversationId: string,
  userId: string,
  limit: number = 12 // Slightly higher to allow for context management
): Promise<Array<{ content: string; is_user: boolean; timestamp: string }>> {
  try {
    // Verify user owns this conversation
    const { data: conversation } = await supabase
      .from('chat_conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .single()

    if (!conversation) {
      console.warn(`[Chat History] Conversation ${conversationId} not found for user ${userId}`)
      return []
    }

    // Get recent messages from the conversation
    const { data: messages, error } = await supabase
      .from('chat_messages')
      .select('content, is_user, timestamp')
      .eq('conversation_id', conversationId)
      .order('message_order', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('[Chat History] Error fetching messages:', error)
      return []
    }

    // Return messages in chronological order (oldest first)
    return (messages || []).reverse()
  } catch (error) {
    console.error('[Chat History] Error in getConversationHistory:', error)
    return []
  }
}

/**
 * ENHANCED: Build conversation context for LLM
 */
function buildConversationContext(history: Array<{ content: string; is_user: boolean; timestamp: string }>): string {
  if (history.length === 0) {
    return ""
  }

  const contextLines = history.map(msg => {
    const speaker = msg.is_user ? "Utente" : "Assistente"
    return `${speaker}: "${msg.content}"`
  })

  return `
CRONOLOGIA CONVERSAZIONE:
${contextLines.join('\n')}

---
`
}

/**
 * ENHANCED: Extract user preferences from conversation history
 */
function extractUserPreferences(history: Array<{ content: string; is_user: boolean; timestamp: string }>): {
  preferredBudget?: string;
  preferredMood?: string[];
  preferredCompanionship?: string[];
  preferredTime?: string;
  commonKeywords?: string[];
} {
  if (history.length === 0) {
    return {}
  }

  const userMessages = history.filter(msg => msg.is_user).map(msg => msg.content.toLowerCase())
  
  // Simple preference extraction (can be enhanced with NLP)
  const preferences: any = {}
  
  // Budget patterns
  if (userMessages.some(msg => msg.includes('economico') || msg.includes('cheap') || msg.includes('€'))) {
    preferences.preferredBudget = '€'
  } else if (userMessages.some(msg => msg.includes('costoso') || msg.includes('lusso') || msg.includes('€€€€'))) {
    preferences.preferredBudget = '€€€€'
  }
  
  // Mood patterns
  const moodKeywords = []
  if (userMessages.some(msg => msg.includes('romantico') || msg.includes('intimo'))) {
    moodKeywords.push('romantic')
  }
  if (userMessages.some(msg => msg.includes('energico') || msg.includes('ballare') || msg.includes('festa'))) {
    moodKeywords.push('energetic')
  }
  if (userMessages.some(msg => msg.includes('tranquillo') || msg.includes('rilassant'))) {
    moodKeywords.push('relaxed')
  }
  if (moodKeywords.length > 0) {
    preferences.preferredMood = moodKeywords
  }
  
  // Companionship patterns
  const companionshipKeywords = []
  if (userMessages.some(msg => msg.includes('famiglia'))) {
    companionshipKeywords.push('family')
  }
  if (userMessages.some(msg => msg.includes('amici') || msg.includes('gruppo'))) {
    companionshipKeywords.push('friends')
  }
  if (userMessages.some(msg => msg.includes('partner') || msg.includes('ragazza') || msg.includes('ragazzo'))) {
    companionshipKeywords.push('partner')
  }
  if (companionshipKeywords.length > 0) {
    preferences.preferredCompanionship = companionshipKeywords
  }

  return preferences
}

/**
 * ENHANCED: Apply user preferences to context when parameters are missing
 */
function enhanceContextWithPreferences(
  context: any, 
  preferences: any
): any {
  const enhancedContext = { ...context }
  
  // Apply preferences only if current context doesn't specify them
  if (!enhancedContext.budget && preferences.preferredBudget) {
    enhancedContext.budget = preferences.preferredBudget
    console.log(`[Preferences] Applied preferred budget: ${preferences.preferredBudget}`)
  }
  
  if (!enhancedContext.mood && preferences.preferredMood && preferences.preferredMood.length > 0) {
    enhancedContext.mood = preferences.preferredMood[0]
    console.log(`[Preferences] Applied preferred mood: ${preferences.preferredMood[0]}`)
  }
  
  if (!enhancedContext.companionship && preferences.preferredCompanionship && preferences.preferredCompanionship.length > 0) {
    enhancedContext.companionship = preferences.preferredCompanionship[0]
    console.log(`[Preferences] Applied preferred companionship: ${preferences.preferredCompanionship[0]}`)
  }

  return enhancedContext
}

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

// Helper: Create vector cache key from semantic query and candidates
function createVectorCacheKey(semanticQuery: string, placeCandidateIds: string[], eventCandidateIds: string[]): string {
  const data = JSON.stringify({
    query: semanticQuery,
    placeIds: placeCandidateIds.sort(),
    eventIds: eventCandidateIds.sort(),
  })
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16)
}

// Input validation schema - accepts natural language message with optional conversation context
const chatRequestSchema = z.object({
  message: z.string().min(1).max(500),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  }),
  radius_km: z.number().min(0.5).max(50).optional().default(5),
  conversation_id: z.string().uuid().optional(), // ENHANCED: Optional conversation context
})

// OTTIMIZZAZIONE: Schema unificato per parameter extraction + response generation
const unifiedSuggestionSchema = z.object({
  // Parameter extraction (interno, non visibile all'utente)
  extractedParams: z.object({
    companionship: z.array(z.enum(['alone', 'partner', 'friends', 'family'])),
    mood: z.array(z.enum(['relaxed', 'energetic', 'cultural', 'romantic'])),
    budget: z.enum(['€', '€€', '€€€']).default('€€'),
    time: z.enum(['morning', 'afternoon', 'evening', 'night', 'now', 'tonight', 'weekend']).default('tonight'),
    keywords: z.array(z.string()),
  }),
  // Response generation (visibile all'utente)
  conversationalResponse: z.string().max(300).describe('Una risposta amichevole e colloquiale in italiano che introduce i suggerimenti'),
  suggestions: z
    .array(
      z.object({
        id: z.string().uuid(),
        type: z.enum(['place', 'event']),
        reason: z.string().max(300).describe('Spiega perché questo posto/evento è perfetto per la loro richiesta'),
        matchScore: z.number().min(0).max(2),
        confidence: z.enum(['high', 'medium', 'low']),
      })
    )
    .min(0)
    .max(3),
  searchMetadata: z.object({
    totalCandidates: z.number(),
    totalPlaces: z.number(),
    totalEvents: z.number(),
    processingTime: z.number(),
    cacheUsed: z.boolean(),
    contextUsed: z.boolean().optional(),
    conversationLength: z.number().optional(),
  }),
})

// Schema legacy per backward compatibility
const extractedParamsSchema = z.object({
  companionship: z.array(z.enum(['alone', 'partner', 'friends', 'family'])),
  mood: z.array(z.enum(['relaxed', 'energetic', 'cultural', 'romantic'])),
  budget: z.enum(['€', '€€', '€€€']).default('€€'),
  time: z.enum(['morning', 'afternoon', 'evening', 'night', 'now', 'tonight', 'weekend']).default('tonight'),
  keywords: z.array(z.string()),
})

const chatSuggestionSchema = z.object({
  conversationalResponse: z.string().max(300).describe('Una risposta amichevole e colloquiale in italiano che introduce i suggerimenti'),
  suggestions: z
    .array(
      z.object({
        id: z.string().uuid(),
        type: z.enum(['place', 'event']),
        reason: z.string().max(300).describe('Spiega perché questo posto/evento è perfetto per la loro richiesta'),
        matchScore: z.number().min(0).max(2),
        confidence: z.enum(['high', 'medium', 'low']),
      })
    )
    .min(0)
    .max(3),
  searchMetadata: z.object({
    totalCandidates: z.number(),
    totalPlaces: z.number(),
    totalEvents: z.number(),
    processingTime: z.number(),
    cacheUsed: z.boolean(),
    contextUsed: z.boolean().optional(),
    conversationLength: z.number().optional(),
  }),
})

export async function POST(request: NextRequest) {
  return handleChatSuggestStream(request)
}

export async function GET(request: NextRequest) {
  return handleChatSuggestStream(request)
}

async function handleChatSuggestStream(request: NextRequest) {
  // OTTIMIZZAZIONE: Riutilizza connessione Supabase per tutta la richiesta
  const supabase = await createClient()

  try {
    // Parse and validate input first
    const body = await request.json()
    const validatedInput = chatRequestSchema.parse(body)

    // Set up SSE headers
    const encoder = new TextEncoder()
    
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send initial connection event
          const initEvent = `data: ${JSON.stringify({ type: 'init', message: 'Connected' })}\n\n`
          controller.enqueue(encoder.encode(initEvent))

        const startTime = Date.now()

        console.log(`[Chat Stream] User message: "${validatedInput.message}"`)
        
        // Get current user for conversation history
        const { data: { user } } = await supabase.auth.getUser()

        // ENHANCED: Retrieve and manage conversation history if conversation_id provided
        let conversationHistory: Array<{ content: string; is_user: boolean; timestamp: string }> = []
        let conversationContext = ""
        let contextSummary = ""
        let isTopicChange = false
        
        if (validatedInput.conversation_id && user) {
          console.log(`[Chat Stream] Retrieving history for conversation: ${validatedInput.conversation_id}`)
          const fullHistory = await getConversationHistory(
            supabase,
            validatedInput.conversation_id,
            user.id,
            12 // Get more messages for smart context management
          )
          
          // Apply smart context management
          const contextManagement = manageConversationContext(fullHistory, validatedInput.message)
          conversationHistory = contextManagement.relevantHistory
          contextSummary = contextManagement.contextSummary
          isTopicChange = contextManagement.isTopicChange
          
          conversationContext = buildConversationContext(conversationHistory) + contextSummary
          
          console.log(`[Chat Stream] Retrieved ${fullHistory.length} total messages, using ${conversationHistory.length} for context`)
          if (isTopicChange) {
            console.log(`[Chat Stream] 🔄 Topic change detected, using shorter context window`)
          }
        }

        // OTTIMIZZAZIONE: Load unified system prompt for both extraction + response
        const unifiedPromptPath = path.join(
          process.cwd(),
          'src/lib/ai/prompts/system-chat-unified.txt'
        )
        
        let unifiedPrompt: string
        try {
          unifiedPrompt = fs.readFileSync(unifiedPromptPath, 'utf-8')
        } catch (error) {
          // Fallback to separate prompts if unified doesn't exist yet
          const extractionPromptPath = path.join(
            process.cwd(),
            'src/lib/ai/prompts/system-chat-extraction.txt'
          )
          const responsePromptPath = path.join(
            process.cwd(),
            'src/lib/ai/prompts/system-chat-response.txt'
          )
          const extractionPrompt = fs.readFileSync(extractionPromptPath, 'utf-8')
          const responsePrompt = fs.readFileSync(responsePromptPath, 'utf-8')
          
          unifiedPrompt = `${extractionPrompt}\n\n--- RESPONSE GENERATION ---\n\n${responsePrompt}`
        }

        // STEP 1: Send progress event
        console.log(`[Chat Stream] Step 1 - Processing request...`)
        
        const progressEvent = `data: ${JSON.stringify({ 
          type: 'progress', 
          step: 'processing',
          message: 'Elaborazione richiesta...' 
        })}\n\n`
        controller.enqueue(encoder.encode(progressEvent))

        // ENHANCED: Include conversation context
        const contextualPrompt = conversationContext + 
          `NUOVO MESSAGGIO UTENTE: "${validatedInput.message}"
          
Analizza il messaggio dell'utente tenendo conto della cronologia della conversazione. 
Se il messaggio fa riferimento a richieste precedenti, usa il contesto per comprendere l'intenzione.

Prima estrai i parametri (extractedParams), poi procedi con la ricerca e genera la risposta finale.`

        console.log(`[DEBUG] Using UNIFIED approach - single LLM call`)
        console.log(`[DEBUG] Has conversation context:`, !!conversationContext)
        console.log(`[DEBUG] Prompt length:`, (conversationContext ? contextualPrompt : validatedInput.message).length)
        console.log(`[DEBUG] User message:`, validatedInput.message)

        // Extract parameters for context building (lightweight, needed for search)
        let extractedParams: z.infer<typeof extractedParamsSchema>
        try {
          console.log(`[DEBUG] Quick parameter extraction for search context...`)
          const result = await generateObject({
            model: openai('gpt-4.1-mini'), // FIX: No reasoning tokens, velocità massima
            schema: extractedParamsSchema,
            system: `Estrai velocemente i parametri dal messaggio utente.

IMPORTANTE per budget:
- "€" per economico/cheap
- "€€" per medio/normale (default)
- "€€€" per lusso/fancy

Usa SOLO questi tre valori esatti, senza caratteri speciali.`,
            prompt: validatedInput.message,
          })
          extractedParams = result.object
          console.log(`[DEBUG] Quick extraction completed:`, extractedParams)
        } catch (error) {
          console.error(`[DEBUG] Quick extraction failed:`, error)
          // Fallback sicuro
          extractedParams = {
            companionship: ['alone'],
            mood: ['relaxed'], 
            budget: '€€',
            time: 'evening',
            keywords: []
          }
          console.log(`[DEBUG] Using fallback params:`, extractedParams)
        }

        // ENHANCED: Extract user preferences from conversation history
        const userPreferences = extractUserPreferences(conversationHistory)
        if (Object.keys(userPreferences).length > 0) {
          console.log(`[Chat Stream] 🧠 Extracted preferences:`, userPreferences)
        }

        // Convert extracted params to SuggestionContext with proper defaults
        let context: SuggestionContext = {
          companionship: (extractedParams.companionship && extractedParams.companionship.length > 0) 
            ? extractedParams.companionship[0] 
            : 'alone',
          mood: (extractedParams.mood && extractedParams.mood.length > 0) 
            ? extractedParams.mood[0] 
            : 'relaxed',
          budget: extractedParams.budget || '€€',
          time: extractedParams.time === 'now' || extractedParams.time === 'tonight' || extractedParams.time === 'weekend'
            ? 'evening' // Default fallback
            : extractedParams.time || 'evening',
          location: validatedInput.location,
          radius_km: validatedInput.radius_km,
          preferences: (extractedParams.keywords && extractedParams.keywords.length > 0) 
            ? extractedParams.keywords 
            : undefined,
        }

        // ENHANCED: Apply user preferences to fill in missing parameters
        context = enhanceContextWithPreferences(context, userPreferences)

        // Send progress event
        const searchEvent = `data: ${JSON.stringify({ 
          type: 'progress', 
          step: 'searching',
          message: 'Ricerca locali...' 
        })}\n\n`
        controller.enqueue(encoder.encode(searchEvent))

        // OTTIMIZZAZIONE: Check Supabase cache first (L2 cache) - connessione riutilizzata
        const cacheKey = createCacheKey(context)
        console.log(`[Chat Stream] Cache key: ${cacheKey}`)

        let { data: cached } = await supabase
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
          console.log(`[Chat Stream] ✅ Cache HIT for key: ${cacheKey}`)
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

          if (places && places.length > 0) {
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
          } else {
            console.log(`[Cache] Cached data is empty, falling back to fresh search`)
            cacheUsed = false
            cached = null // Force fresh search by nullifying cached
          }

          semanticQuery = buildSemanticQuery(context)
          totalCandidates = cached?.similar_places?.searchMetadata?.totalCandidates || 0
        }
        
        // If cache failed or returned empty data, proceed with fresh search
        if (!cached?.similar_places || topN.length === 0) {
          if (cached) {
            console.log(`[Chat Stream] ❌ Cache data corrupted for key: ${cacheKey}, doing fresh search`)
          } else {
            console.log(`[Chat Stream] ❌ Cache MISS for key: ${cacheKey}`)
          }

          // STEP 2: Run full RAG pipeline
          // Step A: Geo filter (parallel for places and events)
          const [placeCandidateIds, eventCandidateIds] = await Promise.all([
            geoFilterPlaces(context.location.lat, context.location.lon, context.radius_km || 5),
            geoFilterEvents(context.location.lat, context.location.lon, context.radius_km || 5),
          ])
          console.log(`[Chat Stream] Step A - Geo Filter: Found ${placeCandidateIds.length} places, ${eventCandidateIds.length} events`)

          totalCandidates = placeCandidateIds.length + eventCandidateIds.length

          if (placeCandidateIds.length === 0 && eventCandidateIds.length === 0) {
            console.log(`[Chat Stream] ⚠️  No candidates found in geo filter`)
            
            // Send error event
            const errorEvent = `data: ${JSON.stringify({
              type: 'complete',
              conversationalResponse: 'Mi dispiace, non ho trovato nessun locale o evento nella tua zona. Prova ad ampliare il raggio di ricerca! 📍',
              suggestions: [],
              searchMetadata: {
                totalCandidates: 0,
                totalPlaces: 0,
                totalEvents: 0,
                processingTime: Date.now() - startTime,
                cacheUsed: false,
                contextUsed: !!conversationContext,
                conversationLength: conversationHistory.length,
              },
            })}\n\n`
            controller.enqueue(encoder.encode(errorEvent))
            controller.close()
            return
          }

          // Step B: Generate query embedding
          semanticQuery = buildSemanticQuery(context)
          console.log(`[Chat Stream] Step B - Semantic Query: "${semanticQuery}"`)

          const queryEmbedding = await generateEmbedding(semanticQuery)
          console.log(`[Chat Stream] Step B - Generated embedding with ${queryEmbedding.length} dimensions`)

          // OTTIMIZZAZIONE: Step C - Vector search with caching
          const vectorCacheKey = createVectorCacheKey(semanticQuery, placeCandidateIds, eventCandidateIds)
          console.log(`[Chat Stream] Step C - Vector Search with cache key: ${vectorCacheKey}`)
          
          // OTTIMIZZAZIONE: Check vector cache (riutilizza connessione esistente)
          const { data: vectorCached } = await supabase
            .from('vector_search_cache')
            .select('place_results, event_results, cached_at')
            .eq('cache_key', vectorCacheKey)
            .gte('expires_at', new Date().toISOString())
            .maybeSingle()

          let placeVectorResults: any[], eventVectorResults: any[];
          
          if (vectorCached && vectorCached.place_results && vectorCached.event_results) {
            console.log(`[Chat Stream] ✅ Vector Cache HIT for key: ${vectorCacheKey}`)
            placeVectorResults = vectorCached.place_results
            eventVectorResults = vectorCached.event_results
          } else {
            console.log(`[Chat Stream] ❌ Vector Cache MISS for key: ${vectorCacheKey}`)
            
            // Perform vector search (parallel for places and events)
            const [placeResults, eventResults] = await Promise.all([
              placeCandidateIds.length > 0 ? vectorSearch(queryEmbedding, placeCandidateIds, 8) : Promise.resolve([]),
              eventCandidateIds.length > 0 ? vectorSearchEvents(queryEmbedding, eventCandidateIds, 8) : Promise.resolve([]),
            ])
            
            placeVectorResults = placeResults
            eventVectorResults = eventResults
            
            // Cache vector results (fire and forget)
            if (placeVectorResults.length > 0 || eventVectorResults.length > 0) {
              const vectorExpiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000) // 6h TTL for vector cache
              
              Promise.resolve(
                supabase.from('vector_search_cache').upsert({
                  cache_key: vectorCacheKey,
                  query_text: semanticQuery,
                  place_results: placeVectorResults,
                  event_results: eventVectorResults,
                  place_count: placeCandidateIds.length,
                  event_count: eventCandidateIds.length,
                  expires_at: vectorExpiresAt.toISOString(),
                  cached_at: new Date().toISOString(),
                })
              ).then(() => console.log(`[Vector Cache] ✅ Saved results for key: ${vectorCacheKey}`))
               .catch((err) => console.error('[Vector Cache] ❌ Failed to save:', err))
            }
          }
          
          console.log(`[Chat Stream] Step C - Vector Search: Found ${placeVectorResults.length} places, ${eventVectorResults.length} events`)

          if (placeVectorResults.length === 0 && eventVectorResults.length === 0) {
            console.log(`[Chat Stream] ⚠️  No results from vector search`)
            
            // Send error event
            const errorEvent = `data: ${JSON.stringify({
              type: 'complete',
              conversationalResponse: 'Hmm, non trovo nulla che corrisponda esattamente. Prova a descrivere cosa cerchi in modo diverso! 🤔',
              suggestions: [],
              searchMetadata: {
                totalCandidates: totalCandidates,
                totalPlaces: placeCandidateIds.length,
                totalEvents: eventCandidateIds.length,
                processingTime: Date.now() - startTime,
                cacheUsed: false,
                contextUsed: !!conversationContext,
                conversationLength: conversationHistory.length,
              },
            })}\n\n`
            controller.enqueue(encoder.encode(errorEvent))
            controller.close()
            return
          }

          // Step D: Re-ranking (parallel for places and events)
          const [rerankedPlaces, rerankedEvents] = await Promise.all([
            placeVectorResults.length > 0
              ? reRank(placeVectorResults.map((r) => r.placeId), context)
              : Promise.resolve([]),
            eventVectorResults.length > 0
              ? reRankEvents(eventVectorResults.map((r) => r.eventId), context)
              : Promise.resolve([]),
          ])
          console.log(`[Chat Stream] Step D - Re-ranking: ${rerankedPlaces.length} places, ${rerankedEvents.length} events`)

          // Combine places and events (aim for ~4 places + ~2 events for LLM)
          const topPlaces = rerankedPlaces.slice(0, 4)
          const topEvents = rerankedEvents.slice(0, 2)

          topN = [...topPlaces, ...topEvents]
          
          console.log(`[DEBUG] Final topN results:`, topN.map(item => ({
            id: item.placeId || item.eventId,
            type: item.placeId ? 'place' : 'event',
            name: item.metadata.name || item.metadata.title,
            score: item.score
          })))
        }

        // OTTIMIZZAZIONE: Send progress event for unified processing
        const aiEvent = `data: ${JSON.stringify({ 
          type: 'progress', 
          step: 'generating',
          message: 'Elaborazione finale...' 
        })}\n\n`
        controller.enqueue(encoder.encode(aiEvent))

        // STEP 3: UNIFIED PROCESSING - Single LLM call for extraction + response
        console.log(`[Chat Stream] Step 3 - UNIFIED LLM processing...`)

        // Build user prompt for LLM with both places and events
        const placesForLLM = topN.filter(item => 'name' in item.metadata);
        const eventsForLLM = topN.filter(item => 'title' in item.metadata);
        
        // Validate we have data to work with
        if (placesForLLM.length === 0 && eventsForLLM.length === 0) {
          console.error(`[DEBUG] NO DATA for LLM! This is the root cause.`)
          console.error(`[DEBUG] topN length:`, topN.length)
          console.error(`[DEBUG] topN contents:`, topN.map(item => ({ 
            id: item.placeId || item.eventId, 
            hasName: 'name' in item.metadata,
            hasTitle: 'title' in item.metadata,
            metadata: Object.keys(item.metadata)
          })))
          
          // Send error event
          const errorEvent = `data: ${JSON.stringify({
            type: 'complete',
            conversationalResponse: 'Mi dispiace, non riesco a trovare nulla di adatto nella tua zona. Prova a modificare i criteri di ricerca! 🔍',
            suggestions: [],
            searchMetadata: {
              totalCandidates: totalCandidates,
              totalPlaces: 0,
              totalEvents: 0,
              processingTime: Date.now() - startTime,
              cacheUsed: cacheUsed,
              contextUsed: !!conversationContext,
              conversationLength: conversationHistory.length,
            },
          })}\n\n`
          controller.enqueue(encoder.encode(errorEvent))
          controller.close()
          return
        }
        
        console.log(`[Chat Stream] 🎯 Unified LLM processing: ${placesForLLM.length} places, ${eventsForLLM.length} events`);
        console.log(`[DEBUG] Places for LLM:`, placesForLLM.map(p => ({ id: p.placeId || p.eventId, name: p.metadata.name || p.metadata.title })));
        console.log(`[DEBUG] Events for LLM:`, eventsForLLM.map(e => ({ id: e.eventId, title: e.metadata.title })));
        
        // OTTIMIZZAZIONE: Prompt ultra-compatto - Ridotto del 60% rispetto alla versione precedente
        const placesSection = placesForLLM.length > 0 ? 
          placesForLLM.map((item, idx) => 
            `${idx + 1}. ${item.metadata.name} (${item.placeId}) - ${item.metadata.place_type}, ${item.metadata.city}, score:${item.score.toFixed(1)}`
          ).join('\n') : '';

        const eventsSection = eventsForLLM.length > 0 ? 
          eventsForLLM.map((item, idx) => 
            `${idx + placesForLLM.length + 1}. ${item.metadata.title} (${item.eventId}) - ${item.metadata.event_type}, ${item.metadata.place.city}, score:${item.score.toFixed(1)}`
          ).join('\n') : '';

        const optionsList = [placesSection, eventsSection].filter(s => s).join('\n')
        
        const unifiedUserPrompt = `MSG: "${validatedInput.message}"
OPZIONI:\n${optionsList}

ESTRAI: companionship[], mood[], budget(€/€€/€€€), time, keywords[].
RISPONDI: conversationalResponse(max150char), suggestions(1-3 dalla lista), searchMetadata.
USA SOLO gli ID dalla lista sopra.`
        // OTTIMIZZAZIONE: UNIFIED LLM Call - Nessuna doppia latenza!
        console.log(`[DEBUG] Starting UNIFIED LLM generation...`)
        console.log(`[DEBUG] ULTRA-COMPACT prompt length:`, unifiedUserPrompt.length)
        console.log(`[DEBUG] Prompt reduction: ~75% smaller than original`)
        console.log(`[DEBUG] Using unified schema with extractedParams + response`)
        console.log(`[DEBUG] Model: gpt-4.1-mini (NO reasoning tokens, max speed)`)
        console.log(`[DEBUG] Available data: ${placesForLLM.length + eventsForLLM.length} options (${placesForLLM.length}p+${eventsForLLM.length}e)`)
        
        const result = streamObject({
          model: openai('gpt-4.1-mini'), // FIX: No reasoning tokens = 6+ secondi risparmiati
          schema: unifiedSuggestionSchema,
          system: unifiedPrompt,
          prompt: unifiedUserPrompt,
          onFinish: async ({ object, error, response, usage }) => {
            console.log(`[Chat Stream] ✅ UNIFIED gpt-4.1-mini generation completed`)
            console.log(`[DEBUG] Response metadata:`, response)
            console.log(`[DEBUG] Token usage:`, usage)
            console.log(`[DEBUG] Raw unified object:`, object)
            console.log(`[DEBUG] Object type:`, typeof object)
            console.log(`[DEBUG] Object is null:`, object === null)
            console.log(`[DEBUG] Object is undefined:`, object === undefined)
            console.log(`[DEBUG] Full unified object:`, JSON.stringify(object, null, 2))
            console.log(`[DEBUG] LLM generation error:`, error)
            
            if (error) {
              console.error(`[DEBUG] Unified LLM had error:`, error)
              console.error(`[DEBUG] Error details:`, typeof error === 'object' && error && 'stack' in error ? error.stack : 'No stack trace')
            }
            
            if (!object) {
              console.error(`[DEBUG] Unified LLM object is null/undefined! Schema validation failure.`)
              console.error(`[DEBUG] Error details:`, error)
              // Provide fallback response
              object = {
                extractedParams: {
                  companionship: ['alone'],
                  mood: ['relaxed'],
                  budget: '€€',
                  time: 'evening',
                  keywords: []
                },
                conversationalResponse: "Mi dispiace, c'è stato un problema tecnico. Prova a riformulare la richiesta! 🔧",
                suggestions: [],
                searchMetadata: {
                  totalCandidates: placesForLLM.length + eventsForLLM.length,
                  totalPlaces: placesForLLM.length,
                  totalEvents: eventsForLLM.length,
                  processingTime: Date.now() - startTime,
                  cacheUsed: cacheUsed,
                  contextUsed: !!conversationContext,
                  conversationLength: conversationHistory.length,
                }
              }
            } else if (!object?.suggestions || object.suggestions.length === 0) {
              console.warn(`[DEBUG] Unified LLM generated NO suggestions despite having data.`)
              console.warn(`[DEBUG] Available places:`, placesForLLM.length)
              console.warn(`[DEBUG] Available events:`, eventsForLLM.length)
              console.warn(`[DEBUG] Object keys:`, Object.keys(object || {}))
              console.warn(`[DEBUG] Suggestions value:`, object?.suggestions)
              console.warn(`[DEBUG] Extracted params:`, object?.extractedParams)
            }
            
            console.log(`[Chat Stream] Final suggestions count: ${object?.suggestions?.length || 0}`)

            // Add metadata
            const finalResponse = {
              ...object,
              searchMetadata: {
                ...object?.searchMetadata,
                contextUsed: !!conversationContext,
                conversationLength: conversationHistory.length,
              }
            }

            // Send final complete event
            const completeEvent = `data: ${JSON.stringify({
              type: 'complete',
              ...finalResponse
            })}\n\n`
            console.log(`[DEBUG] Sending complete event with ${finalResponse?.suggestions?.length || 0} suggestions`)
            controller.enqueue(encoder.encode(completeEvent))

            // Cache the result if not already cached and validation succeeded (fire and forget)
            if (!cacheUsed && object?.suggestions && !error) {
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

            controller.close()
          },
        })

        // Stream the response chunks
        for await (const partialObject of result.partialObjectStream) {
          if (partialObject.conversationalResponse) {
            const streamEvent = `data: ${JSON.stringify({
              type: 'stream',
              content: partialObject.conversationalResponse
            })}\n\n`
            controller.enqueue(encoder.encode(streamEvent))
          }
        }

      } catch (error) {
        if (error instanceof z.ZodError) {
          const errorEvent = `data: ${JSON.stringify({
            type: 'error',
            error: 'Invalid input',
            details: error.issues,
          })}\n\n`
          controller.enqueue(encoder.encode(errorEvent))
        } else {
          console.error('Error in chat suggest stream API:', error)
          const errorEvent = `data: ${JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : 'Internal server error',
          })}\n\n`
          controller.enqueue(encoder.encode(errorEvent))
        }
        controller.close()
      }
    },
  })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  } catch (error) {
    console.error('Error setting up stream:', error)
    return Response.json(
      { error: error instanceof Error ? error.message : 'Internal server error' }, 
      { status: 500 }
    )
  }
}