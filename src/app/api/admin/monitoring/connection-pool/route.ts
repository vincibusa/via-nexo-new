/**
 * Connection Pool Monitoring Endpoint
 * FASE 4A.4: Monitor connection pool health and performance
 */

import { getPoolStats, getPoolMetrics } from '@/lib/supabase/connection-pool'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  try {
    // Check authentication
    const supabase = await createClient()
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get connection pool stats
    const stats = getPoolStats()
    const metrics = getPoolMetrics()

    // Calculate trends
    const recentMetrics = metrics.slice(-10) // Last 10 measurements
    const trends = {
      connectionsTrend: recentMetrics.map(m => m.activeConnections),
      healthTrend: recentMetrics.map(m => m.averageHitRate),
      requestsTrend: recentMetrics.map(m => m.totalRequests)
    }

    return NextResponse.json({
      stats,
      trends,
      metrics: recentMetrics,
      timestamp: Date.now(),
      message: 'Connection pool health check'
    })
  } catch (error) {
    console.error('[Connection Pool API] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch connection pool metrics' },
      { status: 500 }
    )
  }
}
