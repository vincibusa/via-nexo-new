/**
 * Next.js Instrumentation Hook
 * This file is called when the Next.js server starts
 * Used to initialize background services like Realtime listeners
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Initialize background services on Node.js runtime
    const { initializeBackgroundServices } = await import('@/lib/init')

    try {
      console.log('[Instrumentation] Server started - initializing background services')
      initializeBackgroundServices()
    } catch (error) {
      console.error('[Instrumentation] Error during initialization:', error)
    }
  }
}
