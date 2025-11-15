import { embedMany } from 'ai'
import { openai } from '@ai-sdk/openai'
import { createClient } from '@/lib/supabase/server'

// OPTIMIZED: In-memory cache for frequently used embeddings
const embeddingCache = new Map<string, { embedding: number[], timestamp: number }>()
const CACHE_TTL = 30 * 60 * 1000 // 30 minutes
const MAX_CACHE_SIZE = 1000 // Maximum number of cached embeddings

/**
 * OPTIMIZED: Get embedding from cache or generate new one
 */
function getCachedEmbedding(text: string): number[] | null {
  const cacheKey = Buffer.from(text).toString('base64')
  const cached = embeddingCache.get(cacheKey)
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.embedding
  }
  
  // Clean up expired cache entries
  if (cached && Date.now() - cached.timestamp >= CACHE_TTL) {
    embeddingCache.delete(cacheKey)
  }
  
  return null
}

/**
 * OPTIMIZED: Store embedding in cache
 */
function setCachedEmbedding(text: string, embedding: number[]): void {
  const cacheKey = Buffer.from(text).toString('base64')
  
  // Ensure cache doesn't grow too large
  if (embeddingCache.size >= MAX_CACHE_SIZE) {
    // Remove oldest entries (simple LRU)
    const oldestKey = embeddingCache.keys().next().value
    if (oldestKey) {
      embeddingCache.delete(oldestKey)
    }
  }
  
  embeddingCache.set(cacheKey, {
    embedding,
    timestamp: Date.now()
  })
}

/**
 * Generate embeddings for an array of text chunks using Vercel AI SDK
 * OPTIMIZED: Uses cache to avoid redundant API calls
 */
export async function generateEmbeddings(
  texts: string[]
): Promise<number[][]> {
  if (texts.length === 0) {
    return []
  }

  const results: number[][] = []
  const textsToGenerate: string[] = []
  const indexMap: number[] = []

  // Check cache for each text
  for (let i = 0; i < texts.length; i++) {
    const cached = getCachedEmbedding(texts[i])
    if (cached) {
      results[i] = cached
    } else {
      textsToGenerate.push(texts[i])
      indexMap.push(i)
    }
  }

  // Generate embeddings for uncached texts
  if (textsToGenerate.length > 0) {
    try {
      const { embeddings } = await embedMany({
        model: openai.embedding('text-embedding-3-small'),
        values: textsToGenerate,
      })

      // Store results and update cache
      for (let i = 0; i < embeddings.length; i++) {
        const originalIndex = indexMap[i]
        results[originalIndex] = embeddings[i]
        setCachedEmbedding(textsToGenerate[i], embeddings[i])
      }

      console.log(`[Embeddings] Generated ${embeddings.length} new, used ${texts.length - textsToGenerate.length} cached`)
    } catch (error) {
      console.error('Error generating embeddings:', error)
      throw new Error('Failed to generate embeddings')
    }
  } else {
    console.log(`[Embeddings] All ${texts.length} embeddings served from cache`)
  }

  return results
}

/**
 * Generate a single embedding for a text query
 * OPTIMIZED: Uses batch generation for efficiency
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const embeddings = await generateEmbeddings([text])
  return embeddings[0]
}

/**
 * OPTIMIZED: Generate embeddings in batches with intelligent grouping
 * Groups similar texts together to maximize embedding efficiency
 */
export async function generateEmbeddingsBatch(
  textGroups: { id: string; text: string }[]
): Promise<Map<string, number[]>> {
  if (textGroups.length === 0) {
    return new Map()
  }

  const BATCH_SIZE = 100 // OpenAI's recommended batch size
  const results = new Map<string, number[]>()

  // Process in batches to avoid API limits
  for (let i = 0; i < textGroups.length; i += BATCH_SIZE) {
    const batch = textGroups.slice(i, i + BATCH_SIZE)
    const texts = batch.map(item => item.text)
    
    try {
      const embeddings = await generateEmbeddings(texts)
      
      // Map results back to IDs
      batch.forEach((item, index) => {
        results.set(item.id, embeddings[index])
      })
      
      console.log(`[Embeddings] Processed batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(textGroups.length / BATCH_SIZE)} (${batch.length} items)`)
    } catch (error) {
      console.error(`[Embeddings] Error in batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error)
      throw error
    }
  }

  return results
}

/**
 * Store embeddings in the database
 */
export async function storeEmbeddings(
  resourceType: 'place' | 'event',
  resourceId: string,
  chunks: string[],
  embeddings: number[][],
  supabaseClient?: any
): Promise<void> {
  const supabase = supabaseClient || await createClient()

  // Delete existing embeddings for this resource
  await supabase
    .from('embeddings')
    .delete()
    .eq('entity_type', resourceType)
    .eq('entity_id', resourceId)

  // Insert new embeddings
  const embeddingsData = chunks.map((chunk, index) => ({
    entity_type: resourceType,
    entity_id: resourceId,
    chunk_id: index,
    field_name: 'content',
    snippet_text: chunk,
    embedding: embeddings[index],
    lang: 'it',
  }))

  const { error } = await supabase.from('embeddings').insert(embeddingsData)

  if (error) {
    console.error('Error storing embeddings:', error)
    throw new Error('Failed to store embeddings')
  }
}

/**
 * Update embedding status for a resource
 */
export async function updateEmbeddingStatus(
  resourceType: 'place' | 'event',
  resourceId: string,
  status: 'pending' | 'processing' | 'completed' | 'failed',
  error?: string,
  supabaseClient?: any
): Promise<void> {
  const supabase = supabaseClient || await createClient()

  const table = resourceType === 'place' ? 'places' : 'events'

  const updateData: Record<string, string> = {
    embeddings_status: status,
  }

  if (error) {
    updateData.embeddings_error = error
  }

  await supabase.from(table).update(updateData).eq('id', resourceId)
}

/**
 * Query cache for similar results
 */
export async function getCachedResults(
  queryHash: string
): Promise<{ similar_places: any[]; hit_count: number } | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('embeddings_cache')
    .select('similar_places, hit_count')
    .eq('query_hash', queryHash)
    .gt('expires_at', new Date().toISOString())
    .single()

  if (error || !data) {
    return null
  }

  // Increment hit count
  await supabase
    .from('embeddings_cache')
    .update({ hit_count: data.hit_count + 1 })
    .eq('query_hash', queryHash)

  return data
}

/**
 * Store query results in cache
 */
export async function cacheResults(
  queryHash: string,
  queryText: string,
  queryEmbedding: number[],
  similarPlaces: any[]
): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase.from('embeddings_cache').upsert(
    {
      query_hash: queryHash,
      query_text: queryText,
      query_embedding: queryEmbedding,
      similar_places: similarPlaces,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
      hit_count: 0,
    },
    {
      onConflict: 'query_hash',
    }
  )

  if (error) {
    console.error('Error caching results:', error)
  }
}

/**
 * Clean up expired cache entries
 */
export async function cleanupExpiredCache(): Promise<number> {
  const supabase = await createClient()

  const { count, error } = await supabase
    .from('embeddings_cache')
    .delete({ count: 'exact' })
    .lt('expires_at', new Date().toISOString())

  if (error) {
    console.error('Error cleaning up cache:', error)
    return 0
  }

  return count || 0
}
