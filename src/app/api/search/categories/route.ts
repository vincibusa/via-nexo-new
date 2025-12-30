import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface Category {
  id: string;
  name: string;
  icon: string;
  type: 'place' | 'event';
}

export async function GET() {
  try {
    // Categorie basate sui place_type e event_type esistenti nel database
    const categories: Category[] = [
      // Place categories
      { id: 'restaurant', name: 'Ristoranti', icon: '🍕', type: 'place' },
      { id: 'bar', name: 'Bar', icon: '🍸', type: 'place' },
      { id: 'club', name: 'Discoteche', icon: '🪩', type: 'place' },
      { id: 'pub', name: 'Pub', icon: '🍺', type: 'place' },
      { id: 'lounge', name: 'Lounge', icon: '🛋️', type: 'place' },
      { id: 'cafe', name: 'Caffetterie', icon: '☕', type: 'place' },
      // Event categories
      { id: 'concert', name: 'Concerti', icon: '🎤', type: 'event' },
      { id: 'dj_set', name: 'DJ Set', icon: '🎧', type: 'event' },
      { id: 'live_music', name: 'Live Music', icon: '🎸', type: 'event' },
      { id: 'karaoke', name: 'Karaoke', icon: '🎙️', type: 'event' },
      { id: 'theme_night', name: 'Serate Tema', icon: '🎭', type: 'event' },
    ];

    return NextResponse.json({ categories });
  } catch (error) {
    console.error('Error fetching categories:', error);
    return NextResponse.json(
      { error: 'Failed to fetch categories' },
      { status: 500 }
    );
  }
}
