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

interface Place {
  id: string
  name: string
  place_type: string
  description?: string
  address: string
  city: string
  postal_code?: string
  lat: number
  lon: number
  phone?: string
  website?: string
  instagram_handle?: string
  facebook_url?: string
  price_range?: string
  ambience_tags?: string[]
  music_genre?: string[]
  capacity?: number
  opening_hours?: any
  verification_status?: string
  is_published: boolean
  is_listed: boolean
  cover_image_url?: string
  image_urls?: string[]
  embeddings_status: string
  owner: {
    id: string
    display_name: string
    email: string
  }
}

export default function PlaceEditPage() {
  const router = useRouter()
  const params = useParams()
  const placeId = params.id as string

  const [place, setPlace] = useState<Place | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    fetchPlace()
  }, [placeId])

  const fetchPlace = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/manager/places/${placeId}`)
      if (response.ok) {
        const data = await response.json()
        setPlace(data.place)
      } else {
        toast.error('Errore nel caricamento del locale')
        router.push('/manager/places')
      }
    } catch (error) {
      console.error('Error fetching place:', error)
      toast.error('Errore nel caricamento del locale')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!place) return

    try {
      setSaving(true)
      const response = await fetch(`/api/manager/places/${placeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(place),
      })

      if (response.ok) {
        toast.success('Locale aggiornato con successo')
        fetchPlace()
      } else {
        const error = await response.json()
        toast.error(error.error || 'Errore nel salvataggio')
      }
    } catch (error) {
      console.error('Error saving place:', error)
      toast.error('Errore nel salvataggio')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Sei sicuro di voler eliminare questo locale? Questa azione è irreversibile.')) {
      return
    }

    try {
      setDeleting(true)
      const response = await fetch(`/api/manager/places/${placeId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        toast.success('Locale eliminato con successo')
        router.push('/manager/places')
      } else {
        const error = await response.json()
        toast.error(error.error || 'Errore nell\'eliminazione')
      }
    } catch (error) {
      console.error('Error deleting place:', error)
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

  if (!place) {
    return null
  }

  return (
    <ProtectedRoute requiredRole="manager">
      <div className="space-y-6">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild className="min-h-[44px] min-w-[44px]">
              <Link href="/manager/places">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold truncate">{place.name}</h1>
              <p className="text-sm sm:text-base text-muted-foreground truncate">
                Manager: {place.owner?.display_name || place.owner?.email}
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
            <TabsTrigger value="location" className="text-xs sm:text-sm p-2">Posizione</TabsTrigger>
            <TabsTrigger value="contacts" className="text-xs sm:text-sm p-2">Contatti</TabsTrigger>
            <TabsTrigger value="details" className="text-xs sm:text-sm p-2">Dettagli</TabsTrigger>
            <TabsTrigger value="status" className="text-xs sm:text-sm p-2">Stato</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Informazioni Base</CardTitle>
                <CardDescription>Nome, categoria e descrizione del locale</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nome Locale *</Label>
                  <Input
                    id="name"
                    value={place.name}
                    onChange={(e) => setPlace({ ...place, name: e.target.value })}
                    className="min-h-[44px]"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="place_type">Categoria *</Label>
                  <Select
                    value={place.place_type}
                    onValueChange={(value) => setPlace({ ...place, place_type: value })}
                  >
                    <SelectTrigger id="place_type" className="min-h-[44px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bar">Bar</SelectItem>
                      <SelectItem value="pub">Pub</SelectItem>
                      <SelectItem value="club">Club</SelectItem>
                      <SelectItem value="restaurant">Ristorante</SelectItem>
                      <SelectItem value="lounge">Lounge</SelectItem>
                      <SelectItem value="cafe">Caffetteria</SelectItem>
                      <SelectItem value="wine_bar">Enoteca</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Descrizione</Label>
                  <Textarea
                    id="description"
                    value={place.description || ''}
                    onChange={(e) => setPlace({ ...place, description: e.target.value })}
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
                <CardDescription>Carica immagini del locale</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <ImageUpload
                  bucket="place-images"
                  value={place.cover_image_url}
                  onChange={(url) => setPlace({ ...place, cover_image_url: url as string })}
                  label="Immagine di Copertina"
                  description="Questa sarà l'immagine principale del locale"
                />

                <div className="border-t pt-6">
                  <ImageUpload
                    bucket="place-images"
                    value={place.image_urls || []}
                    onChange={(urls) => setPlace({ ...place, image_urls: urls as string[] })}
                    multiple
                    maxImages={10}
                    label="Galleria Immagini"
                    description="Carica fino a 10 immagini aggiuntive"
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="location" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Posizione</CardTitle>
                <CardDescription>Indirizzo e coordinate geografiche</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="address">Indirizzo *</Label>
                  <Input
                    id="address"
                    value={place.address}
                    onChange={(e) => setPlace({ ...place, address: e.target.value })}
                    className="min-h-[44px]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="city">Città *</Label>
                    <Input
                      id="city"
                      value={place.city}
                      onChange={(e) => setPlace({ ...place, city: e.target.value })}
                      className="min-h-[44px]"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="postal_code">CAP</Label>
                    <Input
                      id="postal_code"
                      value={place.postal_code || ''}
                      onChange={(e) => setPlace({ ...place, postal_code: e.target.value })}
                      className="min-h-[44px]"
                      inputMode="numeric"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="lat">Latitudine *</Label>
                    <Input
                      id="lat"
                      type="number"
                      step="any"
                      value={place.lat}
                      onChange={(e) => setPlace({ ...place, lat: parseFloat(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lon">Longitudine *</Label>
                    <Input
                      id="lon"
                      type="number"
                      step="any"
                      value={place.lon}
                      onChange={(e) => setPlace({ ...place, lon: parseFloat(e.target.value) })}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="contacts" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Contatti</CardTitle>
                <CardDescription>Telefono, sito web e social media</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="phone">Telefono</Label>
                  <Input
                    id="phone"
                    value={place.phone || ''}
                    onChange={(e) => setPlace({ ...place, phone: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="website">Sito Web</Label>
                  <Input
                    id="website"
                    type="url"
                    value={place.website || ''}
                    onChange={(e) => setPlace({ ...place, website: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="instagram">Instagram Handle (senza @)</Label>
                  <Input
                    id="instagram"
                    value={place.instagram_handle || ''}
                    onChange={(e) => setPlace({ ...place, instagram_handle: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="facebook">Facebook URL</Label>
                  <Input
                    id="facebook"
                    type="url"
                    value={place.facebook_url || ''}
                    onChange={(e) => setPlace({ ...place, facebook_url: e.target.value })}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="details" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Dettagli</CardTitle>
                <CardDescription>Fascia prezzo, atmosfera, genere musicale</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="price_range">Fascia di Prezzo</Label>
                  <Select
                    value={place.price_range || ''}
                    onValueChange={(value) => setPlace({ ...place, price_range: value })}
                  >
                    <SelectTrigger id="price_range">
                      <SelectValue placeholder="Seleziona..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="€">€ - Economico</SelectItem>
                      <SelectItem value="€€">€€ - Medio</SelectItem>
                      <SelectItem value="€€€">€€€ - Alto</SelectItem>
                      <SelectItem value="€€€€">€€€€ - Lusso</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="capacity">Capacità (persone)</Label>
                  <Input
                    id="capacity"
                    type="number"
                    value={place.capacity || ''}
                    onChange={(e) => setPlace({ ...place, capacity: parseInt(e.target.value) || undefined })}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Atmosfera (Tags)</Label>
                  <Input
                    value={place.ambience_tags?.join(', ') || ''}
                    onChange={(e) =>
                      setPlace({
                        ...place,
                        ambience_tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean),
                      })
                    }
                    placeholder="es: romantico, energico, rilassante"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Separati da virgola</p>
                </div>

                <div className="space-y-2">
                  <Label>Generi Musicali</Label>
                  <Input
                    value={place.music_genre?.join(', ') || ''}
                    onChange={(e) =>
                      setPlace({
                        ...place,
                        music_genre: e.target.value.split(',').map((t) => t.trim()).filter(Boolean),
                      })
                    }
                    placeholder="es: pop, rock, elettronica"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Separati da virgola</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="status" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Stato e Pubblicazione</CardTitle>
                <CardDescription>Gestisci verifica e visibilità del locale</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label>Stato Verifica</Label>
                  <div className="flex items-center gap-2">
                    <Badge variant={place.verification_status === 'approved' ? 'default' : place.verification_status === 'rejected' ? 'destructive' : 'secondary'}>
                      {place.verification_status === 'approved' ? 'Verificato' : place.verification_status === 'rejected' ? 'Rifiutato' : 'In Attesa'}
                    </Badge>
                    {place.verification_status === 'pending' && (
                      <span className="text-sm text-muted-foreground">Il tuo locale è in attesa di verifica</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="is_published"
                    checked={place.is_published}
                    onCheckedChange={(checked) =>
                      setPlace({ ...place, is_published: checked as boolean })
                    }
                  />
                  <Label htmlFor="is_published" className="cursor-pointer">
                    Pubblicato (visibile nell'app)
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="is_listed"
                    checked={place.is_listed}
                    onCheckedChange={(checked) =>
                      setPlace({ ...place, is_listed: checked as boolean })
                    }
                  />
                  <Label htmlFor="is_listed" className="cursor-pointer">
                    Elencato nelle ricerche
                  </Label>
                </div>

                <div className="pt-4 border-t space-y-2">
                  <Label>Stato Embeddings</Label>
                  <div>
                    <Badge
                      className={
                        place.embeddings_status === 'completed'
                          ? 'bg-green-500 dark:bg-green-600 text-white'
                          : place.embeddings_status === 'failed'
                          ? 'bg-red-500 dark:bg-red-600 text-white'
                          : 'bg-gray-400 dark:bg-gray-600 text-white'
                      }
                    >
                      {place.embeddings_status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Se modifichi campi semantici (nome, descrizione, tags), gli embeddings verranno ricalcolati
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
