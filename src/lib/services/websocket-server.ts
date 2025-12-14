/**
 * WebSocket Server per Chat Real-time
 * FASE 3B: Notifiche Messaggi Privati Real-time
 */

import { WebSocketServer, WebSocket } from 'ws'
import { createClient } from '@/lib/supabase/server'
import { getBatchClient } from '@/lib/supabase/connection-pool'

interface WebSocketClient {
  ws: WebSocket
  userId: string
  subscriptions: Set<string> // Conversation IDs
  lastHeartbeat: number
}

interface WebSocketMessage {
  type: 'subscribe' | 'unsubscribe' | 'message' | 'typing' | 'read_receipt' | 'heartbeat'
  conversation_id?: string
  data?: unknown
}

export class WebSocketChatServer {
  private wss: WebSocketServer | null = null
  private clients: Map<string, WebSocketClient> = new Map()
  private heartbeatInterval: NodeJS.Timeout | null = null

  constructor() {
    this.setupHeartbeat()
  }

  /**
   * Avvia il server WebSocket
   */
  start(port: number = 8081): void {
    if (this.wss) {
      console.log('[WebSocket] Server già in esecuzione')
      return
    }

    this.wss = new WebSocketServer({ port })
    console.log(`[WebSocket] Server avviato sulla porta ${port}`)

    this.wss.on('connection', (ws: WebSocket, request) => {
      this.handleConnection(ws, request)
    })

    this.wss.on('error', (error) => {
      console.error('[WebSocket] Server error:', error)
    })
  }

  /**
   * Ferma il server WebSocket
   */
  stop(): void {
    if (this.wss) {
      this.wss.close()
      this.wss = null
      console.log('[WebSocket] Server fermato')
    }

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  /**
   * Gestisce una nuova connessione WebSocket
   */
  private async handleConnection(ws: WebSocket, request: any): Promise<void> {
    try {
      // Estrai token dall'URL o header
      const url = new URL(request.url || '', `ws://${request.headers.host}`)
      const token = url.searchParams.get('token') || request.headers['sec-websocket-protocol']

      if (!token) {
        ws.close(1008, 'Token di autenticazione mancante')
        return
      }

      // Verifica token con Supabase
      const supabase = await createClient()
      const { data: { user }, error } = await supabase.auth.getUser(token)

      if (error || !user) {
        ws.close(1008, 'Token di autenticazione non valido')
        return
      }

      const clientId = user.id
      const client: WebSocketClient = {
        ws,
        userId: clientId,
        subscriptions: new Set(),
        lastHeartbeat: Date.now()
      }

      this.clients.set(clientId, client)
      console.log(`[WebSocket] Client connesso: ${clientId}`)

      // Invia conferma connessione
      this.sendToClient(clientId, {
        type: 'connected',
        user_id: clientId,
        timestamp: new Date().toISOString()
      })

      // Gestione messaggi
      ws.on('message', (data: Buffer) => {
        this.handleMessage(clientId, data.toString())
      })

      // Gestione chiusura
      ws.on('close', () => {
        this.handleDisconnection(clientId)
      })

      // Gestione errori
      ws.on('error', (error) => {
        console.error(`[WebSocket] Errore client ${clientId}:`, error)
        this.handleDisconnection(clientId)
      })

    } catch (error) {
      console.error('[WebSocket] Errore durante la connessione:', error)
      ws.close(1011, 'Errore interno del server')
    }
  }

  /**
   * Gestisce disconnessione client
   */
  private handleDisconnection(clientId: string): void {
    const client = this.clients.get(clientId)
    if (client) {
      console.log(`[WebSocket] Client disconnesso: ${clientId}`)
      this.clients.delete(clientId)
    }
  }

  /**
   * Gestisce messaggi WebSocket
   */
  private async handleMessage(clientId: string, message: string): Promise<void> {
    try {
      const client = this.clients.get(clientId)
      if (!client) return

      const parsedMessage: WebSocketMessage = JSON.parse(message)
      client.lastHeartbeat = Date.now()

      switch (parsedMessage.type) {
        case 'subscribe':
          await this.handleSubscribe(client, parsedMessage.conversation_id)
          break

        case 'unsubscribe':
          this.handleUnsubscribe(client, parsedMessage.conversation_id)
          break

        case 'message':
          await this.handleNewMessage(client, parsedMessage.data)
          break

        case 'typing':
          await this.handleTyping(client, parsedMessage.data)
          break

        case 'read_receipt':
          await this.handleReadReceipt(client, parsedMessage.data)
          break

        case 'heartbeat':
          // Aggiorna lastHeartbeat già fatto sopra
          break

        default:
          console.warn(`[WebSocket] Tipo messaggio sconosciuto: ${(parsedMessage as any).type}`)
      }
    } catch (error) {
      console.error('[WebSocket] Errore gestione messaggio:', error)
    }
  }

  /**
   * Gestisce sottoscrizione a una conversazione
   */
  private async handleSubscribe(client: WebSocketClient, conversationId?: string): Promise<void> {
    if (!conversationId) {
      this.sendToClient(client.userId, {
        type: 'error',
        error: 'conversation_id richiesto per subscribe'
      })
      return
    }

    // Verifica che l'utente sia partecipante della conversazione
    const supabase = await getBatchClient()
    const { data: participant } = await supabase
      .from('conversation_participants')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('user_id', client.userId)
      .single()

    if (!participant) {
      this.sendToClient(client.userId, {
        type: 'error',
        error: 'Non autorizzato a sottoscrivere questa conversazione'
      })
      return
    }

    client.subscriptions.add(conversationId)
    console.log(`[WebSocket] Client ${client.userId} sottoscritto a conversazione ${conversationId}`)

    this.sendToClient(client.userId, {
      type: 'subscribed',
      conversation_id: conversationId,
      timestamp: new Date().toISOString()
    })
  }

  /**
   * Gestisce annullamento sottoscrizione
   */
  private handleUnsubscribe(client: WebSocketClient, conversationId?: string): void {
    if (!conversationId) {
      this.sendToClient(client.userId, {
        type: 'error',
        error: 'conversation_id richiesto per unsubscribe'
      })
      return
    }

    client.subscriptions.delete(conversationId)
    console.log(`[WebSocket] Client ${client.userId} annullato sottoscrizione conversazione ${conversationId}`)

    this.sendToClient(client.userId, {
      type: 'unsubscribed',
      conversation_id: conversationId,
      timestamp: new Date().toISOString()
    })
  }

  /**
   * Gestisce nuovo messaggio
   */
  private async handleNewMessage(client: WebSocketClient, data?: unknown): Promise<void> {
    if (!data || typeof data !== 'object') {
      this.sendToClient(client.userId, {
        type: 'error',
        error: 'Dati messaggio non validi'
      })
      return
    }

    const messageData = data as { conversation_id: string; content: string; message_type?: string }
    
    // Verifica che l'utente sia sottoscritto alla conversazione
    if (!client.subscriptions.has(messageData.conversation_id)) {
      this.sendToClient(client.userId, {
        type: 'error',
        error: 'Non sottoscritto a questa conversazione'
      })
      return
    }

    // Inoltra messaggio a tutti i partecipanti sottoscritti
    await this.broadcastToConversation(messageData.conversation_id, {
      type: 'new_message',
      sender_id: client.userId,
      conversation_id: messageData.conversation_id,
      content: messageData.content,
      message_type: messageData.message_type || 'text',
      timestamp: new Date().toISOString()
    })
  }

  /**
   * Gestisce indicatore "sta scrivendo"
   */
  private async handleTyping(client: WebSocketClient, data?: unknown): Promise<void> {
    if (!data || typeof data !== 'object') {
      return
    }

    const typingData = data as { conversation_id: string; is_typing: boolean }
    
    // Inoltra a tutti i partecipanti sottoscritti (escluso il mittente)
    await this.broadcastToConversation(typingData.conversation_id, {
      type: 'typing',
      user_id: client.userId,
      conversation_id: typingData.conversation_id,
      is_typing: typingData.is_typing,
      timestamp: new Date().toISOString()
    }, client.userId)
  }

  /**
   * Gestisce ricevuta di lettura
   */
  private async handleReadReceipt(client: WebSocketClient, data?: unknown): Promise<void> {
    if (!data || typeof data !== 'object') {
      return
    }

    const receiptData = data as { conversation_id: string; message_id: string }
    
    // Inoltra a tutti i partecipanti sottoscritti (escluso il mittente)
    await this.broadcastToConversation(receiptData.conversation_id, {
      type: 'read_receipt',
      user_id: client.userId,
      conversation_id: receiptData.conversation_id,
      message_id: receiptData.message_id,
      timestamp: new Date().toISOString()
    }, client.userId)
  }

  /**
   * Invia messaggio a un client specifico
   */
  private sendToClient(clientId: string, message: unknown): void {
    const client = this.clients.get(clientId)
    if (client && client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(JSON.stringify(message))
      } catch (error) {
        console.error(`[WebSocket] Errore invio messaggio a client ${clientId}:`, error)
      }
    }
  }

  /**
   * Inoltra messaggio a tutti i partecipanti di una conversazione
   */
  private async broadcastToConversation(
    conversationId: string, 
    message: unknown, 
    excludeUserId?: string
  ): Promise<void> {
    // Trova tutti i client sottoscritti a questa conversazione
    for (const [clientId, client] of this.clients.entries()) {
      if (excludeUserId && clientId === excludeUserId) continue
      
      if (client.subscriptions.has(conversationId) && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(JSON.stringify(message))
        } catch (error) {
          console.error(`[WebSocket] Errore broadcast a client ${clientId}:`, error)
        }
      }
    }
  }

  /**
   * Setup heartbeat per rilevare client disconnessi
   */
  private setupHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now()
      const timeout = 30000 // 30 secondi

      for (const [clientId, client] of this.clients.entries()) {
        if (now - client.lastHeartbeat > timeout) {
          console.log(`[WebSocket] Client ${clientId} timeout, disconnessione`)
          client.ws.close(1001, 'Timeout heartbeat')
          this.clients.delete(clientId)
        }
      }
    }, 10000) // Controlla ogni 10 secondi
  }

  /**
   * Invia notifica push via WebSocket
   */
  async sendPushNotification(userId: string, notification: {
    type: string
    title: string
    body: string
    data?: Record<string, unknown>
  }): Promise<void> {
    this.sendToClient(userId, {
      type: 'push_notification',
      notification: {
        ...notification,
        timestamp: new Date().toISOString()
      }
    })
  }

  /**
   * Ottieni statistiche server
   */
  getStats(): {
    totalClients: number
    activeSubscriptions: number
    uptime: number
  } {
    let totalSubscriptions = 0
    this.clients.forEach(client => {
      totalSubscriptions += client.subscriptions.size
    })

    return {
      totalClients: this.clients.size,
      activeSubscriptions: totalSubscriptions,
      uptime: this.wss ? Date.now() - (this.wss as any).startedAt : 0
    }
  }
}

// Singleton instance
export const webSocketServer = new WebSocketChatServer()