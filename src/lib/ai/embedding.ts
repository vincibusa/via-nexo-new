import { embedMany } from 'ai'
import { openai } from '@ai-sdk/openai'
import { createClient } from '@/lib/supabase/server'

/**
 * Generate embeddings for an array of text chunks using Vercel AI SDK
 */
export async function generateEmbeddings(
  texts: string[]
): Promise<number[][]> {
  if (texts.length === 0) {
    return []
  }

  try {
    const { embeddings } = await embedMany({
      model: openai.embedding('text-embedding-3-small'),
      values: texts,
    })

    return embeddings
  } catch (error) {
    console.error('Error generating embeddings:', error)
    throw new Error('Failed to generate embeddings')
  }
}

/**
 * Generate a single embedding for a text query
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const embeddings = await generateEmbeddings([text])
  return embeddings[0]
}

/**
 * Store embeddings in the database
 */
export async function storeEmbeddings(
  resourceType: 'place' | 'event',
  resourceId: string,
  chunks: string[],
  embeddings: number[][]
): Promise<void> {
  const supabase = await createClient()

  // Delete existing embeddings for this resource
  await supabase
    .from('embeddings')
    .delete()
    .eq('resource_type', resourceType)
    .eq('resource_id', resourceId)

  // Insert new embeddings
  const embeddingsData = chunks.map((chunk, index) => ({
    resource_type: resourceType,
    resource_id: resourceId,
    chunk_text: chunk,
    chunk_index: index,
    embedding: embeddings[index],
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
  error?: string
): Promise<void> {
  const supabase = await createClient()

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
