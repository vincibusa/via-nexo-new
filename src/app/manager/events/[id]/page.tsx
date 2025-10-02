'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeft, Save, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { ImageUpload } from '@/components/ImageUpload'

interface Event {
  id: string
  title: string
  description?: string
  start_datetime: string
  end_datetime: string
  doors_open_time?: string
  event_type: string
  genre?: string[]
  lineup?: string[]
  ticket_price_min?: number
  ticket_price_max?: number
  ticket_url?: string
  tickets_available: boolean
  cover_image_url?: string
  promo_video_url?: string
  verification_status: string
  is_published: boolean
  is_listed: boolean
  is_cancelled: boolean
  embeddings_status: string
  place_id: string
  place: {
    id: string
    name: string
    city: string
  }
  owner: {
    id: string
    display_name: string
    email: string
  }
}

export default function EventEditPage() {
  const router = useRouter()
  const params = useParams()
  const eventId = params.id as string

  const [event, setEvent] = useState<Event | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    fetchEvent()
  }, [eventId])

  const fetchEvent = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/manager/events/${eventId}`)
      if (response.ok) {
        const data = await response.json()
        setEvent(data.event)
      } else {
        toast.error('Errore nel caricamento dell\'evento')
        router.push('/manager/events')
      }
    } catch (error) {
      console.error('Error fetching event:', error)
      toast.error('Errore nel caricamento dell\'evento')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!event) return

    try {
      setSaving(true)
      const response = await fetch(`/api/manager/events/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      })

      if (response.ok) {
        toast.success('Evento aggiornato con successo')
        fetchEvent()
      } else {
        const error = await response.json()
        toast.error(error.error || 'Errore nel salvataggio')
      }
    } catch (error) {
      console.error('Error saving event:', error)
      toast.error('Errore nel salvataggio')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Sei sicuro di voler eliminare questo evento? Questa azione è irreversibile.')) {
      return
    }

    try {
      setDeleting(true)
      const response = await fetch(`/api/manager/events/${eventId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        toast.success('Evento eliminato con successo')
        router.push('/manager/events')
      } else {
        const error = await response.json()
        toast.error(error.error || 'Errore nell\'eliminazione')
      }
    } catch (error) {
      console.error('Error deleting event:', error)
      toast.error('Errore nell\'eliminazione')
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <ProtectedRoute requiredRole="manager">
        <div className="space-y-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-96 w-full" />
        </div>
      </ProtectedRoute>
    )
  }

  if (!event) {
    return null
  }

  return (
    <ProtectedRoute requiredRole="manager">
      <div className="space-y-6">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild className="min-h-[44px] min-w-[44px]">
              <Link href="/manager/events">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold truncate">{event.title}</h1>
              <p className="text-sm sm:text-base text-muted-foreground truncate">
                {event.place?.name} • {event.owner?.display_name || event.owner?.email}
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="destructive" onClick={handleDelete} disabled={deleting} className="min-h-[44px]">
              <Trash2 className="mr-2 h-4 w-4" />
              {deleting ? 'Eliminazione...' : 'Elimina'}
            </Button>
            <Button onClick={handleSave} disabled={saving} className="min-h-[44px]">
              <Save className="mr-2 h-4 w-4" />
              {saving ? 'Salvataggio...' : 'Salva Modifiche'}
            </Button>
          </div>
        </div>

        <Tabs defaultValue="info" className="w-full">
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1 h-auto p-1">
            <TabsTrigger value="info" className="text-xs sm:text-sm p-2">Info</TabsTrigger>
            <TabsTrigger value="images" className="text-xs sm:text-sm p-2">Foto</TabsTrigger>
            <TabsTrigger value="datetime" className="text-xs sm:text-sm p-2">Data/Ora</TabsTrigger>
            <TabsTrigger value="tickets" className="text-xs sm:text-sm p-2">Biglietti</TabsTrigger>
            <TabsTrigger value="details" className="text-xs sm:text-sm p-2">Dettagli</TabsTrigger>
            <TabsTrigger value="status" className="text-xs sm:text-sm p-2">Stato</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Informazioni Base</CardTitle>
                <CardDescription>Titolo, tipo e descrizione dell'evento</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="title">Titolo Evento *</Label>
                  <Input
                    id="title"
                    value={event.title}
                    onChange={(e) => setEvent({ ...event, title: e.target.value })}
                    className="min-h-[44px]"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="event_type">Tipo Evento *</Label>
                  <Select
                    value={event.event_type}
                    onValueChange={(value) => setEvent({ ...event, event_type: value })}
                  >
                    <SelectTrigger id="event_type" className="min-h-[44px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="concert">Concerto</SelectItem>
                      <SelectItem value="dj_set">DJ Set</SelectItem>
                      <SelectItem value="live_music">Live Music</SelectItem>
                      <SelectItem value="party">Festa</SelectItem>
                      <SelectItem value="aperitivo">Aperitivo</SelectItem>
                      <SelectItem value="special">Evento Speciale</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Descrizione</Label>
                  <Textarea
                    id="description"
                    value={event.description || ''}
                    onChange={(e) => setEvent({ ...event, description: e.target.value })}
                    rows={4}
                    className="min-h-[100px] resize-none"
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="images" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Immagini</CardTitle>
                <CardDescription>Carica immagine di copertina e video promo</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <ImageUpload
                  bucket="event-images"
                  value={event.cover_image_url}
                  onChange={(url) => setEvent({ ...event, cover_image_url: url as string })}
                  label="Immagine di Copertina"
                  description="Questa sarà l'immagine principale dell'evento"
                />

                <div className="border-t pt-6">
                  <Label htmlFor="promo_video_url">Video Promo URL (YouTube/Vimeo)</Label>
                  <Input
                    id="promo_video_url"
                    type="url"
                    value={event.promo_video_url || ''}
                    onChange={(e) => setEvent({ ...event, promo_video_url: e.target.value })}
                    placeholder="https://youtube.com/watch?v=..."
                    className="min-h-[44px]"
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="datetime" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Data e Ora</CardTitle>
                <CardDescription>Orari dell'evento</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="start_datetime">Data e Ora Inizio *</Label>
                  <Input
                    id="start_datetime"
                    type="datetime-local"
                    value={event.start_datetime ? new Date(event.start_datetime).toISOString().slice(0, 16) : ''}
                    onChange={(e) => setEvent({ ...event, start_datetime: new Date(e.target.value).toISOString() })}
                    className="min-h-[44px]"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="end_datetime">Data e Ora Fine *</Label>
                  <Input
                    id="end_datetime"
                    type="datetime-local"
                    value={event.end_datetime ? new Date(event.end_datetime).toISOString().slice(0, 16) : ''}
                    onChange={(e) => setEvent({ ...event, end_datetime: new Date(e.target.value).toISOString() })}
                    className="min-h-[44px]"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="doors_open_time">Orario Apertura Porte</Label>
                  <Input
                    id="doors_open_time"
                    type="time"
                    value={event.doors_open_time || ''}
                    onChange={(e) => setEvent({ ...event, doors_open_time: e.target.value })}
                    className="min-h-[44px]"
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tickets" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Biglietti</CardTitle>
                <CardDescription>Informazioni su biglietti e prenotazioni</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="tickets_available"
                    checked={event.tickets_available}
                    onCheckedChange={(checked) =>
                      setEvent({ ...event, tickets_available: checked as boolean })
                    }
                  />
                  <Label htmlFor="tickets_available" className="cursor-pointer">
                    Biglietti disponibili
                  </Label>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="ticket_price_min">Prezzo Minimo (€)</Label>
                    <Input
                      id="ticket_price_min"
                      type="number"
                      step="0.01"
                      value={event.ticket_price_min ?? ''}
                      onChange={(e) => setEvent({ ...event, ticket_price_min: e.target.value ? parseFloat(e.target.value) : undefined })}
                      placeholder="10.00"
                      className="min-h-[44px]"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ticket_price_max">Prezzo Massimo (€)</Label>
                    <Input
                      id="ticket_price_max"
                      type="number"
                      step="0.01"
                      value={event.ticket_price_max ?? ''}
                      onChange={(e) => setEvent({ ...event, ticket_price_max: e.target.value ? parseFloat(e.target.value) : undefined })}
                      placeholder="25.00"
                      className="min-h-[44px]"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ticket_url">Link Biglietti</Label>
                  <Input
                    id="ticket_url"
                    type="url"
                    value={event.ticket_url || ''}
                    onChange={(e) => setEvent({ ...event, ticket_url: e.target.value })}
                    placeholder="https://ticketmaster.it/..."
                    className="min-h-[44px]"
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="details" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Dettagli</CardTitle>
                <CardDescription>Generi musicali e lineup</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Generi Musicali</Label>
                  <Input
                    value={event.genre?.join(', ') || ''}
                    onChange={(e) =>
                      setEvent({
                        ...event,
                        genre: e.target.value.split(',').map((t) => t.trim()).filter(Boolean),
                      })
                    }
                    placeholder="es: house, techno, elettronica"
                    className="min-h-[44px]"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Separati da virgola</p>
                </div>

                <div className="space-y-2">
                  <Label>Lineup (Artisti/DJ)</Label>
                  <Textarea
                    value={event.lineup?.join('\n') || ''}
                    onChange={(e) =>
                      setEvent({
                        ...event,
                        lineup: e.target.value.split('\n').map((t) => t.trim()).filter(Boolean),
                      })
                    }
                    placeholder="Un artista per riga&#10;DJ Nome&#10;Live Band"
                    rows={4}
                    className="min-h-[100px] resize-none"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Un artista per riga</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="status" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Stato e Pubblicazione</CardTitle>
                <CardDescription>Gestisci verifica e visibilità dell'evento</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="verification_status">Stato Verifica</Label>
                  <Select
                    value={event.verification_status}
                    onValueChange={(value) => setEvent({ ...event, verification_status: value })}
                  >
                    <SelectTrigger id="verification_status" className="min-h-[44px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">In attesa</SelectItem>
                      <SelectItem value="approved">Approvato</SelectItem>
                      <SelectItem value="rejected">Rifiutato</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="is_published"
                    checked={event.is_published}
                    onCheckedChange={(checked) =>
                      setEvent({ ...event, is_published: checked as boolean })
                    }
                  />
                  <Label htmlFor="is_published" className="cursor-pointer">
                    Pubblicato (visibile nell'app)
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="is_listed"
                    checked={event.is_listed}
                    onCheckedChange={(checked) =>
                      setEvent({ ...event, is_listed: checked as boolean })
                    }
                  />
                  <Label htmlFor="is_listed" className="cursor-pointer">
                    Elencato nelle ricerche
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="is_cancelled"
                    checked={event.is_cancelled}
                    onCheckedChange={(checked) =>
                      setEvent({ ...event, is_cancelled: checked as boolean })
                    }
                  />
                  <Label htmlFor="is_cancelled" className="cursor-pointer">
                    Evento cancellato
                  </Label>
                </div>

                <div className="pt-4 border-t space-y-2">
                  <Label>Stato Embeddings</Label>
                  <div>
                    <Badge
                      className={
                        event.embeddings_status === 'completed'
                          ? 'bg-green-500'
                          : event.embeddings_status === 'failed'
                          ? 'bg-red-500'
                          : 'bg-gray-400'
                      }
                    >
                      {event.embeddings_status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Se modifichi campi semantici (titolo, descrizione, generi, lineup), gli embeddings verranno ricalcolati
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </ProtectedRoute>
  )
}
