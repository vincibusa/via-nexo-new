'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowLeft, Save, Upload } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ProtectedRoute } from '@/components/ProtectedRoute'

interface DiscoveryForm {
  media_url: string
  media_type: 'image' | 'video'
  thumbnail_url: string
  event_id: string
  title: string
  description: string
  display_order: number
  is_active: boolean
}

interface Event {
  id: string
  title: string
}

export default function NewDiscoveryPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [events, setEvents] = useState<Event[]>([])
  const [loadingEvents, setLoadingEvents] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [form, setForm] = useState<DiscoveryForm>({
    media_url: '',
    media_type: 'image',
    thumbnail_url: '',
    event_id: '',
    title: '',
    description: '',
    display_order: 0,
    is_active: true,
  })

  useEffect(() => {
    fetchEvents()
  }, [])

  const fetchEvents = async () => {
    try {
      setLoadingEvents(true)
      const response = await fetch('/api/admin/events?limit=1000&filter=all')
      if (response.ok) {
        const data = await response.json()
        setEvents(data.events || [])
      }
    } catch (error) {
      console.error('Error fetching events:', error)
      toast.error('Errore nel caricamento degli eventi')
    } finally {
      setLoadingEvents(false)
    }
  }

  const handleFileUpload = async (file: File, type: 'image' | 'video') => {
    try {
      setUploading(true)
      const formData = new FormData()
      formData.append('file', file)
      // Use discovery-videos bucket for videos, place-images for images
      formData.append('bucket', type === 'video' ? 'discovery-videos' : 'place-images')

      const response = await fetch('/api/admin/upload', {
        method: 'POST',
        body: formData,
      })

      if (response.ok) {
        const data = await response.json()
        setForm({ ...form, media_url: data.url, media_type: type })
        if (type === 'image') {
          setForm(prev => ({ ...prev, thumbnail_url: data.url }))
        }
        toast.success('File caricato con successo')
      } else {
        const error = await response.json()
        toast.error(error.error || 'Errore nel caricamento del file')
      }
    } catch (error) {
      console.error('Error uploading file:', error)
      toast.error('Errore nel caricamento del file')
    } finally {
      setUploading(false)
    }
  }

  const handleSubmit = async () => {
    if (!form.media_url || !form.event_id) {
      toast.error('Compila tutti i campi obbligatori (File media, Evento)')
      return
    }

    try {
      setSaving(true)
      const response = await fetch('/api/admin/discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      if (response.ok) {
        toast.success('Contenuto Discovery creato con successo')
        router.push('/admin/discovery')
      } else {
        const error = await response.json()
        toast.error(error.error || 'Errore nella creazione')
      }
    } catch (error) {
      console.error('Error creating discovery item:', error)
      toast.error('Errore nella creazione')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ProtectedRoute requiredRole="admin">
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild className="min-h-[44px] min-w-[44px]">
              <Link href="/admin/discovery">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold">Nuovo Contenuto Discovery</h1>
              <p className="text-sm sm:text-base text-muted-foreground">
                Aggiungi un nuovo contenuto al feed Discovery
              </p>
            </div>
          </div>
          <Button onClick={handleSubmit} disabled={saving || uploading} className="min-h-[44px] w-full sm:w-auto">
            <Save className="mr-2 h-4 w-4" />
            {saving ? 'Creazione...' : 'Crea Contenuto'}
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Dettagli Contenuto</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Media Upload */}
            <div className="space-y-4">
              <Label>Media *</Label>
              <div className="space-y-4">
                <div className="flex gap-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const input = document.createElement('input')
                      input.type = 'file'
                      input.accept = 'image/*'
                      input.onchange = (e) => {
                        const file = (e.target as HTMLInputElement).files?.[0]
                        if (file) handleFileUpload(file, 'image')
                      }
                      input.click()
                    }}
                    disabled={uploading}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    {uploading ? 'Caricamento...' : 'Carica Immagine'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const input = document.createElement('input')
                      input.type = 'file'
                      input.accept = 'video/*'
                      input.onchange = (e) => {
                        const file = (e.target as HTMLInputElement).files?.[0]
                        if (file) handleFileUpload(file, 'video')
                      }
                      input.click()
                    }}
                    disabled={uploading}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    {uploading ? 'Caricamento...' : 'Carica Video'}
                  </Button>
                </div>
                {form.media_url && (
                  <div className="mt-4">
                    {form.media_type === 'video' ? (
                      <video src={form.media_url} controls className="max-w-full h-64 rounded border" />
                    ) : (
                      <img src={form.media_url} alt="Preview" className="max-w-full h-64 object-contain rounded border" />
                    )}
                  </div>
                )}
                <Input
                  placeholder="Oppure inserisci URL diretto"
                  value={form.media_url}
                  onChange={(e) => setForm({ ...form, media_url: e.target.value })}
                  className="min-h-[44px]"
                />
              </div>
            </div>

            {/* Event Selection */}
            <div className="space-y-2">
              <Label htmlFor="event_id">Evento Collegato *</Label>
              <Select
                value={form.event_id}
                onValueChange={(value) => setForm({ ...form, event_id: value })}
              >
                <SelectTrigger id="event_id" className="min-h-[44px]">
                  <SelectValue placeholder={loadingEvents ? 'Caricamento...' : 'Seleziona un evento'} />
                </SelectTrigger>
                <SelectContent>
                  {events.map((event) => (
                    <SelectItem key={event.id} value={event.id}>
                      {event.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">Titolo (Opzionale)</Label>
              <Input
                id="title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Titolo del contenuto"
                className="min-h-[44px]"
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Descrizione (Opzionale)</Label>
              <Textarea
                id="description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Descrizione del contenuto"
                rows={4}
              />
            </div>

            {/* Display Order */}
            <div className="space-y-2">
              <Label htmlFor="display_order">Ordine di Visualizzazione</Label>
              <Input
                id="display_order"
                type="number"
                value={form.display_order}
                onChange={(e) => setForm({ ...form, display_order: parseInt(e.target.value) || 0 })}
                className="min-h-[44px]"
              />
              <p className="text-sm text-muted-foreground">
                Numeri più alti appaiono per primi. Lascia 0 per aggiungere in cima.
              </p>
            </div>

            {/* Active Status */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="is_active"
                checked={form.is_active}
                onCheckedChange={(checked) => setForm({ ...form, is_active: checked === true })}
              />
              <Label htmlFor="is_active" className="cursor-pointer">
                Contenuto attivo (visibile nel feed)
              </Label>
            </div>
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  )
}

