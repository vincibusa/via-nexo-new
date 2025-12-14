/**
 * Event Interest API
 * FASE 3F.4: Registrazione interesse eventi per mobile app
 * 
 * Endpoint semplificato per registrare interesse agli eventi
 * Supporta: viewed, saved, shared, attending
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()

  try {
    // Verifica autenticazione
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Non autorizzato' },
        { status: 401 }
      )
    }

    // Ottieni parametri dal body
    const body = await request.json()
    const { event_id, interest_level } = body

    if (!event_id || !interest_level) {
      return NextResponse.json(
        { error: 'Parametri richiesti: event_id, interest_level' },
        { status: 400 }
      )
    }

    // Valida interest_level
    const validLevels = ['viewed', 'saved', 'shared', 'attending']
    if (!validLevels.includes(interest_level)) {
      return NextResponse.json(
        { error: `interest_level deve essere uno di: ${validLevels.join(', ')}` },
        { status: 400 }
      )
    }

    // 1. Verifica che l'evento esista
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, title')
      .eq('id', event_id)
      .single()

    if (eventError || !event) {
      return NextResponse.json(
        { error: 'Evento non trovato' },
        { status: 404 }
      )
    }

    // 2. Mappa interest_level a status per event_attendance
    let attendanceStatus: 'going' | 'interested' | 'not_going' | null = null
    let shouldRecordAttendance = false
    
    switch (interest_level) {
      case 'attending':
        attendanceStatus = 'going'
        shouldRecordAttendance = true
        break
      case 'saved':
        attendanceStatus = 'interested'
        shouldRecordAttendance = true
        break
      case 'viewed':
      case 'shared':
        // Solo registrazione interesse, non attendance
        break
    }

    // 3. Registra interesse nell'evento (sempre)
    const { error: interestError } = await supabase
      .from('event_interests')
      .upsert({
        event_id,
        user_id: user.id,
        interest_level,
        recorded_at: new Date().toISOString()
      }, {
        onConflict: 'event_id,user_id'
      })

    if (interestError) {
      console.error('[Event Interest] Error recording interest:', interestError)
      // Continua comunque, non fallire se la tabella non esiste
    }

    // 4. Se necessario, registra anche in event_attendance
    if (shouldRecordAttendance && attendanceStatus) {
      const { error: attendanceError } = await supabase
        .from('event_attendance')
        .upsert({
          event_id,
          user_id: user.id,
          status: attendanceStatus
        }, {
          onConflict: 'event_id,user_id'
        })

      if (attendanceError) {
        console.error('[Event Interest] Error recording attendance:', attendanceError)
        // Non fallire se c'è un errore di attendance
      }
    }

    // 5. Se shared, incrementa contatore condivisioni
    if (interest_level === 'shared') {
      const { error: shareError } = await supabase.rpc('increment_event_shares', {
        event_id_param: event_id
      })

      if (shareError) {
        console.error('[Event Interest] Error incrementing shares:', shareError)
        // Non fallire se la RPC non esiste
      }
    }

    // 6. Registra visualizzazione per analytics
    if (interest_level === 'viewed') {
      const { error: viewError } = await supabase
        .from('event_views')
        .insert({
          event_id,
          user_id: user.id,
          viewed_at: new Date().toISOString()
        })

      if (viewError) {
        console.error('[Event Interest] Error recording view:', viewError)
        // Non fallire se la tabella non esiste
      }
    }

    return NextResponse.json({
      success: true,
      event_id,
      interest_level,
      recorded_at: new Date().toISOString(),
      message: getSuccessMessage(interest_level, event.title)
    })

  } catch (error) {
    console.error('[Event Interest] Error:', error)
    return NextResponse.json(
      { error: 'Errore interno del server' },
      { status: 500 }
    )
  }
}

/**
 * Ottieni messaggio di successo in base al livello di interesse
 */
function getSuccessMessage(interestLevel: string, eventTitle: string): string {
  switch (interestLevel) {
    case 'viewed':
      return `Visualizzazione registrata per "${eventTitle}"`
    case 'saved':
      return `Evento "${eventTitle}" salvato nei preferiti`
    case 'shared':
      return `Evento "${eventTitle}" condiviso`
    case 'attending':
      return `Partecipazione registrata per "${eventTitle}"`
    default:
      return `Interesse registrato per "${eventTitle}"`
  }
}