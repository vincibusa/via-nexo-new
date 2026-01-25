import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { withRoleProtection, AuthContext } from '@/lib/middleware/auth'

async function handleGetManagerRequests(request: NextRequest, user: AuthContext): Promise<NextResponse> {
  const supabase = await createClient()

  // Get query params
  const searchParams = request.nextUrl.searchParams
  const pageParam = searchParams.get('page') || '1'
  const limitParam = searchParams.get('limit') || '20'
  const search = searchParams.get('search') || ''
  const status = searchParams.get('status') || 'all'

  // VALIDATION: Parse with fallback
  const page = Math.max(1, parseInt(pageParam) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(limitParam) || 20))

  const from = (page - 1) * limit
  const to = from + limit - 1

  // Build query
  let query = supabase
    .from('manager_requests')
    .select(
      `
      *,
      user:profiles!manager_requests_user_id_fkey(email, display_name)
    `,
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })

  // Apply filters
  if (status !== 'all') {
    query = query.eq('status', status)
  }

  if (search) {
    query = query.or(
      `business_name.ilike.%${search}%,user.email.ilike.%${search}%,user.display_name.ilike.%${search}%`
    )
  }

  // Apply pagination
  query = query.range(from, to)

  const { data: requests, error, count } = await query

  if (error) {
    console.error('Error fetching manager requests:', error)
    return NextResponse.json(
      { error: 'Failed to fetch manager requests' },
      { status: 500 }
    )
  }

  const totalPages = Math.ceil((count || 0) / limit)

  return NextResponse.json({
    requests: requests || [],
    pagination: {
      page,
      limit,
      total: count || 0,
      totalPages,
    },
  })
}

export const GET = withRoleProtection(handleGetManagerRequests, ['admin'])
