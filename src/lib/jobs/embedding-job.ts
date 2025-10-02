import { createClient } from '@/lib/supabase/server'
import { extractPlaceChunks, extractEventChunks } from '@/lib/ai/chunking'
import {
  generateEmbeddings,
  storeEmbeddings,
  updateEmbeddingStatus,
} from '@/lib/ai/embedding'

/**
 * Embed a place and store its embeddings
 */
export async function embedPlace(placeId: string, supabaseClient?: any): Promise<void> {
  const supabase = supabaseClient || await createClient()

  try {
    // Update status to processing
    await updateEmbeddingStatus('place', placeId, 'processing', undefined, supabase)

    // Fetch place data
    const { data: place, error: fetchError } = await supabase
      .from('places')
      .select(
        `
        id,
        name,
        description,
        address,
        city,
        place_type,
        ambience_tags,
        music_genre,
        price_range,
        is_published,
        is_listed
      `
      )
      .eq('id', placeId)
      .single()

    if (fetchError || !place) {
      throw new Error('Place not found')
    }

    // Skip if not published or not listed
    if (!place.is_published || !place.is_listed) {
      console.log(`Skipping place ${placeId} - not published or not listed`)
      await updateEmbeddingStatus('place', placeId, 'pending')
      return
    }

    // Extract text chunks
    const chunks = extractPlaceChunks(place)

    if (chunks.length === 0) {
      throw new Error('No embeddable content found')
    }

    // Generate embeddings
    const embeddings = await generateEmbeddings(chunks)

    // Store embeddings
    await storeEmbeddings('place', placeId, chunks, embeddings)

    // Update status to completed
    await updateEmbeddingStatus('place', placeId, 'completed')

    console.log(
      `Successfully embedded place ${placeId} with ${chunks.length} chunks`
    )
  } catch (error) {
    console.error(`Error embedding place ${placeId}:`, error)

    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'

    await updateEmbeddingStatus('place', placeId, 'failed', errorMessage)

    throw error
  }
}

/**
 * Embed an event and store its embeddings
 */
export async function embedEvent(eventId: string, supabaseClient?: any): Promise<void> {
  const supabase = supabaseClient || await createClient()

  try {
    // Update status to processing
    await updateEmbeddingStatus('event', eventId, 'processing', undefined, supabase)

    // Fetch event data
    console.log(`[embedEvent] Fetching event ${eventId}`)
    const { data: event, error: fetchError } = await supabase
      .from('events')
      .select('id, title, description, event_type, genre, lineup, is_published, place_id')
      .eq('id', eventId)
      .single()

    if (fetchError) {
      console.error(`[embedEvent] Error fetching event:`, fetchError)
      throw new Error(`Event not found: ${fetchError.message}`)
    }

    if (!event) {
      console.error(`[embedEvent] Event ${eventId} returned null`)
      throw new Error('Event not found')
    }

    console.log(`[embedEvent] Event found: ${event.title}`)

    // Skip if not published
    if (!event.is_published) {
      console.log(`Skipping event ${eventId} - not published`)
      await updateEmbeddingStatus('event', eventId, 'pending', undefined, supabase)
      return
    }

    // Fetch place name if event has a place_id
    let placeName: string | null = null
    if (event.place_id) {
      const { data: place } = await supabase
        .from('places')
        .select('name')
        .eq('id', event.place_id)
        .single()
      placeName = place?.name || null
    }

    // Extract text chunks
    const eventData = {
      ...event,
      place_name: placeName,
    }
    const chunks = extractEventChunks(eventData)

    if (chunks.length === 0) {
      throw new Error('No embeddable content found')
    }

    // Generate embeddings
    const embeddings = await generateEmbeddings(chunks)

    // Store embeddings
    await storeEmbeddings('event', eventId, chunks, embeddings, supabase)

    // Update status to completed
    await updateEmbeddingStatus('event', eventId, 'completed', undefined, supabase)

    console.log(
      `Successfully embedded event ${eventId} with ${chunks.length} chunks`
    )
  } catch (error) {
    console.error(`Error embedding event ${eventId}:`, error)

    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'

    await updateEmbeddingStatus('event', eventId, 'failed', errorMessage, supabase)

    throw error
  }
}

/**
 * Batch embed multiple places
 */
export async function batchEmbedPlaces(
  placeIds: string[],
  delayMs: number = 500
): Promise<{ success: number; failed: number }> {
  const results = { success: 0, failed: 0 }

  for (const placeId of placeIds) {
    try {
      await embedPlace(placeId)
      results.success++
    } catch (error) {
      results.failed++
    }

    // Rate limiting delay
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  return results
}

/**
 * Batch embed multiple events
 */
export async function batchEmbedEvents(
  eventIds: string[],
  delayMs: number = 500
): Promise<{ success: number; failed: number }> {
  const results = { success: 0, failed: 0 }

  for (const eventId of eventIds) {
    try {
      await embedEvent(eventId)
      results.success++
    } catch (error) {
      results.failed++
    }

    // Rate limiting delay
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  return results
}

/**
 * Get places that need embedding
 */
export async function getPlacesPendingEmbedding(
  limit: number = 100
): Promise<string[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('places')
    .select('id')
    .eq('is_published', true)
    .eq('is_listed', true)
    .eq('embeddings_status', 'pending')
    .limit(limit)

  if (error || !data) {
    return []
  }

  return data.map((p) => p.id)
}

/**
 * Get events that need embedding
 */
export async function getEventsPendingEmbedding(
  limit: number = 100
): Promise<string[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('events')
    .select('id')
    .eq('is_published', true)
    .eq('embeddings_status', 'pending')
    .limit(limit)

  if (error || !data) {
    return []
  }

  return data.map((e) => e.id)
}
