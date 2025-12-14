/**
 * Event Recommendations API
 * FASE 3C: Smart Event Recommendations
 * 
 * Endpoint per ottenere raccomandazioni eventi personalizzate
 */

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getEventRecommendationsAPI } from '@/lib/services/event-recommendations'

export async function GET(request: NextRequest) {
  const supabase = await createClient()

  try {
    // Verifica autenticazione
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return new Response(JSON.stringify({
        error: 'Non autorizzato'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    return await getEventRecommendationsAPI(user.id, request)

  } catch (error) {
    console.error('[Event Recommendations API] Error:', error)
    return new Response(JSON.stringify({
      error: 'Errore interno del server'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}