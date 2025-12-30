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
import { Plus, Search, Trash2, Eye, EyeOff, Edit, Image as ImageIcon, Video } from 'lucide-react'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'

interface DiscoveryItem {
  id: string
  media_url: string
  media_type: 'image' | 'video'
  thumbnail_url?: string
  event_id: string
  title?: string
  description?: string
  display_order: number
  views_count: number
  likes_count: number
  is_active: boolean
  created_at: string
  event?: {
    id: string
    title: string
  }
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export default function DiscoveryPage() {
  const [items, setItems] = useState<DiscoveryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  })
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all') // all, active, inactive

  useEffect(() => {
    fetchItems()
  }, [pagination.page, pagination.limit, filter])

  const fetchItems = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        ...(search && { search }),
        filter,
      })

      const response = await fetch(`/api/admin/discovery?${params}`)
      if (response.ok) {
        const data = await response.json()
        setItems(data.items || [])
        setPagination({
          ...pagination,
          total: data.total || 0,
          totalPages: Math.ceil((data.total || 0) / pagination.limit),
        })
      } else {
        toast.error('Errore nel caricamento dei contenuti Discovery')
      }
    } catch (error) {
      console.error('Error fetching discovery items:', error)
      toast.error('Errore nel caricamento dei contenuti Discovery')
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = () => {
    setPagination({ ...pagination, page: 1 })
    fetchItems()
  }

  const handleToggleActive = async (id: string, currentStatus: boolean) => {
    try {
      const response = await fetch(`/api/admin/discovery/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !currentStatus }),
      })

      if (response.ok) {
        toast.success(`Contenuto ${!currentStatus ? 'attivato' : 'disattivato'}`)
        fetchItems()
      } else {
        toast.error('Errore nell\'aggiornamento')
      }
    } catch (error) {
      console.error('Error toggling active status:', error)
      toast.error('Errore nell\'aggiornamento')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Sei sicuro di voler eliminare questo contenuto?')) {
      return
    }

    try {
      const response = await fetch(`/api/admin/discovery/${id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        toast.success('Contenuto eliminato')
        fetchItems()
      } else {
        toast.error('Errore nell\'eliminazione')
      }
    } catch (error) {
      console.error('Error deleting discovery item:', error)
      toast.error('Errore nell\'eliminazione')
    }
  }

  const formatDate = (dateString: string) => {
    return format(new Date(dateString), 'dd MMM yyyy', { locale: it })
  }

  return (
    <ProtectedRoute requiredRole="admin">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">Discovery Feed</h1>
            <p className="text-sm sm:text-base text-muted-foreground mt-2">
              Gestisci i contenuti del feed Discovery (stile TikTok)
            </p>
          </div>
          <Link href="/admin/discovery/new">
            <Button className="w-full sm:w-auto min-h-[44px]">
              <Plus className="mr-2 h-4 w-4" />
              Crea Nuovo
            </Button>
          </Link>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Cerca per titolo o descrizione..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="pl-9 min-h-[44px]"
            />
          </div>
          <div className="w-full sm:w-48">
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="min-h-[44px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti</SelectItem>
                <SelectItem value="active">Attivi</SelectItem>
                <SelectItem value="inactive">Inattivi</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleSearch} variant="secondary" className="min-h-[44px]">
            <Search className="h-4 w-4" />
          </Button>
        </div>

        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex items-center gap-4 rounded-lg border p-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
              <ImageIcon className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Totale Contenuti</p>
              <p className="text-2xl font-bold">{pagination.total}</p>
            </div>
          </div>
        </div>

        {/* Desktop Table */}
        <div className="hidden md:block border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Preview</TableHead>
                <TableHead>Titolo</TableHead>
                <TableHead>Evento</TableHead>
                <TableHead className="w-24">Tipo</TableHead>
                <TableHead className="w-24">Ordine</TableHead>
                <TableHead className="w-24">Views</TableHead>
                <TableHead className="w-24">Likes</TableHead>
                <TableHead className="w-24">Stato</TableHead>
                <TableHead className="w-32">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-16 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-8 w-24" /></TableCell>
                    </TableRow>
                  ))
                : items.length === 0
                  ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                          Nessun contenuto trovato
                        </TableCell>
                      </TableRow>
                    )
                  : (
                      items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div className="relative h-16 w-16 overflow-hidden rounded">
                              {item.media_type === 'video' ? (
                                <Video className="h-full w-full bg-muted p-2" />
                              ) : (
                                <img
                                  src={item.thumbnail_url || item.media_url}
                                  alt={item.title || 'Preview'}
                                  className="h-full w-full object-cover"
                                />
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="font-medium">
                            {item.title || 'Senza titolo'}
                          </TableCell>
                          <TableCell>
                            {item.event?.title || 'N/A'}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {item.media_type === 'video' ? 'Video' : 'Immagine'}
                            </Badge>
                          </TableCell>
                          <TableCell>{item.display_order}</TableCell>
                          <TableCell>{item.views_count}</TableCell>
                          <TableCell>{item.likes_count}</TableCell>
                          <TableCell>
                            <Badge variant={item.is_active ? 'default' : 'secondary'}>
                              {item.is_active ? 'Attivo' : 'Inattivo'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleToggleActive(item.id, item.is_active)}
                                title={item.is_active ? 'Disattiva' : 'Attiva'}
                              >
                                {item.is_active ? (
                                  <Eye className="h-4 w-4" />
                                ) : (
                                  <EyeOff className="h-4 w-4" />
                                )}
                              </Button>
                              <Link href={`/admin/discovery/${item.id}/edit`}>
                                <Button variant="ghost" size="icon" title="Modifica">
                                  <Edit className="h-4 w-4" />
                                </Button>
                              </Link>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDelete(item.id)}
                                title="Elimina"
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
            </TableBody>
          </Table>
        </div>

        {/* Mobile Cards */}
        <div className="md:hidden space-y-4">
          {loading
            ? Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-lg border p-4 space-y-2">
                  <Skeleton className="h-32 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ))
            : items.map((item) => (
                <div key={item.id} className="rounded-lg border p-4 space-y-4">
                  <div className="flex items-start gap-4">
                    <div className="relative h-20 w-20 overflow-hidden rounded">
                      {item.media_type === 'video' ? (
                        <Video className="h-full w-full bg-muted p-2" />
                      ) : (
                        <img
                          src={item.thumbnail_url || item.media_url}
                          alt={item.title || 'Preview'}
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div className="flex-1 space-y-2">
                      <div>
                        <p className="font-medium">{item.title || 'Senza titolo'}</p>
                        <p className="text-sm text-muted-foreground">
                          {item.event?.title || 'N/A'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">
                          {item.media_type === 'video' ? 'Video' : 'Immagine'}
                        </Badge>
                        <Badge variant={item.is_active ? 'default' : 'secondary'}>
                          {item.is_active ? 'Attivo' : 'Inattivo'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span>👁️ {item.views_count}</span>
                        <span>❤️ {item.likes_count}</span>
                        <span>📊 {item.display_order}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleToggleActive(item.id, item.is_active)}
                      className="flex-1"
                    >
                      {item.is_active ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
                      {item.is_active ? 'Disattiva' : 'Attiva'}
                    </Button>
                    <Link href={`/admin/discovery/${item.id}/edit`} className="flex-1">
                      <Button variant="outline" size="sm" className="w-full">
                        <Edit className="mr-2 h-4 w-4" />
                        Modifica
                      </Button>
                    </Link>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(item.id)}
                      className="flex-1 text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Elimina
                    </Button>
                  </div>
                </div>
              ))}
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Pagina {pagination.page} di {pagination.totalPages} ({pagination.total} totali)
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setPagination({ ...pagination, page: pagination.page - 1 })}
                disabled={pagination.page === 1}
              >
                Precedente
              </Button>
              <Button
                variant="outline"
                onClick={() => setPagination({ ...pagination, page: pagination.page + 1 })}
                disabled={pagination.page >= pagination.totalPages}
              >
                Successivo
              </Button>
            </div>
          </div>
        )}
      </div>
    </ProtectedRoute>
  )
}







