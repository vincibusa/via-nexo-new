'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import { Plus, Search, Trash2, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'

interface Place {
  id: string
  name: string
  address: string
  city: string
  place_type: string
  verification_status: string
  is_published: boolean
  is_listed: boolean
  embeddings_status: string
  created_at: string
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export default function ManagerPlacesListPage() {
  const [places, setPlaces] = useState<Place[]>([])
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  })
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [category, setCategory] = useState('all')
  const [selectedPlaces, setSelectedPlaces] = useState<string[]>([])
  const [bulkActionLoading, setBulkActionLoading] = useState(false)

  useEffect(() => {
    fetchPlaces()
  }, [pagination.page, pagination.limit, filter, category])

  const fetchPlaces = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        search,
        filter,
        ...(category !== 'all' && { category }),
      })

      const response = await fetch(`/api/manager/places?${params}`)
      if (response.ok) {
        const data = await response.json()
        setPlaces(data.places)
        setPagination(data.pagination)
      }
    } catch (error) {
      console.error('Error fetching places:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = () => {
    setPagination({ ...pagination, page: 1 })
    fetchPlaces()
  }

  const getVerificationBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      approved: 'default',
      pending: 'secondary',
      rejected: 'destructive',
    }
    const labels: Record<string, string> = {
      approved: 'Verificato',
      pending: 'In Attesa',
      rejected: 'Rifiutato',
    }
    return <Badge variant={variants[status] || 'outline'}>{labels[status] || status}</Badge>
  }

  const getEmbeddingBadge = (status: string) => {
    const colors: Record<string, string> = {
      completed: 'bg-green-500 dark:bg-green-600 text-white',
      pending: 'bg-gray-400 dark:bg-gray-600 text-white',
      processing: 'bg-blue-500 dark:bg-blue-600 text-white',
      failed: 'bg-red-500 dark:bg-red-600 text-white',
    }
    return (
      <Badge className={colors[status] || 'bg-gray-400'}>
        {status}
      </Badge>
    )
  }

  const toggleSelectAll = () => {
    if (selectedPlaces.length === places.length) {
      setSelectedPlaces([])
    } else {
      setSelectedPlaces(places.map(p => p.id))
    }
  }

  const toggleSelectPlace = (placeId: string) => {
    setSelectedPlaces(prev =>
      prev.includes(placeId)
        ? prev.filter(id => id !== placeId)
        : [...prev, placeId]
    )
  }

  const handleBulkPublish = async (published: boolean) => {
    if (selectedPlaces.length === 0) {
      toast.error('Seleziona almeno un locale')
      return
    }

    try {
      setBulkActionLoading(true)
      const promises = selectedPlaces.map(id =>
        fetch(`/api/manager/places/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_published: published }),
        })
      )

      await Promise.all(promises)
      toast.success(`${selectedPlaces.length} locali ${published ? 'pubblicati' : 'nascosti'}`)
      setSelectedPlaces([])
      fetchPlaces()
    } catch (error) {
      toast.error('Errore durante l\'operazione')
    } finally {
      setBulkActionLoading(false)
    }
  }

  const handleBulkDelete = async () => {
    if (selectedPlaces.length === 0) {
      toast.error('Seleziona almeno un locale')
      return
    }

    if (!confirm(`Sei sicuro di voler eliminare ${selectedPlaces.length} locali? Questa azione è irreversibile.`)) {
      return
    }

    try {
      setBulkActionLoading(true)
      const promises = selectedPlaces.map(id =>
        fetch(`/api/manager/places/${id}`, { method: 'DELETE' })
      )

      await Promise.all(promises)
      toast.success(`${selectedPlaces.length} locali eliminati`)
      setSelectedPlaces([])
      fetchPlaces()
    } catch (error) {
      toast.error('Errore durante l\'eliminazione')
    } finally {
      setBulkActionLoading(false)
    }
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 md:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">I Miei Locali</h1>
          <p className="text-sm sm:text-base text-muted-foreground">Gestisci i tuoi locali</p>
        </div>
        <Button asChild className="min-h-[44px] w-full sm:w-auto">
          <Link href="/manager/places/new">
            <Plus className="mr-2 h-4 w-4" />
            Nuovo Locale
          </Link>
        </Button>
      </div>

      {/* Bulk Actions */}
      {selectedPlaces.length > 0 && (
        <div className="flex flex-col gap-3 p-4 bg-muted rounded-lg sm:flex-row sm:items-center sm:gap-2">
          <span className="text-sm font-medium">{selectedPlaces.length} selezionati</span>
          <div className="flex-1" />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleBulkPublish(true)}
              disabled={bulkActionLoading}
              className="min-h-[36px] flex-1 sm:flex-none"
            >
              <Eye className="mr-1 sm:mr-2 h-4 w-4" />
              Pubblica
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleBulkPublish(false)}
              disabled={bulkActionLoading}
              className="min-h-[36px] flex-1 sm:flex-none"
            >
              <EyeOff className="mr-1 sm:mr-2 h-4 w-4" />
              Nascondi
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={bulkActionLoading}
              className="min-h-[36px] flex-1 sm:flex-none"
            >
              <Trash2 className="mr-1 sm:mr-2 h-4 w-4" />
              Elimina
            </Button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium mb-2 block">Cerca</label>
          <div className="flex gap-2">
            <Input
              placeholder="Nome, indirizzo o città..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="min-h-[44px]"
            />
            <Button onClick={handleSearch} variant="secondary" className="min-h-[44px] px-3">
              <Search className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          <div>
            <label className="text-sm font-medium mb-2 block">Stato</label>
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="min-h-[44px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti</SelectItem>
                <SelectItem value="published">Pubblicati</SelectItem>
                <SelectItem value="unpublished">Non Pubblicati</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Categoria</label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="min-h-[44px]">
                <SelectValue placeholder="Tutte" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutte</SelectItem>
                <SelectItem value="bar">Bar</SelectItem>
                <SelectItem value="pub">Pub</SelectItem>
                <SelectItem value="club">Club</SelectItem>
                <SelectItem value="restaurant">Ristorante</SelectItem>
                <SelectItem value="lounge">Lounge</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                <Checkbox
                  checked={selectedPlaces.length === places.length && places.length > 0}
                  onCheckedChange={toggleSelectAll}
                />
              </TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Città</TableHead>
              <TableHead>Verifica</TableHead>
              <TableHead>Pubblicato</TableHead>
              <TableHead>Embeddings</TableHead>
              <TableHead className="text-right">Azioni</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-12" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-16 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : places.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  Nessun locale trovato
                </TableCell>
              </TableRow>
            ) : (
              places.map((place) => (
                <TableRow key={place.id}>
                  <TableCell>
                    <Checkbox
                      checked={selectedPlaces.includes(place.id)}
                      onCheckedChange={() => toggleSelectPlace(place.id)}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{place.name}</TableCell>
                  <TableCell>{place.place_type}</TableCell>
                  <TableCell>{place.city}</TableCell>
                  <TableCell>{getVerificationBadge(place.verification_status)}</TableCell>
                  <TableCell>
                    <Badge variant={place.is_published ? 'default' : 'secondary'}>
                      {place.is_published ? 'Sì' : 'No'}
                    </Badge>
                  </TableCell>
                  <TableCell>{getEmbeddingBadge(place.embeddings_status)}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/manager/places/${place.id}`}>Modifica</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-4">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="border rounded-lg p-4">
              <Skeleton className="h-5 w-32 mb-2" />
              <Skeleton className="h-4 w-24 mb-1" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))
        ) : places.length === 0 ? (
          <div className="border rounded-lg p-8 text-center text-muted-foreground">
            Nessun locale trovato
          </div>
        ) : (
          places.map((place) => (
            <div key={place.id} className="border rounded-lg p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3 flex-1">
                  <Checkbox
                    checked={selectedPlaces.includes(place.id)}
                    onCheckedChange={() => toggleSelectPlace(place.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium truncate">{place.name}</h3>
                    <p className="text-sm text-muted-foreground">{place.place_type} • {place.city}</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {getVerificationBadge(place.verification_status)}
                <Badge variant={place.is_published ? 'default' : 'secondary'}>
                  {place.is_published ? 'Pubblicato' : 'Non Pubblicato'}
                </Badge>
                {getEmbeddingBadge(place.embeddings_status)}
              </div>

              <div className="flex justify-end pt-2 border-t">
                <Button asChild variant="outline" size="sm" className="min-h-[36px]">
                  <Link href={`/manager/places/${place.id}`}>Modifica</Link>
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground text-center sm:text-left">
            Pagina {pagination.page} di {pagination.totalPages} ({pagination.total} totali)
          </div>
          <div className="flex gap-2 justify-center sm:justify-end">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page === 1}
              onClick={() => setPagination({ ...pagination, page: pagination.page - 1 })}
              className="min-h-[44px] flex-1 sm:flex-none"
            >
              Precedente
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page === pagination.totalPages}
              onClick={() => setPagination({ ...pagination, page: pagination.page + 1 })}
              className="min-h-[44px] flex-1 sm:flex-none"
            >
              Successiva
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
