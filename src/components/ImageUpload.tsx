'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { X, Upload, Image as ImageIcon } from 'lucide-react'
import { toast } from 'sonner'
import Image from 'next/image'

interface ImageUploadProps {
  bucket: 'place-images' | 'event-images' | 'avatars'
  value?: string | string[] // Single URL or array of URLs
  onChange: (url: string | string[]) => void
  multiple?: boolean
  maxImages?: number
  label?: string
  description?: string
}

export function ImageUpload({
  bucket,
  value,
  onChange,
  multiple = false,
  maxImages = 5,
  label,
  description,
}: ImageUploadProps) {
  const [uploading, setUploading] = useState(false)

  const currentImages = Array.isArray(value) ? value : value ? [value] : []

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    // Check if we've reached max images
    if (multiple && currentImages.length + files.length > maxImages) {
      toast.error(`Puoi caricare massimo ${maxImages} immagini`)
      return
    }

    try {
      setUploading(true)
      const uploadedUrls: string[] = []

      for (let i = 0; i < files.length; i++) {
        const file = files[i]

        // Create form data
        const formData = new FormData()
        formData.append('file', file)
        formData.append('bucket', bucket)

        // Upload
        const response = await fetch('/api/admin/upload', {
          method: 'POST',
          body: formData,
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || 'Errore upload')
        }

        const data = await response.json()
        uploadedUrls.push(data.url)
      }

      // Update value
      if (multiple) {
        onChange([...currentImages, ...uploadedUrls])
      } else {
        onChange(uploadedUrls[0])
      }

      toast.success('Immagine caricata con successo')
    } catch (error) {
      console.error('Upload error:', error)
      toast.error(error instanceof Error ? error.message : 'Errore nel caricamento')
    } finally {
      setUploading(false)
      // Reset input
      e.target.value = ''
    }
  }

  const handleRemove = async (url: string) => {
    try {
      // Extract path from URL
      const urlObj = new URL(url)
      const pathParts = urlObj.pathname.split('/')
      const bucketIndex = pathParts.indexOf(bucket)
      const path = pathParts.slice(bucketIndex + 1).join('/')

      // Delete from storage
      const response = await fetch(`/api/admin/upload?path=${encodeURIComponent(path)}&bucket=${bucket}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Errore nella rimozione')
      }

      // Update value
      if (multiple) {
        onChange(currentImages.filter((img) => img !== url))
      } else {
        onChange('')
      }

      toast.success('Immagine rimossa')
    } catch (error) {
      console.error('Remove error:', error)
      toast.error('Errore nella rimozione')
    }
  }

  return (
    <div className="space-y-4">
      {label && <Label>{label}</Label>}
      {description && <p className="text-sm text-muted-foreground">{description}</p>}

      {/* Image Grid */}
      {currentImages.length > 0 && (
        <div className={`grid gap-4 ${multiple ? 'grid-cols-2 md:grid-cols-3' : 'grid-cols-1'}`}>
          {currentImages.map((url, index) => (
            <div key={url} className="relative group">
              <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
                <Image
                  src={url}
                  alt={`Image ${index + 1}`}
                  fill
                  className="object-cover"
                />
              </div>
              <Button
                type="button"
                variant="destructive"
                size="icon"
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => handleRemove(url)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Upload Button */}
      {(multiple ? currentImages.length < maxImages : currentImages.length === 0) && (
        <div className="flex items-center gap-2">
          <Input
            id={`upload-${bucket}`}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            multiple={multiple}
            onChange={handleUpload}
            disabled={uploading}
            className="hidden"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => document.getElementById(`upload-${bucket}`)?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <>Caricamento...</>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Carica {multiple && `(${currentImages.length}/${maxImages})`}
              </>
            )}
          </Button>
          {currentImages.length === 0 && (
            <div className="flex items-center text-sm text-muted-foreground">
              <ImageIcon className="mr-2 h-4 w-4" />
              JPEG, PNG, WebP - Max 5MB
            </div>
          )}
        </div>
      )}
    </div>
  )
}
