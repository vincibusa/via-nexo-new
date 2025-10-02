import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { embedPlace, embedEvent } from '@/lib/jobs/embedding-job'

export async function POST(request: NextRequest) {
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

    const body = await request.json()
    const { resource_type, resource_id } = body

    if (!resource_type || !resource_id) {
      return NextResponse.json(
        { error: 'resource_type and resource_id are required' },
        { status: 400 }
      )
    }

    if (resource_type === 'place') {
      await embedPlace(resource_id)
    } else if (resource_type === 'event') {
      await embedEvent(resource_id)
    } else {
      return NextResponse.json(
        { error: 'Invalid resource_type' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `Embedding triggered for ${resource_type} ${resource_id}`,
    })
  } catch (error) {
    console.error('Error triggering embedding:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
}
