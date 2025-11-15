import { NextRequest } from 'next/server'
import { z } from 'zod'
import { generateObject, streamObject } from 'ai'
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
        id: z.string().uuid(),
        type: z.enum(['place', 'event']),
        reason: z.string().max(300).describe('Spiega perché questo posto/evento è perfetto per la loro richiesta'),
        matchScore: z.number().min(0).max(2),
        confidence: z.enum(['high', 'medium', 'low']),
      })
    )
    .min(1)
    .max(3),
  searchMetadata: z.object({
    totalCandidates: z.number(),
    totalPlaces: z.number(),
    totalEvents: z.number(),
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
    
    // Get current user for conversation history
    const { data: { user } } = await supabase.auth.getUser()

    // ENHANCED: Retrieve and manage conversation history if conversation_id provided
    let conversationHistory: Array<{ content: string; is_user: boolean; timestamp: string }> = []
    let conversationContext = ""
    let contextSummary = ""
    let isTopicChange = false
    
    if (validatedInput.conversation_id && user) {
      console.log(`[Chat] Retrieving history for conversation: ${validatedInput.conversation_id}`)
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
      
      console.log(`[Chat] Retrieved ${fullHistory.length} total messages, using ${conversationHistory.length} for context`)
      if (isTopicChange) {
        console.log(`[Chat] 🔄 Topic change detected, using shorter context window`)
      }
    }

    // Load extraction system prompt
    const extractionPromptPath = path.join(
      process.cwd(),
      'src/lib/ai/prompts/system-chat-extraction.txt'
    )
    const extractionPrompt = fs.readFileSync(extractionPromptPath, 'utf-8')

    // STEP 1: Extract structured parameters from natural language with conversation context
    console.log(`[Chat] Step 1 - Extracting parameters...`)
    
    // ENHANCED: Include conversation context in parameter extraction
    const contextualPrompt = conversationContext + 
      `NUOVO MESSAGGIO UTENTE: "${validatedInput.message}"
      
Analizza il nuovo messaggio dell'utente tenendo conto della cronologia della conversazione sopra. 
Se il messaggio fa riferimento a richieste precedenti (es. "qualcosa di più economico", "di diverso", "simile"), 
usa il contesto per comprendere meglio l'intenzione.`

    const { object: extractedParams } = await generateObject({
      model: openai('gpt-4.1-mini'), // FIX: No reasoning tokens per velocità
      schema: extractedParamsSchema,
      system: extractionPrompt,
      prompt: conversationContext ? contextualPrompt : validatedInput.message,
    })

    console.log(`[Chat] ✅ Extracted params:`, extractedParams)

    // ENHANCED: Extract user preferences from conversation history
    const userPreferences = extractUserPreferences(conversationHistory)
    if (Object.keys(userPreferences).length > 0) {
      console.log(`[Chat] 🧠 Extracted preferences:`, userPreferences)
    }

    // Convert extracted params to SuggestionContext
    let context: SuggestionContext = {
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

    // ENHANCED: Apply user preferences to fill in missing parameters
    context = enhanceContextWithPreferences(context, userPreferences)

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
      // Step A: Geo filter (parallel for places and events)
      const [placeCandidateIds, eventCandidateIds] = await Promise.all([
        geoFilterPlaces(context.location.lat, context.location.lon, context.radius_km || 5),
        geoFilterEvents(context.location.lat, context.location.lon, context.radius_km || 5),
      ])
      console.log(`[Chat] Step A - Geo Filter: Found ${placeCandidateIds.length} places, ${eventCandidateIds.length} events`)

      totalCandidates = placeCandidateIds.length + eventCandidateIds.length

      if (placeCandidateIds.length === 0 && eventCandidateIds.length === 0) {
        console.log(`[Chat] ⚠️  No candidates found in geo filter`)
        return new Response(
          JSON.stringify({
            conversationalResponse: 'Mi dispiace, non ho trovato nessun locale o evento nella tua zona. Prova ad ampliare il raggio di ricerca! 📍',
            suggestions: [],
            searchMetadata: {
              totalCandidates: 0,
              totalPlaces: 0,
              totalEvents: 0,
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

      // Step C: Vector search (parallel for places and events)
      const [placeVectorResults, eventVectorResults] = await Promise.all([
        placeCandidateIds.length > 0 ? vectorSearch(queryEmbedding, placeCandidateIds, 8) : Promise.resolve([]),
        eventCandidateIds.length > 0 ? vectorSearchEvents(queryEmbedding, eventCandidateIds, 8) : Promise.resolve([]),
      ])
      console.log(`[Chat] Step C - Vector Search: Found ${placeVectorResults.length} places, ${eventVectorResults.length} events`)

      if (placeVectorResults.length === 0 && eventVectorResults.length === 0) {
        console.log(`[Chat] ⚠️  No results from vector search`)
        return new Response(
          JSON.stringify({
            conversationalResponse: 'Hmm, non trovo nulla che corrisponda esattamente. Prova a descrivere cosa cerchi in modo diverso! 🤔',
            suggestions: [],
            searchMetadata: {
              totalCandidates: totalCandidates,
              totalPlaces: placeCandidateIds.length,
              totalEvents: eventCandidateIds.length,
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

      // Step D: Re-ranking (parallel for places and events)
      const [rerankedPlaces, rerankedEvents] = await Promise.all([
        placeVectorResults.length > 0
          ? reRank(placeVectorResults.map((r) => r.placeId), context)
          : Promise.resolve([]),
        eventVectorResults.length > 0
          ? reRankEvents(eventVectorResults.map((r) => r.eventId), context)
          : Promise.resolve([]),
      ])
      console.log(`[Chat] Step D - Re-ranking: ${rerankedPlaces.length} places, ${rerankedEvents.length} events`)

      // Combine places and events (aim for ~4 places + ~2 events for LLM)
      const topPlaces = rerankedPlaces.slice(0, 4)
      const topEvents = rerankedEvents.slice(0, 2)

      topN = [...topPlaces, ...topEvents]
      console.log(`[Chat] Top results for LLM:`)
      console.log(`  Places:`)
      topPlaces.forEach((item, idx) => {
        console.log(`    ${idx + 1}. ${item.metadata.name} (score: ${item.score.toFixed(2)}, distance: ${item.metadata.distance_km.toFixed(1)}km)`)
      })
      console.log(`  Events:`)
      topEvents.forEach((item, idx) => {
        console.log(`    ${idx + 1}. ${item.metadata.title} (score: ${item.score.toFixed(2)}, distance: ${item.metadata.distance_km.toFixed(1)}km)`)
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

    // Build user prompt for LLM with both places and events
    const placesForLLM = topN.filter(item => 'name' in item.metadata);
    const eventsForLLM = topN.filter(item => 'title' in item.metadata);
    
    console.log(`[Chat] 🎯 Sending to LLM: ${placesForLLM.length} places, ${eventsForLLM.length} events`);
    
    const placesSection = placesForLLM.length > 0 ? `
LOCALI DISPONIBILI (ordinati per rilevanza):
${placesForLLM
  .map(
    (item, idx) => `
${idx + 1}. ${item.metadata.name} (ID: ${item.placeId}, TIPO: place)
   - Tipo locale: ${item.metadata.place_type}
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
  .join('\n')}` : '';

    const eventsSection = eventsForLLM.length > 0 ? `
EVENTI DISPONIBILI (ordinati per rilevanza):
${eventsForLLM
  .map(
    (item, idx) => `
${idx + 1}. ${item.metadata.title} (ID: ${item.eventId}, TIPO: event)
   - Tipo evento: ${item.metadata.event_type}
   - Descrizione: ${item.metadata.description || 'N/A'}
   - Data/ora: ${new Date(item.metadata.start_datetime).toLocaleString('it-IT')}
   - Locale: ${item.metadata.place.name}
   - Indirizzo: ${item.metadata.place.address}, ${item.metadata.place.city}
   - Distanza: ${item.metadata.distance_km?.toFixed(1) || 'N/A'} km
   - Generi musicali: ${item.metadata.genre?.join(', ') || 'N/A'}
   - Lineup: ${item.metadata.lineup?.join(', ') || 'N/A'}
   - Prezzo: ${item.metadata.ticket_price_min ? `€${item.metadata.ticket_price_min}${item.metadata.ticket_price_max ? ` - €${item.metadata.ticket_price_max}` : ''}` : 'N/A'}
   - Match Score: ${item.score.toFixed(2)}
`
  )
  .join('\n')}` : '';

    // ENHANCED: Include conversation context in final response generation
    const contextSection = conversationContext ? `${conversationContext}` : ''
    
    const userPrompt = `${contextSection}
RICHIESTA CORRENTE UTENTE:
"${validatedInput.message}"

PARAMETRI ESTRATTI:
- Compagnia: ${extractedParams.companionship.join(', ') || 'Non specificato'}
- Mood: ${extractedParams.mood.join(', ') || 'Non specificato'}
- Budget: ${extractedParams.budget}
- Quando: ${extractedParams.time}
- Keyword: ${extractedParams.keywords.join(', ') || 'Nessuna'}
${placesSection}
${eventsSection}

${conversationContext ? 
  'IMPORTANTE: Considera la cronologia della conversazione sopra. Se l\'utente fa riferimenti ("come l\'altro giorno", "qualcosa di diverso", "più economico") usa il contesto per dare una risposta pertinente e naturale.' : 
  'Questa è una nuova conversazione.'}

Rispondi in modo amichevole alla richiesta dell'utente e seleziona da 1 a 3 opzioni dalla lista sopra (locali e/o eventi) che meglio corrispondono.
Puoi scegliere qualsiasi combinazione (es. 2 locali + 1 evento, 3 locali, 1 locale + 2 eventi, ecc.).
Per ogni scelta, specifica l'ID esatto e il TIPO (place o event) come indicato nella lista.
Spiega brevemente perché ogni opzione è perfetta per loro, tenendo conto del contesto conversazionale se presente.
`

    // Stream LLM Generation with OpenAI
    const result = streamObject({
      model: openai('gpt-4.1-mini'), // FIX: No reasoning tokens per velocità
      schema: chatSuggestionSchema,
      system: responsePrompt,
      prompt: userPrompt,
      onFinish: async ({ object }) => {
        console.log(`[Chat] ✅ LLM generation completed`)
        console.log(`[Chat] Generated ${object?.suggestions?.length || 0} suggestions`)

        // Log LLM response details
        if (object?.suggestions) {
          console.log(`[Chat] 📋 LLM Suggestions:`)
          
          // Count types
          const placeCount = object.suggestions.filter((s: any) => s.type === 'place').length;
          const eventCount = object.suggestions.filter((s: any) => s.type === 'event').length;
          console.log(`[Chat] 🎯 LLM chose: ${placeCount} places, ${eventCount} events`);
          
          object.suggestions.forEach((s: any, i: number) => {
            console.log(`  ${i + 1}. [${s.type.toUpperCase()}] ID: ${s.id}`)
            console.log(`     Reason: "${s.reason.substring(0, 100)}..."`)
            console.log(`     Match Score: ${s.matchScore} | Confidence: ${s.confidence}`)
          })
          
          // Log if LLM ignored events
          if (eventsForLLM.length > 0 && eventCount === 0) {
            console.log(`[Chat] ⚠️  LLM ignored ${eventsForLLM.length} available events`);
            console.log(`[Chat] Available events were:`, eventsForLLM.map(e => e.metadata.title));
          }
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
