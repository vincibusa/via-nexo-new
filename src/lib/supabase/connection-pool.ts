import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Type definition for Supabase client
type SupabaseClient = ReturnType<typeof createServerClient>

// OPTIMIZED: Connection pool for Supabase clients
class SupabaseConnectionPool {
  private static instance: SupabaseConnectionPool
  private connections: Map<string, SupabaseClient> = new Map()
  private readonly MAX_CONNECTIONS = 10
  private readonly CONNECTION_TTL = 5 * 60 * 1000 // 5 minutes
  private lastCleanup = Date.now()
  private readonly CLEANUP_INTERVAL = 60 * 1000 // 1 minute

  private constructor() {}

  static getInstance(): SupabaseConnectionPool {
    if (!SupabaseConnectionPool.instance) {
      SupabaseConnectionPool.instance = new SupabaseConnectionPool()
    }
    return SupabaseConnectionPool.instance
  }

  /**
   * Get or create a Supabase client with connection reuse
   */
  async getClient(clientId?: string): Promise<SupabaseClient> {
    const id = clientId || 'default'
    
    // Clean up expired connections periodically
    if (Date.now() - this.lastCleanup > this.CLEANUP_INTERVAL) {
      this.cleanup()
    }

    // Check if we have a cached connection
    if (this.connections.has(id)) {
      const client = this.connections.get(id)!
      console.log(`[Connection Pool] Reusing connection ${id}`)
      return client
    }

    // Create new connection
    console.log(`[Connection Pool] Creating new connection ${id}`)
    const client = await this.createClient()
    
    // Store in pool if we haven't exceeded max connections
    if (this.connections.size < this.MAX_CONNECTIONS) {
      this.connections.set(id, client)
    }

    return client
  }

  /**
   * Create a new Supabase client
   */
  private async createClient(): Promise<SupabaseClient> {
    const cookieStore = await cookies()

    return createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {
              // Server Component context - ignore
            }
          },
        },
      }
    )
  }

  /**
   * Clean up expired connections
   */
  private cleanup(): void {
    console.log(`[Connection Pool] Running cleanup, current connections: ${this.connections.size}`)
    
    // For now, just clear all connections periodically
    // In a more sophisticated implementation, we would track connection age
    if (this.connections.size > this.MAX_CONNECTIONS / 2) {
      const toRemove = Math.floor(this.connections.size / 2)
      const keys = Array.from(this.connections.keys()).slice(0, toRemove)
      
      keys.forEach(key => {
        this.connections.delete(key)
      })
      
      console.log(`[Connection Pool] Cleaned up ${keys.length} connections`)
    }

    this.lastCleanup = Date.now()
  }

  /**
   * Get pool statistics
   */
  getStats(): { activeConnections: number; maxConnections: number } {
    return {
      activeConnections: this.connections.size,
      maxConnections: this.MAX_CONNECTIONS
    }
  }

  /**
   * Force close all connections (for testing/cleanup)
   */
  closeAll(): void {
    console.log(`[Connection Pool] Closing all ${this.connections.size} connections`)
    this.connections.clear()
  }
}

/**
 * OPTIMIZED: Get a pooled Supabase client
 */
export async function getPooledClient(clientId?: string): Promise<SupabaseClient> {
  const pool = SupabaseConnectionPool.getInstance()
  return pool.getClient(clientId)
}

/**
 * Get connection pool statistics
 */
export function getPoolStats(): { activeConnections: number; maxConnections: number } {
  const pool = SupabaseConnectionPool.getInstance()
  return pool.getStats()
}

/**
 * OPTIMIZED: Specialized client for batch operations
 * Uses a dedicated connection for heavy database operations
 */
export async function getBatchClient(): Promise<SupabaseClient> {
  return getPooledClient('batch-operations')
}

/**
 * OPTIMIZED: Specialized client for read-only operations
 * Can be optimized differently for read queries
 */
export async function getReadOnlyClient(): Promise<SupabaseClient> {
  return getPooledClient('read-only')
}