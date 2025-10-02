'use client'

import { useState } from 'react'
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

interface PlaceForm {
  name: string
  place_type: string
  description: string
  address: string
  city: string
  postal_code: string
  lat: number | null
  lon: number | null
  phone: string
  website: string
  instagram_handle: string
  facebook_url: string
  price_range: string
  ambience_tags: string[]
  music_genre: string[]
  capacity: number | null
  is_published: boolean
  is_listed: boolean
  cover_image_url: string
  image_urls: string[]
}

export default function NewPlacePage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<PlaceForm>({
    name: '',
    place_type: 'bar',
    description: '',
    address: '',
    city: '',
    postal_code: '',
    lat: null,
    lon: null,
    phone: '',
    website: '',
    instagram_handle: '',
    facebook_url: '',
    price_range: '€€',
    ambience_tags: [],
    music_genre: [],
    capacity: null,
    is_published: false,
    is_listed: true,
    cover_image_url: '',
    image_urls: [],
  })

  const handleSubmit = async () => {
    // Validate required fields
    if (!form.name || !form.address || !form.city || form.lat === null || form.lon === null) {
      toast.error('Compila tutti i campi obbligatori (Nome, Indirizzo, Città, Coordinate)')
      return
    }

    try {
      setSaving(true)
      const response = await fetch('/api/manager/places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      if (response.ok) {
        const data = await response.json()
        toast.success('Locale creato con successo')
        router.push(`/manager/places/${data.place.id}`)
      } else {
        const error = await response.json()
        toast.error(error.error || 'Errore nella creazione')
      }
    } catch (error) {
      console.error('Error creating place:', error)
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
              <Link href="/manager/places">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold">Nuovo Locale</h1>
              <p className="text-sm sm:text-base text-muted-foreground">Crea un nuovo locale nella piattaforma</p>
            </div>
          </div>
          <Button onClick={handleSubmit} disabled={saving} className="min-h-[44px] w-full sm:w-auto">
            <Save className="mr-2 h-4 w-4" />
            {saving ? 'Creazione...' : 'Crea Locale'}
          </Button>
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
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Es: La Bottega del Caffè"
                    className="min-h-[44px]"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="place_type">Categoria *</Label>
                  <Select
                    value={form.place_type}
                    onValueChange={(value) => setForm({ ...form, place_type: value })}
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
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    rows={4}
                    placeholder="Descrivi il locale, l'atmosfera, le specialità..."
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
                  value={form.cover_image_url}
                  onChange={(url) => setForm({ ...form, cover_image_url: url as string })}
                  label="Immagine di Copertina"
                  description="Questa sarà l'immagine principale del locale"
                />

                <div className="border-t pt-6">
                  <ImageUpload
                    bucket="place-images"
                    value={form.image_urls}
                    onChange={(urls) => setForm({ ...form, image_urls: urls as string[] })}
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
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    placeholder="Via Roma, 123"
                    className="min-h-[44px]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="city">Città *</Label>
                    <Input
                      id="city"
                      value={form.city}
                      onChange={(e) => setForm({ ...form, city: e.target.value })}
                      placeholder="Milano"
                      className="min-h-[44px]"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="postal_code">CAP</Label>
                    <Input
                      id="postal_code"
                      value={form.postal_code}
                      onChange={(e) => setForm({ ...form, postal_code: e.target.value })}
                      placeholder="20100"
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
                      value={form.lat ?? ''}
                      onChange={(e) => setForm({ ...form, lat: e.target.value ? parseFloat(e.target.value) : null })}
                      placeholder="45.4642"
                      className="min-h-[44px]"
                      inputMode="decimal"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lon">Longitudine *</Label>
                    <Input
                      id="lon"
                      type="number"
                      step="any"
                      value={form.lon ?? ''}
                      onChange={(e) => setForm({ ...form, lon: e.target.value ? parseFloat(e.target.value) : null })}
                      placeholder="9.1900"
                      className="min-h-[44px]"
                      inputMode="decimal"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Puoi usare <a href="https://www.google.com/maps" target="_blank" rel="noopener noreferrer" className="underline">Google Maps</a> per trovare le coordinate
                </p>
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
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="+39 02 1234567"
                    className="min-h-[44px]"
                    inputMode="tel"
                    type="tel"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="website">Sito Web</Label>
                  <Input
                    id="website"
                    type="url"
                    value={form.website}
                    onChange={(e) => setForm({ ...form, website: e.target.value })}
                    placeholder="https://www.esempio.it"
                    className="min-h-[44px]"
                    inputMode="url"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="instagram">Instagram Handle (senza @)</Label>
                  <Input
                    id="instagram"
                    value={form.instagram_handle}
                    onChange={(e) => setForm({ ...form, instagram_handle: e.target.value })}
                    placeholder="nome_locale"
                    className="min-h-[44px]"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="facebook">Facebook URL</Label>
                  <Input
                    id="facebook"
                    type="url"
                    value={form.facebook_url}
                    onChange={(e) => setForm({ ...form, facebook_url: e.target.value })}
                    placeholder="https://facebook.com/nomelocale"
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
                <CardDescription>Fascia prezzo, atmosfera, genere musicale</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="price_range">Fascia di Prezzo</Label>
                  <Select
                    value={form.price_range}
                    onValueChange={(value) => setForm({ ...form, price_range: value })}
                  >
                    <SelectTrigger id="price_range" className="min-h-[44px]">
                      <SelectValue />
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
                    value={form.capacity ?? ''}
                    onChange={(e) => setForm({ ...form, capacity: e.target.value ? parseInt(e.target.value) : null })}
                    placeholder="100"
                    className="min-h-[44px]"
                    inputMode="numeric"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Atmosfera (Tags)</Label>
                  <Input
                    value={form.ambience_tags.join(', ')}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        ambience_tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean),
                      })
                    }
                    placeholder="es: romantico, energico, rilassante"
                    className="min-h-[44px]"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Separati da virgola</p>
                </div>

                <div className="space-y-2">
                  <Label>Generi Musicali</Label>
                  <Input
                    value={form.music_genre.join(', ')}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        music_genre: e.target.value.split(',').map((t) => t.trim()).filter(Boolean),
                      })
                    }
                    placeholder="es: pop, rock, elettronica"
                    className="min-h-[44px]"
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
                <CardDescription>Configura verifica e visibilità del locale</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">
                    Il tuo locale sarà sottoposto a verifica da parte del team di Nexo prima di essere pubblicato.
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
                    Gli embeddings verranno generati automaticamente dopo la creazione del locale.
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
