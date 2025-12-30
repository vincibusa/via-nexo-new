import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface TrendingSearch {
  query: string;
  count: number;
}

export async function GET() {
  try {
    // Per ora restituiamo trending statici
    // In futuro si può collegare ad analytics per ricerche reali
    const trending: TrendingSearch[] = [
      { query: 'aperitivo', count: 245 },
      { query: 'discoteca', count: 189 },
      { query: 'brunch', count: 156 },
      { query: 'karaoke', count: 134 },
      { query: 'live music', count: 112 },
      { query: 'cocktail bar', count: 98 },
      { query: 'pizzeria', count: 87 },
      { query: 'rooftop', count: 76 },
    ];

    return NextResponse.json({ trending });
  } catch (error) {
    console.error('Error fetching trending searches:', error);
    return NextResponse.json(
      { error: 'Failed to fetch trending searches' },
      { status: 500 }
    );
  }
}
