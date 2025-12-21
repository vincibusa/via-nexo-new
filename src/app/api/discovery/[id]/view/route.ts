import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    // Check authentication (optional for views)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // Increment views count using RPC
    const { error } = await supabase.rpc('increment_discovery_views', {
      discovery_id_param: id,
    })

    if (error) {
      throw error
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in discovery view POST:', error)
    // Don't fail the request if view tracking fails
    return NextResponse.json({ success: false }, { status: 200 })
  }
}

