import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse form data
    const formData = await request.formData()
    const file = formData.get('file') as File
    const bucket = formData.get('bucket') as string // place-images, event-images, avatars

    // Check if user is authorized
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    // Allow all authenticated users for avatar uploads
    if (bucket !== 'avatars' && (!profile || (profile.role !== 'admin' && profile.role !== 'manager'))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Allowed buckets (discovery-videos for videos, place-images/event-images for images)
    const allowedBuckets = ['place-images', 'event-images', 'avatars', 'discovery-videos']
    if (!bucket || !allowedBuckets.includes(bucket)) {
      return NextResponse.json({ error: 'Invalid bucket' }, { status: 400 })
    }

    // Validate file type - support both images and videos
    const allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    const allowedVideoTypes = ['video/mp4', 'video/mpeg', 'video/quicktime', 'video/x-msvideo'] // mp4, mpeg, mov, avi
    const allowedTypes = [...allowedImageTypes, ...allowedVideoTypes]
    
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ 
        error: 'Invalid file type. Allowed: JPEG, PNG, WebP (images) or MP4, MOV, MPEG, AVI (videos)' 
      }, { status: 400 })
    }

    // Validate file size based on file type
    const isVideo = allowedVideoTypes.includes(file.type)
    const maxSize = isVideo 
      ? 100 * 1024 * 1024 // 100MB for videos (as per plan specifications)
      : 5 * 1024 * 1024   // 5MB for images
    
    if (file.size > maxSize) {
      const maxSizeMB = Math.round(maxSize / (1024 * 1024))
      return NextResponse.json({ 
        error: `File too large. Maximum size is ${maxSizeMB}MB${isVideo ? ' for videos' : ' for images'}` 
      }, { status: 400 })
    }

    // Generate unique filename
    const fileExt = file.name.split('.').pop()
    const fileName = `${user.id}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`

    // Convert File to ArrayBuffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: false,
      })

    if (error) {
      console.error('Storage upload error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Get public URL
    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(fileName)

    return NextResponse.json({
      path: data.path,
      url: urlData.publicUrl,
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin or manager
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || (profile.role !== 'admin' && profile.role !== 'manager')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get file path and bucket from query params
    const searchParams = request.nextUrl.searchParams
    const path = searchParams.get('path')
    const bucket = searchParams.get('bucket')

    if (!path || !bucket) {
      return NextResponse.json({ error: 'Missing path or bucket' }, { status: 400 })
    }

    // Delete from Supabase Storage
    const { error } = await supabase.storage.from(bucket).remove([path])

    if (error) {
      console.error('Storage delete error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
