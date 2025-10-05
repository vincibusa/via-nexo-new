import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * DELETE /api/favorites/[id]
 * Remove a favorite by ID
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if favorite exists and belongs to user
    const { data: favorite, error: fetchError } = await supabase
      .from('favorites')
      .select('id, user_id')
      .eq('id', id)
      .single()

    if (fetchError || !favorite) {
      return NextResponse.json(
        { error: 'Favorite not found' },
        { status: 404 }
      )
    }

    // Verify ownership
    if (favorite.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      )
    }

    // Delete favorite
    const { error: deleteError } = await supabase
      .from('favorites')
      .delete()
      .eq('id', id)

    if (deleteError) {
      console.error('Error deleting favorite:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete favorite' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      message: 'Favorite removed successfully',
    })
  } catch (error) {
    console.error('Error in DELETE /api/favorites/[id]:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
