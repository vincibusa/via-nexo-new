/**
 * WebSocket API Route
 * FASE 3B: Notifiche Messaggi Privati Real-time
 * 
 * Questo endpoint gestisce le connessioni WebSocket per chat real-time
 * Utilizza il server WebSocket singleton
 */

import { NextRequest } from 'next/server'
import { webSocketServer } from '@/lib/services/websocket-server'

// Avvia il server WebSocket se non già avviato
if (!process.env.WEBSOCKET_STARTED) {
  webSocketServer.start(8081)
  process.env.WEBSOCKET_STARTED = 'true'
  console.log('[WebSocket] Server avviato tramite API route')
}

export async function GET(request: NextRequest) {
  // Questa route è solo per documentazione e health check
  // Le connessioni WebSocket vengono gestite direttamente dal server
  
  return new Response(JSON.stringify({
    status: 'running',
    endpoint: 'ws://localhost:8081',
    authentication: 'Token via query parameter ?token=... o WebSocket protocol header',
    message_types: [
      'subscribe',
      'unsubscribe', 
      'message',
      'typing',
      'read_receipt',
      'heartbeat'
    ]
  }), {
    headers: {
      'Content-Type': 'application/json'
    }
  })
}

export async function POST(request: NextRequest) {
  // Endpoint per inviare notifiche push via HTTP (fallback per WebSocket)
  try {
    const body = await request.json()
    const { user_id, notification } = body

    if (!user_id || !notification) {
      return new Response(JSON.stringify({
        error: 'user_id e notification richiesti'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    await webSocketServer.sendPushNotification(user_id, notification)

    return new Response(JSON.stringify({
      success: true,
      message: 'Notifica inviata'
    }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('[WebSocket API] Errore:', error)
    return new Response(JSON.stringify({
      error: 'Errore interno del server'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}