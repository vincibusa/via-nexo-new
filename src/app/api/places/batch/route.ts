import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

// Input validation schema
const batchRequestSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50), // Max 50 places per request
})

export async function POST(request: NextRequest) {
  try {
    // Parse and validate input
    const body = await request.json()
    const { ids } = batchRequestSchema.parse(body)

    // Create Supabase client
    const supabase = await createClient()

    // Fetch places by IDs
    const { data: places, error } = await supabase
      .from('places')
      .select(
        `
        id,
        name,
        place_type,
        description,
        cover_image_url,
        image_urls,
        address,
        city,
        postal_code,
        lat,
        lon,
        phone,
        website,
        instagram_handle,
        facebook_url,
        price_range,
        ambience_tags,
        music_genre,
        capacity,
        opening_hours,
        verification_status,
        is_published,
        is_listed
      `
      )
      .in('id', ids)
      .eq('is_published', true)
      .eq('is_listed', true)

    if (error) {
      console.error('Error fetching places:', error)
      return NextResponse.json(
        {
          error: 'Failed to fetch places',
        },
        { status: 500 }
      )
    }

    // Map database fields to mobile API format
    const mappedPlaces = (places || []).map((place) => ({
      id: place.id,
      name: place.name,
      category: place.place_type,
      description: place.description,
      cover_image: place.cover_image_url,
      gallery_images: place.image_urls,
      address: place.address,
      city: place.city,
      postal_code: place.postal_code,
      latitude: place.lat,
      longitude: place.lon,
      phone: place.phone,
      website: place.website,
      instagram: place.instagram_handle,
      facebook: place.facebook_url,
      price_range: place.price_range as '€' | '€€' | '€€€' | undefined,
      ambience_tags: place.ambience_tags,
      music_genre: place.music_genre,
      capacity: place.capacity,
      opening_hours: place.opening_hours,
      verified: place.verification_status === 'approved',
      is_published: place.is_published,
      is_listed: place.is_listed,
    }))

    return NextResponse.json({
      places: mappedPlaces,
      count: mappedPlaces.length,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Invalid input',
          details: error.issues,
        },
        { status: 400 }
      )
    }

    console.error('Error in batch places API:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
}
