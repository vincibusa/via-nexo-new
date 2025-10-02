/**
 * Text chunking utilities for embeddings
 */

interface ChunkOptions {
  maxLength?: number
  overlap?: number
}

/**
 * Split text into overlapping chunks for better semantic coverage
 * @param text - Text to chunk
 * @param maxLength - Maximum length of each chunk (default: 500)
 * @param overlap - Number of characters to overlap between chunks (default: 50)
 */
export function chunkText(
  text: string,
  { maxLength = 500, overlap = 50 }: ChunkOptions = {}
): string[] {
  if (!text || text.trim().length === 0) {
    return []
  }

  // Normalize text
  const normalized = text.trim().replace(/\s+/g, ' ')

  if (normalized.length <= maxLength) {
    return [normalized]
  }

  const chunks: string[] = []
  let start = 0

  while (start < normalized.length) {
    let end = start + maxLength

    // If this is not the last chunk, try to break at a word boundary
    if (end < normalized.length) {
      const lastSpace = normalized.lastIndexOf(' ', end)
      if (lastSpace > start) {
        end = lastSpace
      }
    }

    chunks.push(normalized.slice(start, end).trim())

    // Move start position, accounting for overlap
    start = end - overlap
  }

  return chunks.filter((chunk) => chunk.length > 0)
}

/**
 * Extract embeddable text fields from a place object
 */
export function extractPlaceChunks(place: {
  name: string
  description?: string | null
  address?: string | null
  city?: string | null
  place_type?: string | null
  ambience_tags?: string[] | null
  music_genre?: string[] | null
  price_range?: string | null
}): string[] {
  const chunks: string[] = []

  // Primary chunk: name + place_type + city
  const primary = [
    place.name,
    place.place_type,
    place.city,
  ]
    .filter(Boolean)
    .join(' - ')

  if (primary) {
    chunks.push(primary)
  }

  // Description chunks (split if long)
  if (place.description) {
    const descChunks = chunkText(place.description, {
      maxLength: 500,
      overlap: 50,
    })
    chunks.push(...descChunks)
  }

  // Address chunk
  if (place.address) {
    chunks.push(`${place.address}, ${place.city || ''}`.trim())
  }

  // Ambience tags chunk
  if (place.ambience_tags && place.ambience_tags.length > 0) {
    chunks.push(`Ambience: ${place.ambience_tags.join(', ')}`)
  }

  // Music genre chunk
  if (place.music_genre && place.music_genre.length > 0) {
    chunks.push(`Music: ${place.music_genre.join(', ')}`)
  }

  // Price range chunk
  if (place.price_range) {
    chunks.push(`Price range: ${place.price_range}`)
  }

  return chunks.filter((chunk) => chunk.trim().length > 0)
}

/**
 * Extract embeddable text fields from an event object
 */
export function extractEventChunks(event: {
  title: string
  description?: string | null
  event_type?: string | null
  place_name?: string | null
  location?: string | null
  performers?: string[] | null
}): string[] {
  const chunks: string[] = []

  // Primary chunk: title + event type + place
  const primary = [event.title, event.event_type, event.place_name]
    .filter(Boolean)
    .join(' - ')

  if (primary) {
    chunks.push(primary)
  }

  // Description chunks (split if long)
  if (event.description) {
    const descChunks = chunkText(event.description, {
      maxLength: 500,
      overlap: 50,
    })
    chunks.push(...descChunks)
  }

  // Location chunk
  if (event.location) {
    chunks.push(`Location: ${event.location}`)
  }

  // Performers chunk
  if (event.performers && event.performers.length > 0) {
    chunks.push(`Performers: ${event.performers.join(', ')}`)
  }

  return chunks.filter((chunk) => chunk.trim().length > 0)
}

/**
 * Create a hash from text for cache keys
 */
export function hashText(text: string): string {
  const normalized = text.toLowerCase().trim().replace(/\s+/g, ' ')

  // Simple hash function for cache keys
  let hash = 0
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32-bit integer
  }

  return Math.abs(hash).toString(36)
}
