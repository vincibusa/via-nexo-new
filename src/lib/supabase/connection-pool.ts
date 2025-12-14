import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Type definition for Supabase client
type SupabaseClient = ReturnType<typeof createServerClient>

// Connection metadata
interface ConnectionMetadata {
  client: SupabaseClient
  createdAt: number
  lastUsed: number
  healthCheckAt: number
  healthStatus: 'healthy' | 'stale' | 'unknown'
  usageCount: number
}

// Connection pool metrics
interface PoolMetrics {
  activeConnections: number
  maxConnections: number
  averageAge: number
  healthyConnections: number
  staleConnections: number
  totalRequests: number
  averageHitRate: number
  timestamp: number
}

// OPTIMIZED: Connection pool for Supabase clients with health checks
class SupabaseConnectionPool {
  private static instance: SupabaseConnectionPool
  private connections: Map<string, ConnectionMetadata> = new Map()
  private readonly MAX_CONNECTIONS = 10
  private readonly CONNECTION_TTL = 5 * 60 * 1000 // 5 minutes
  private readonly HEALTH_CHECK_INTERVAL = 2 * 60 * 1000 // 2 minutes
  private lastCleanup = Date.now()
  private readonly CLEANUP_INTERVAL = 60 * 1000 // 1 minute
  private metrics: PoolMetrics[] = []
  private healthCheckTimer: NodeJS.Timeout | null = null
  private totalRequests = 0

  private constructor() {
    this.startHealthCheckTimer()
  }

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
    this.totalRequests++

    // Clean up expired connections periodically
    if (Date.now() - this.lastCleanup > this.CLEANUP_INTERVAL) {
      this.cleanup()
    }

    // Check if we have a cached connection
    if (this.connections.has(id)) {
      const metadata = this.connections.get(id)!

      // Check if connection is stale
      if (Date.now() - metadata.createdAt > this.CONNECTION_TTL) {
        console.log(`[Connection Pool] Connection ${id} expired, creating new`)
        this.connections.delete(id)
      } else {
        // Update metadata
        metadata.lastUsed = Date.now()
        metadata.usageCount++
        console.log(`[Connection Pool] Reusing connection ${id} (${metadata.usageCount} uses)`)
        return metadata.client
      }
    }

    // Create new connection
    console.log(`[Connection Pool] Creating new connection ${id}`)
    const client = await this.createClient()

    // Store in pool if we haven't exceeded max connections
    if (this.connections.size < this.MAX_CONNECTIONS) {
      this.connections.set(id, {
        client,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        healthCheckAt: Date.now(),
        healthStatus: 'unknown',
        usageCount: 1
      })
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
   * Perform health check on a connection
   */
  private async performHealthCheck(id: string, metadata: ConnectionMetadata): Promise<void> {
    try {
      // Simple health check: attempt to execute a basic query
      await metadata.client
        .from('profiles')
        .select('id')
        .limit(1)
        .then(() => {
          metadata.healthStatus = 'healthy'
          metadata.healthCheckAt = Date.now()
        })
        .catch(() => {
          metadata.healthStatus = 'stale'
        })
    } catch (error) {
      console.error(`[Connection Pool] Health check failed for ${id}:`, error)
      metadata.healthStatus = 'stale'
    }
  }

  /**
   * Start periodic health checks
   */
  private startHealthCheckTimer(): void {
    // Skip health checks if already running
    if (this.healthCheckTimer) return

    this.healthCheckTimer = setInterval(async () => {
      try {
        const now = Date.now()
        const checks = []

        for (const [id, metadata] of this.connections.entries()) {
          // Check health every 2 minutes or if stale
          if (now - metadata.healthCheckAt > this.HEALTH_CHECK_INTERVAL) {
            checks.push(this.performHealthCheck(id, metadata))
          }
        }

        await Promise.all(checks)
        this.recordMetrics()
      } catch (error) {
        console.error('[Connection Pool] Health check error:', error)
      }
    }, this.HEALTH_CHECK_INTERVAL)
  }

  /**
   * Record pool metrics for monitoring
   */
  private recordMetrics(): void {
    const now = Date.now()
    const activeConnections = this.connections.size
    const healthyConnections = Array.from(this.connections.values()).filter(
      m => m.healthStatus === 'healthy'
    ).length
    const staleConnections = Array.from(this.connections.values()).filter(
      m => m.healthStatus === 'stale'
    ).length

    const ages = Array.from(this.connections.values()).map(m => now - m.createdAt)
    const averageAge = ages.length > 0 ? ages.reduce((a, b) => a + b, 0) / ages.length : 0

    const metric: PoolMetrics = {
      activeConnections,
      maxConnections: this.MAX_CONNECTIONS,
      averageAge,
      healthyConnections,
      staleConnections,
      totalRequests: this.totalRequests,
      averageHitRate: activeConnections > 0 ? 1 - staleConnections / activeConnections : 0,
      timestamp: now
    }

    this.metrics.push(metric)

    // Keep only recent metrics (1 hour)
    const oneHourAgo = now - 60 * 60 * 1000
    this.metrics = this.metrics.filter(m => m.timestamp > oneHourAgo)

    console.log(
      `[Connection Pool] Metrics: ${activeConnections}/${this.MAX_CONNECTIONS} active, ` +
      `${healthyConnections} healthy, ${staleConnections} stale, ` +
      `${this.totalRequests} total requests`
    )
  }

  /**
   * Clean up expired connections
   */
  private cleanup(): void {
    const now = Date.now()
    let removed = 0

    // Remove expired connections
    for (const [id, metadata] of this.connections.entries()) {
      if (now - metadata.createdAt > this.CONNECTION_TTL) {
        this.connections.delete(id)
        removed++
      }
    }

    // If pool is overloaded, remove least recently used
    if (this.connections.size > this.MAX_CONNECTIONS) {
      const sorted = Array.from(this.connections.entries())
        .sort((a, b) => a[1].lastUsed - b[1].lastUsed)

      const toRemove = sorted.slice(0, this.connections.size - this.MAX_CONNECTIONS)
      toRemove.forEach(([id]) => {
        this.connections.delete(id)
        removed++
      })
    }

    if (removed > 0) {
      console.log(`[Connection Pool] Cleaned up ${removed} connections`)
    }

    this.lastCleanup = Date.now()
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    activeConnections: number
    maxConnections: number
    healthyConnections: number
    staleConnections: number
    totalRequests: number
    averageHitRate: number
  } {
    const healthyConnections = Array.from(this.connections.values()).filter(
      m => m.healthStatus === 'healthy'
    ).length
    const staleConnections = Array.from(this.connections.values()).filter(
      m => m.healthStatus === 'stale'
    ).length
    const activeConnections = this.connections.size

    return {
      activeConnections,
      maxConnections: this.MAX_CONNECTIONS,
      healthyConnections,
      staleConnections,
      totalRequests: this.totalRequests,
      averageHitRate: activeConnections > 0 ? 1 - staleConnections / activeConnections : 0
    }
  }

  /**
   * Get detailed metrics history
   */
  getMetrics(): PoolMetrics[] {
    return [...this.metrics]
  }

  /**
   * Force close all connections (for testing/cleanup)
   */
  closeAll(): void {
    console.log(`[Connection Pool] Closing all ${this.connections.size} connections`)
    this.connections.clear()
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
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
 * Get connection pool statistics with health metrics
 */
export function getPoolStats() {
  const pool = SupabaseConnectionPool.getInstance()
  return pool.getStats()
}

/**
 * Get detailed pool metrics history
 */
export function getPoolMetrics() {
  const pool = SupabaseConnectionPool.getInstance()
  return pool.getMetrics()
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

/**
 * Close all pool connections (for cleanup/testing)
 */
export function closePoolConnections(): void {
  const pool = SupabaseConnectionPool.getInstance()
  pool.closeAll()
}

/**
 * Get a service role client that bypasses RLS
 * Use ONLY for trusted server-side operations (notifications, admin tasks, etc.)
 * NEVER expose this client to the frontend or use it with untrusted input
 */
export function getServiceClient(): SupabaseClient {
  const { createClient } = require('@supabase/supabase-js')

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  )
}