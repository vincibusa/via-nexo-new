import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

// Input validation schema
const quickSuggestionsRequestSchema = z.object({
  location: z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  }),
  radius_km: z.number().min(0.5).max(50).optional().default(10),
  limit: z.number().min(1).max(20).optional().default(6),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()

  try {
    // Parse and validate input
    const body = await request.json()
    const { location, radius_km, limit } = quickSuggestionsRequestSchema.parse(body)

    // Query for featured events and popular places near the user
    // Using PostGIS for geospatial queries
    const { data: places, error } = await supabase.rpc('get_quick_suggestions', {
      user_lat: location.lat,
      user_lon: location.lon,
      search_radius_km: radius_km,
      result_limit: limit,
    })

    if (error) {
      console.error('Error fetching quick suggestions:', error)

      // Fallback: Query places directly without RPC
      const { data: fallbackPlaces, error: fallbackError } = await supabase
        .from('places')
        .select(`
          id,
          name,
          place_type,
          description,
          address,
          city,
          lat,
          lon,
          price_range,
          ambience_tags,
          music_genre,
          verification_status,
          is_published,
          is_listed,
          cover_image_url,
          image_urls,
          suggestions_count,
          created_at
        `)
        .eq('verification_status', 'approved')
        .eq('is_published', true)
        .eq('is_listed', true)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (fallbackError) {
        throw fallbackError
      }

      // Calculate distances manually and build photos
      const placesWithDistance = (fallbackPlaces || []).map((place) => {
        const distance = calculateDistance(
          location.lat,
          location.lon,
          place.lat,
          place.lon
        )

        // Build photos array from cover_image_url and image_urls
        const photos = []
        if (place.cover_image_url) {
          photos.push({ url: place.cover_image_url, is_primary: true })
        } else if (place.image_urls && place.image_urls.length > 0) {
          photos.push(...place.image_urls.map((url: string, idx: number) => ({
            url,
            is_primary: idx === 0
          })))
        }

        return {
          ...place,
          distance_km: distance,
          photos,
          badge: getBadge(place),
        }
      })

      // Filter by radius and sort by distance
      const filtered = placesWithDistance
        .filter((p) => p.distance_km <= radius_km)
        .sort((a, b) => a.distance_km - b.distance_km)

      return new Response(
        JSON.stringify({
          suggestions: filtered,
          metadata: {
            total: filtered.length,
            radius_km,
          },
        }),
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    }

    // Add badges to places
    const suggestionsWithBadges = (places || []).map((place: any) => ({
      ...place,
      badge: getBadge(place),
    }))

    return new Response(
      JSON.stringify({
        suggestions: suggestionsWithBadges,
        metadata: {
          total: suggestionsWithBadges.length,
          radius_km,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    )
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

    console.error('Error in quick suggestions API:', error)
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

/**
 * Determine badge for a place based on its attributes
 */
function getBadge(place: any): '🔥 Popolare' | '⭐ In evidenza' | '🆕 Nuovo' | null {
  // Check if place is new (created in last 30 days)
  if (place.created_at) {
    const createdDate = new Date(place.created_at)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    if (createdDate > thirtyDaysAgo) {
      return '🆕 Nuovo'
    }
  }

  // Check if place is popular (has many suggestions or high rating)
  if (place.suggestions_count && place.suggestions_count > 50) {
    return '🔥 Popolare'
  }

  // Featured places (manually curated or high quality)
  if (place.verification_status === 'approved' && place.photos?.length > 0) {
    return '⭐ In evidenza'
  }

  return null
}

/**
 * Calculate distance between two coordinates using Haversine formula
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371 // Earth's radius in km
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  const distance = R * c

  return Math.round(distance * 10) / 10 // Round to 1 decimal
}

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180
}
