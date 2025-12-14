/**
 * Server-side initialization functions
 * Called on application startup to initialize background services
 */

// DISABLED: Realtime listener causes duplicate push notifications
// The API endpoint already sends push notifications, so we don't need this
// import { initializeMessageListener } from '@/lib/realtime/message-listener'

let messageListenerInitialized = false
let messageListenerChannel: any = null

/**
 * Initialize all background services for real-time messaging
 * Should be called once when the server starts
 *
 * NOTE: Realtime listener currently disabled to prevent duplicate notifications
 */
export function initializeBackgroundServices() {
  if (messageListenerInitialized) {
    console.log('[Init] Background services already initialized')
    return
  }

  console.log('[Init] Initializing background services...')

  try {
    // DISABLED: Initialize message listener for real-time notifications
    // messageListenerChannel = initializeMessageListener()
    // messageListenerInitialized = true

    console.log('[Init] Background services initialized successfully (Realtime listener disabled)')
  } catch (error) {
    console.error('[Init] Error initializing background services:', error)
  }
}

/**
 * Shutdown all background services
 */
export function shutdownBackgroundServices() {
  if (!messageListenerInitialized) {
    return
  }

  console.log('[Init] Shutting down background services...')

  try {
    if (messageListenerChannel) {
      messageListenerChannel.unsubscribe()
      console.log('[Init] Message listener shut down')
    }
    messageListenerInitialized = false
  } catch (error) {
    console.error('[Init] Error shutting down background services:', error)
  }
}

/**
 * Check if background services are initialized
 */
export function areBackgroundServicesInitialized(): boolean {
  return messageListenerInitialized
}
