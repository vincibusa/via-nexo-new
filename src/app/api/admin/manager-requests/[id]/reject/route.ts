import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(
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

    // Get request body
    const body = await request.json()
    const { review_notes } = body

    if (!review_notes?.trim()) {
      return NextResponse.json(
        { error: 'Review notes are required for rejection' },
        { status: 400 }
      )
    }

    // Get the manager request
    const { data: managerRequest, error: fetchError } = await supabase
      .from('manager_requests')
      .select('user_id, status')
      .eq('id', params.id)
      .single()

    if (fetchError || !managerRequest) {
      return NextResponse.json(
        { error: 'Request not found' },
        { status: 404 }
      )
    }

    if (managerRequest.status !== 'pending') {
      return NextResponse.json(
        { error: 'Request has already been reviewed' },
        { status: 400 }
      )
    }

    // Update request status
    const { error: updateError } = await supabase
      .from('manager_requests')
      .update({
        status: 'rejected',
        review_notes,
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
      })
      .eq('id', params.id)

    if (updateError) {
      console.error('Error updating manager request:', updateError)
      return NextResponse.json(
        { error: 'Failed to update request' },
        { status: 500 }
      )
    }

    // Log in audit_logs
    const { error: auditError } = await supabase.from('audit_logs').insert({
      user_id: user.id,
      action: 'manager_request_rejected',
      resource_type: 'manager_request',
      resource_id: params.id,
      details: {
        rejected_user_id: managerRequest.user_id,
        review_notes,
      },
    })

    if (auditError) {
      console.error('Error creating audit log:', auditError)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in reject manager request API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
