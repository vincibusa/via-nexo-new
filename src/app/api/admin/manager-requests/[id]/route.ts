import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()

    // Check if user is admin
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fetch request details
    const { data: managerRequest, error } = await supabase
      .from('manager_requests')
      .select(
        `
        *,
        user:profiles!manager_requests_user_id_fkey(email, display_name)
      `
      )
      .eq('id', params.id)
      .single()

    if (error) {
      console.error('Error fetching manager request:', error)
      return NextResponse.json(
        { error: 'Failed to fetch manager request' },
        { status: 500 }
      )
    }

    if (!managerRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }

    return NextResponse.json(managerRequest)
  } catch (error) {
    console.error('Error in manager request detail API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
