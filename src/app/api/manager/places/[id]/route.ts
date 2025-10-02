import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()

    // Check if user is manager
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

    if (profile?.role !== 'manager') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fetch place - ensure it belongs to this manager
    const { data: place, error } = await supabase
      .from('places')
      .select('*')
      .eq('id', params.id)
      .eq('manager_id', user.id)
      .single()

    if (error || !place) {
      return NextResponse.json({ error: 'Place not found' }, { status: 404 })
    }

    return NextResponse.json(place)
  } catch (error) {
    console.error('Error fetching place:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()

    // Check if user is manager
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

    if (profile?.role !== 'manager') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Verify ownership
    const { data: existingPlace } = await supabase
      .from('places')
      .select('manager_id')
      .eq('id', params.id)
      .single()

    if (!existingPlace || existingPlace.manager_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()

    // Managers cannot change verification_status
    delete body.verification_status

    // Update place
    const { data: place, error } = await supabase
      .from('places')
      .update(body)
      .eq('id', params.id)
      .eq('manager_id', user.id)
      .select()
      .single()

    if (error) {
      console.error('Error updating place:', error)
      return NextResponse.json(
        { error: 'Failed to update place' },
        { status: 500 }
      )
    }

    return NextResponse.json(place)
  } catch (error) {
    console.error('Error in update place API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()

    // Check if user is manager
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

    if (profile?.role !== 'manager') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Delete place - RLS will ensure only owned places can be deleted
    const { error } = await supabase
      .from('places')
      .delete()
      .eq('id', params.id)
      .eq('manager_id', user.id)

    if (error) {
      console.error('Error deleting place:', error)
      return NextResponse.json(
        { error: 'Failed to delete place' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in delete place API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
