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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ArrowLeft, Save } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { ImageUpload } from '@/components/ImageUpload'

interface EventForm {
  title: string
  description: string
  start_datetime: string
  end_datetime: string
  doors_open_time: string
  event_type: string
  genre: string[]
  lineup: string[]
  ticket_price_min: number | null
  ticket_price_max: number | null
  ticket_url: string
  tickets_available: boolean
  cover_image_url: string
  promo_video_url: string
  place_id: string
  verification_status: string
  is_published: boolean
  is_listed: boolean
  is_cancelled: boolean
}

interface Place {
  id: string
  name: string
  city: string
}

export default function NewEventPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [places, setPlaces] = useState<Place[]>([])
  const [loadingPlaces, setLoadingPlaces] = useState(true)
  const [form, setForm] = useState<EventForm>({
    title: '',
    description: '',
    start_datetime: '',
    end_datetime: '',
    doors_open_time: '',
    event_type: 'party',
    genre: [],
    lineup: [],
    ticket_price_min: null,
    ticket_price_max: null,
    ticket_url: '',
    tickets_available: true,
    cover_image_url: '',
    promo_video_url: '',
    place_id: '',
    verification_status: 'approved',
    is_published: false,
    is_listed: true,
    is_cancelled: false,
  })

  useEffect(() => {
    fetchPlaces()
  }, [])

  const fetchPlaces = async () => {
    try {
      setLoadingPlaces(true)
      const response = await fetch('/api/manager/places?limit=1000')
      if (response.ok) {
        const data = await response.json()
        setPlaces(data.places || [])
      }
    } catch (error) {
      console.error('Error fetching places:', error)
      toast.error('Errore nel caricamento dei locali')
    } finally {
      setLoadingPlaces(false)
    }
  }

  const handleSubmit = async () => {
    // Validate required fields
    if (!form.title || !form.place_id || !form.start_datetime || !form.end_datetime) {
      toast.error('Compila tutti i campi obbligatori (Titolo, Locale, Data Inizio, Data Fine)')
      return
    }

    // Validate dates
    if (new Date(form.end_datetime) <= new Date(form.start_datetime)) {
      toast.error('La data di fine deve essere successiva alla data di inizio')
      return
    }

    try {
      setSaving(true)
      const response = await fetch('/api/manager/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      if (response.ok) {
        const data = await response.json()
        toast.success('Evento creato con successo')
        router.push(`/manager/events/${data.event.id}`)
      } else {
        const error = await response.json()
        toast.error(error.error || 'Errore nella creazione')
      }
    } catch (error) {
      console.error('Error creating event:', error)
      toast.error('Errore nella creazione')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ProtectedRoute requiredRole="manager">
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild className="min-h-[44px] min-w-[44px]">
              <Link href="/manager/events">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold">Nuovo Evento</h1>
              <p className="text-sm sm:text-base text-muted-foreground">Crea un nuovo evento nella piattaforma</p>
            </div>
          </div>
          <Button onClick={handleSubmit} disabled={saving} className="min-h-[44px] w-full sm:w-auto">
            <Save className="mr-2 h-4 w-4" />
            {saving ? 'Creazione...' : 'Crea Evento'}
          </Button>
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
                <CardDescription>Titolo, locale e descrizione dell'evento</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="title">Titolo Evento *</Label>
                  <Input
                    id="title"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="Es: Sabato Notte Dance"
                    className="min-h-[44px]"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="place_id">Locale *</Label>
                  <Select
                    value={form.place_id}
                    onValueChange={(value) => setForm({ ...form, place_id: value })}
                  >
                    <SelectTrigger id="place_id" className="min-h-[44px]">
                      <SelectValue placeholder={loadingPlaces ? 'Caricamento...' : 'Seleziona un locale'} />
                    </SelectTrigger>
                    <SelectContent>
                      {places.map((place) => (
                        <SelectItem key={place.id} value={place.id}>
                          {place.name} - {place.city}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="event_type">Tipo Evento *</Label>
                  <Select
                    value={form.event_type}
                    onValueChange={(value) => setForm({ ...form, event_type: value })}
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
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    rows={4}
                    placeholder="Descrivi l'evento, l'atmosfera, cosa aspettarsi..."
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
                  value={form.cover_image_url}
                  onChange={(url) => setForm({ ...form, cover_image_url: url as string })}
                  label="Immagine di Copertina"
                  description="Questa sarà l'immagine principale dell'evento"
                />

                <div className="border-t pt-6 space-y-2">
                  <Label htmlFor="promo_video_url">Video Promo URL (YouTube/Vimeo)</Label>
                  <Input
                    id="promo_video_url"
                    type="url"
                    value={form.promo_video_url}
                    onChange={(e) => setForm({ ...form, promo_video_url: e.target.value })}
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
                    value={form.start_datetime}
                    onChange={(e) => setForm({ ...form, start_datetime: e.target.value })}
                    className="min-h-[44px]"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="end_datetime">Data e Ora Fine *</Label>
                  <Input
                    id="end_datetime"
                    type="datetime-local"
                    value={form.end_datetime}
                    onChange={(e) => setForm({ ...form, end_datetime: e.target.value })}
                    className="min-h-[44px]"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="doors_open_time">Orario Apertura Porte</Label>
                  <Input
                    id="doors_open_time"
                    type="time"
                    value={form.doors_open_time}
                    onChange={(e) => setForm({ ...form, doors_open_time: e.target.value })}
                    placeholder="22:00"
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
                    checked={form.tickets_available}
                    onCheckedChange={(checked) =>
                      setForm({ ...form, tickets_available: checked as boolean })
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
                      value={form.ticket_price_min ?? ''}
                      onChange={(e) => setForm({ ...form, ticket_price_min: e.target.value ? parseFloat(e.target.value) : null })}
                      placeholder="10.00"
                      className="min-h-[44px]"
                      inputMode="decimal"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ticket_price_max">Prezzo Massimo (€)</Label>
                    <Input
                      id="ticket_price_max"
                      type="number"
                      step="0.01"
                      value={form.ticket_price_max ?? ''}
                      onChange={(e) => setForm({ ...form, ticket_price_max: e.target.value ? parseFloat(e.target.value) : null })}
                      placeholder="25.00"
                      className="min-h-[44px]"
                      inputMode="decimal"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ticket_url">Link Biglietti</Label>
                  <Input
                    id="ticket_url"
                    type="url"
                    value={form.ticket_url}
                    onChange={(e) => setForm({ ...form, ticket_url: e.target.value })}
                    placeholder="https://ticketmaster.it/..."
                    className="min-h-[44px]"
                    inputMode="url"
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
                    value={form.genre.join(', ')}
                    onChange={(e) =>
                      setForm({
                        ...form,
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
                    value={form.lineup.join('\n')}
                    onChange={(e) =>
                      setForm({
                        ...form,
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
                <CardDescription>Configura verifica e visibilità dell'evento</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="verification_status">Stato Verifica</Label>
                  <Select
                    value={form.verification_status}
                    onValueChange={(value) => setForm({ ...form, verification_status: value })}
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
                  <p className="text-xs text-muted-foreground mt-1">
                    Come admin, puoi creare eventi già approvati
                  </p>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="is_published"
                    checked={form.is_published}
                    onCheckedChange={(checked) =>
                      setForm({ ...form, is_published: checked as boolean })
                    }
                  />
                  <Label htmlFor="is_published" className="cursor-pointer">
                    Pubblicato (visibile nell'app)
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="is_listed"
                    checked={form.is_listed}
                    onCheckedChange={(checked) =>
                      setForm({ ...form, is_listed: checked as boolean })
                    }
                  />
                  <Label htmlFor="is_listed" className="cursor-pointer">
                    Elencato nelle ricerche
                  </Label>
                </div>

                <div className="pt-4 border-t">
                  <p className="text-sm text-muted-foreground">
                    Gli embeddings verranno generati automaticamente dopo la creazione dell'evento.
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
