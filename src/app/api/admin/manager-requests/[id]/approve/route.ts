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
    const { error: updateRequestError } = await supabase
      .from('manager_requests')
      .update({
        status: 'approved',
        review_notes,
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
      })
      .eq('id', params.id)

    if (updateRequestError) {
      console.error('Error updating manager request:', updateRequestError)
      return NextResponse.json(
        { error: 'Failed to update request' },
        { status: 500 }
      )
    }

    // Update user role to manager
    const { error: updateRoleError } = await supabase
      .from('profiles')
      .update({ role: 'manager' })
      .eq('id', managerRequest.user_id)

    if (updateRoleError) {
      console.error('Error updating user role:', updateRoleError)
      // Rollback request status
      await supabase
        .from('manager_requests')
        .update({
          status: 'pending',
          review_notes: null,
          reviewed_at: null,
          reviewed_by: null,
        })
        .eq('id', params.id)

      return NextResponse.json(
        { error: 'Failed to update user role' },
        { status: 500 }
      )
    }

    // Log in audit_logs
    const { error: auditError } = await supabase.from('audit_logs').insert({
      user_id: user.id,
      action: 'manager_request_approved',
      resource_type: 'manager_request',
      resource_id: params.id,
      details: {
        approved_user_id: managerRequest.user_id,
        review_notes,
      },
    })

    if (auditError) {
      console.error('Error creating audit log:', auditError)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in approve manager request API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
