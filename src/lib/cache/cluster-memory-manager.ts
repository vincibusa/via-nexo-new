/**
 * Cluster Memory Manager
 * PERFORMANCE: Cache condivisa tra worker Node.js per scalabilità
 */

import cluster from 'cluster'

interface ClusterCacheEntry {
  data: any
  timestamp: number
  ttl: number
  workerId: number
}

interface ClusterMessage {
  type: 'cache_get' | 'cache_set' | 'cache_delete' | 'cache_clear' | 'cache_stats'
  payload: any
  requestId: string
  workerId: number
}

interface ClusterCacheStats {
  size: number
  hits: number
  misses: number
  workersActive: number
  memoryUsageMB: number
}

/**
 * Cluster-aware cache manager
 */
class ClusterMemoryManager {
  private cache = new Map<string, ClusterCacheEntry>()
  private stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0
  }
  private activeWorkers = new Set<number>()
  private pendingRequests = new Map<string, (data: any) => void>()

  constructor() {
    if (cluster.isMaster || cluster.isPrimary) {
      this.setupMaster()
    } else {
      this.setupWorker()
    }
  }

  /**
   * Master process: gestisce la cache centrale
   */
  private setupMaster(): void {
    console.log('[Cluster Cache] Setting up master cache manager')

    cluster.on('message', (worker, message: ClusterMessage) => {
      if (!message.type?.startsWith('cache_')) return

      this.handleWorkerMessage(worker, message)
    })

    cluster.on('exit', (worker) => {
      this.activeWorkers.delete(worker.id)
      console.log(`[Cluster Cache] Worker ${worker.id} exited, ${this.activeWorkers.size} workers remain`)
    })

    // Cleanup timer per master
    setInterval(() => {
      this.cleanup()
    }, 5 * 60 * 1000) // 5 minutes
  }

  /**
   * Worker process: interfaccia per cache remota
   */
  private setupWorker(): void {
    console.log(`[Cluster Cache] Setting up worker ${process.pid} cache interface`)

    process.on('message', (message: any) => {
      if (message.type?.startsWith('cache_response_')) {
        const callback = this.pendingRequests.get(message.requestId)
        if (callback) {
          callback(message.payload)
          this.pendingRequests.delete(message.requestId)
        }
      }
    })

    // Register this worker
    if (process.send) {
      process.send({
        type: 'cache_register',
        workerId: cluster.worker?.id || process.pid
      })
    }
  }

  /**
   * Gestisce messaggi dai worker (solo master)
   */
  private handleWorkerMessage(worker: any, message: ClusterMessage): void {
    this.activeWorkers.add(worker.id)

    switch (message.type) {
      case 'cache_get':
        const entry = this.cache.get(message.payload.key)
        let result = null
        
        if (entry && Date.now() - entry.timestamp < entry.ttl) {
          result = entry.data
          this.stats.hits++
        } else {
          if (entry) {
            this.cache.delete(message.payload.key)
          }
          this.stats.misses++
        }

        worker.send({
          type: 'cache_response_get',
          requestId: message.requestId,
          payload: { data: result, hit: result !== null }
        })
        break

      case 'cache_set':
        const { key, data, ttl } = message.payload
        this.cache.set(key, {
          data,
          timestamp: Date.now(),
          ttl: ttl || 60 * 60 * 1000, // 1h default
          workerId: worker.id
        })
        this.stats.sets++

        worker.send({
          type: 'cache_response_set',
          requestId: message.requestId,
          payload: { success: true }
        })
        break

      case 'cache_delete':
        const deleted = this.cache.delete(message.payload.key)
        if (deleted) this.stats.deletes++

        worker.send({
          type: 'cache_response_delete',
          requestId: message.requestId,
          payload: { deleted }
        })
        break

      case 'cache_stats':
        worker.send({
          type: 'cache_response_stats',
          requestId: message.requestId,
          payload: this.getStats()
        })
        break
    }
  }

  /**
   * Get da cache cluster (async)
   */
  async get(key: string): Promise<any> {
    if (cluster.isMaster || cluster.isPrimary) {
      // Master: accesso diretto
      const entry = this.cache.get(key)
      if (entry && Date.now() - entry.timestamp < entry.ttl) {
        this.stats.hits++
        return entry.data
      }
      this.stats.misses++
      return null
    }

    // Worker: richiesta al master
    return new Promise((resolve) => {
      const requestId = `req_${Date.now()}_${Math.random()}`
      this.pendingRequests.set(requestId, (response) => {
        resolve(response.data)
      })

      if (process.send) {
        process.send({
          type: 'cache_get',
          payload: { key },
          requestId,
          workerId: cluster.worker?.id || process.pid
        } as ClusterMessage)
      } else {
        resolve(null)
      }

      // Timeout fallback
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId)
          resolve(null)
        }
      }, 1000)
    })
  }

  /**
   * Set in cache cluster (async)
   */
  async set(key: string, data: any, ttl?: number): Promise<boolean> {
    if (cluster.isMaster || cluster.isPrimary) {
      // Master: set diretto
      this.cache.set(key, {
        data,
        timestamp: Date.now(),
        ttl: ttl || 60 * 60 * 1000,
        workerId: 0 // Master ID
      })
      this.stats.sets++
      return true
    }

    // Worker: richiesta al master
    return new Promise((resolve) => {
      const requestId = `req_${Date.now()}_${Math.random()}`
      this.pendingRequests.set(requestId, (response) => {
        resolve(response.success)
      })

      if (process.send) {
        process.send({
          type: 'cache_set',
          payload: { key, data, ttl },
          requestId,
          workerId: cluster.worker?.id || process.pid
        } as ClusterMessage)
      } else {
        resolve(false)
      }

      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId)
          resolve(false)
        }
      }, 1000)
    })
  }

  /**
   * Delete da cache cluster
   */
  async delete(key: string): Promise<boolean> {
    if (cluster.isMaster || cluster.isPrimary) {
      const deleted = this.cache.delete(key)
      if (deleted) this.stats.deletes++
      return deleted
    }

    return new Promise((resolve) => {
      const requestId = `req_${Date.now()}_${Math.random()}`
      this.pendingRequests.set(requestId, (response) => {
        resolve(response.deleted)
      })

      if (process.send) {
        process.send({
          type: 'cache_delete',
          payload: { key },
          requestId,
          workerId: cluster.worker?.id || process.pid
        } as ClusterMessage)
      } else {
        resolve(false)
      }

      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId)
          resolve(false)
        }
      }, 1000)
    })
  }

  /**
   * Stats cluster
   */
  async getStats(): Promise<ClusterCacheStats> {
    if (cluster.isMaster || cluster.isPrimary) {
      return {
        size: this.cache.size,
        hits: this.stats.hits,
        misses: this.stats.misses,
        workersActive: this.activeWorkers.size,
        memoryUsageMB: this.estimateMemoryUsage()
      }
    }

    return new Promise((resolve) => {
      const requestId = `req_${Date.now()}_${Math.random()}`
      this.pendingRequests.set(requestId, (stats) => {
        resolve(stats)
      })

      if (process.send) {
        process.send({
          type: 'cache_stats',
          payload: {},
          requestId,
          workerId: cluster.worker?.id || process.pid
        } as ClusterMessage)
      } else {
        resolve({
          size: 0,
          hits: 0,
          misses: 0,
          workersActive: 0,
          memoryUsageMB: 0
        })
      }

      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId)
          resolve({
            size: 0,
            hits: 0,
            misses: 0,
            workersActive: 0,
            memoryUsageMB: 0
          })
        }
      }, 1000)
    })
  }

  /**
   * Cleanup expired entries (master only)
   */
  private cleanup(): void {
    if (!cluster.isMaster && !cluster.isPrimary) return

    const now = Date.now()
    const keysToDelete: string[] = []

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        keysToDelete.push(key)
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key)
    }

    if (keysToDelete.length > 0) {
      console.log(`[Cluster Cache] Cleaned up ${keysToDelete.length} expired entries`)
    }
  }

  /**
   * Stima utilizzo memoria
   */
  private estimateMemoryUsage(): number {
    let totalSize = 0
    
    for (const [key, entry] of this.cache.entries()) {
      totalSize += key.length * 2 // String key
      try {
        totalSize += JSON.stringify(entry.data).length * 2
      } catch {
        totalSize += 1024 // Fallback
      }
    }

    return totalSize / 1024 / 1024 // MB
  }
}

/**
 * Global cluster cache instance
 */
export const clusterCache = new ClusterMemoryManager()

/**
 * Helper functions per utilizzo semplice
 */
export async function getFromClusterCache<T>(key: string): Promise<T | null> {
  return await clusterCache.get(key)
}

export async function setInClusterCache<T>(
  key: string, 
  data: T, 
  ttlMs?: number
): Promise<boolean> {
  return await clusterCache.set(key, data, ttlMs)
}

export async function deleteFromClusterCache(key: string): Promise<boolean> {
  return await clusterCache.delete(key)
}

/**
 * Prefixed cache per namespace
 */
export class NamespacedClusterCache<T = any> {
  constructor(private namespace: string) {}

  async get(key: string): Promise<T | null> {
    return await clusterCache.get(`${this.namespace}:${key}`)
  }

  async set(key: string, data: T, ttlMs?: number): Promise<boolean> {
    return await clusterCache.set(`${this.namespace}:${key}`, data, ttlMs)
  }

  async delete(key: string): Promise<boolean> {
    return await clusterCache.delete(`${this.namespace}:${key}`)
  }

  async mget(keys: string[]): Promise<Record<string, T | null>> {
    const results: Record<string, T | null> = {}
    
    await Promise.all(keys.map(async (key) => {
      results[key] = await this.get(key)
    }))
    
    return results
  }
}

// Namespace predefiniti per uso comune
export const geoClusterCache = new NamespacedClusterCache<string[]>('geo')
export const embedClusterCache = new NamespacedClusterCache<any>('embeddings')
export const apiClusterCache = new NamespacedClusterCache<any>('api')