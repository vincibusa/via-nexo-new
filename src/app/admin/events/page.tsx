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
import { Plus, Search, Trash2, Eye, EyeOff, Calendar } from 'lucide-react'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'

interface Event {
  id: string
  title: string
  start_datetime: string
  end_datetime: string
  event_type: string
  verification_status: string
  is_published: boolean
  is_listed: boolean
  is_cancelled: boolean
  embeddings_status: string
  created_at: string
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

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export default function EventsListPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  })
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [eventType, setEventType] = useState('all')
  const [dateFilter, setDateFilter] = useState('all')
  const [selectedEvents, setSelectedEvents] = useState<string[]>([])
  const [bulkActionLoading, setBulkActionLoading] = useState(false)

  useEffect(() => {
    fetchEvents()
  }, [pagination.page, pagination.limit, filter, eventType, dateFilter])

  const fetchEvents = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        search,
        filter,
        ...(eventType !== 'all' && { eventType }),
        ...(dateFilter !== 'all' && { dateFilter }),
      })

      const response = await fetch(`/api/admin/events?${params}`)
      if (response.ok) {
        const data = await response.json()
        setEvents(data.events)
        setPagination(data.pagination)
      }
    } catch (error) {
      console.error('Error fetching events:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = () => {
    setPagination({ ...pagination, page: 1 })
    fetchEvents()
  }

  const getVerificationBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      approved: 'default',
      pending: 'secondary',
      rejected: 'destructive',
    }
    return <Badge variant={variants[status] || 'outline'}>{status}</Badge>
  }

  const getEmbeddingBadge = (status: string) => {
    const colors: Record<string, string> = {
      completed: 'bg-green-500',
      pending: 'bg-gray-400',
      processing: 'bg-blue-500',
      failed: 'bg-red-500',
    }
    return (
      <Badge className={colors[status] || 'bg-gray-400'}>
        {status}
      </Badge>
    )
  }

  const formatDate = (dateString: string) => {
    return format(new Date(dateString), 'dd MMM yyyy HH:mm', { locale: it })
  }

  const toggleSelectAll = () => {
    if (selectedEvents.length === events.length) {
      setSelectedEvents([])
    } else {
      setSelectedEvents(events.map(e => e.id))
    }
  }

  const toggleSelectEvent = (eventId: string) => {
    setSelectedEvents(prev =>
      prev.includes(eventId)
        ? prev.filter(id => id !== eventId)
        : [...prev, eventId]
    )
  }

  const handleBulkPublish = async (published: boolean) => {
    if (selectedEvents.length === 0) {
      toast.error('Seleziona almeno un evento')
      return
    }

    try {
      setBulkActionLoading(true)
      const promises = selectedEvents.map(id =>
        fetch(`/api/admin/events/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_published: published }),
        })
      )

      await Promise.all(promises)
      toast.success(`${selectedEvents.length} eventi ${published ? 'pubblicati' : 'nascosti'}`)
      setSelectedEvents([])
      fetchEvents()
    } catch (error) {
      toast.error('Errore durante l\'operazione')
    } finally {
      setBulkActionLoading(false)
    }
  }

  const handleBulkDelete = async () => {
    if (selectedEvents.length === 0) {
      toast.error('Seleziona almeno un evento')
      return
    }

    if (!confirm(`Sei sicuro di voler eliminare ${selectedEvents.length} eventi? Questa azione è irreversibile.`)) {
      return
    }

    try {
      setBulkActionLoading(true)
      const promises = selectedEvents.map(id =>
        fetch(`/api/admin/events/${id}`, { method: 'DELETE' })
      )

      await Promise.all(promises)
      toast.success(`${selectedEvents.length} eventi eliminati`)
      setSelectedEvents([])
      fetchEvents()
    } catch (error) {
      toast.error('Errore durante l\'eliminazione')
    } finally {
      setBulkActionLoading(false)
    }
  }

  return (
    <ProtectedRoute requiredRole="admin">
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">Gestione Eventi</h1>
            <p className="text-sm sm:text-base text-muted-foreground">Gestisci tutti gli eventi della piattaforma</p>
          </div>
          <Button asChild className="min-h-[44px] w-full sm:w-auto">
            <Link href="/admin/events/new">
              <Plus className="mr-2 h-4 w-4" />
              <span className="sm:inline">Nuovo Evento</span>
            </Link>
          </Button>
        </div>

        {/* Bulk Actions */}
        {selectedEvents.length > 0 && (
          <div className="flex flex-col gap-3 p-4 bg-muted rounded-lg sm:flex-row sm:items-center sm:gap-2">
            <span className="text-sm font-medium">{selectedEvents.length} selezionati</span>
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
                <span className="text-xs sm:text-sm">Pubblica</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleBulkPublish(false)}
                disabled={bulkActionLoading}
                className="min-h-[36px] flex-1 sm:flex-none"
              >
                <EyeOff className="mr-1 sm:mr-2 h-4 w-4" />
                <span className="text-xs sm:text-sm">Nascondi</span>
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleBulkDelete}
                disabled={bulkActionLoading}
                className="min-h-[36px] flex-1 sm:flex-none"
              >
                <Trash2 className="mr-1 sm:mr-2 h-4 w-4" />
                <span className="text-xs sm:text-sm">Elimina</span>
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
                placeholder="Titolo o descrizione..."
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
              <label className="text-sm font-medium mb-2 block">Stato Verifica</label>
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="min-h-[44px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti</SelectItem>
                  <SelectItem value="verified">Verificati</SelectItem>
                  <SelectItem value="unverified">Da Verificare</SelectItem>
                  <SelectItem value="published">Pubblicati</SelectItem>
                  <SelectItem value="unpublished">Non Pubblicati</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Tipo Evento</label>
              <Select value={eventType} onValueChange={setEventType}>
                <SelectTrigger className="min-h-[44px]">
                  <SelectValue placeholder="Tutti" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti</SelectItem>
                  <SelectItem value="concert">Concerto</SelectItem>
                  <SelectItem value="dj_set">DJ Set</SelectItem>
                  <SelectItem value="live_music">Live Music</SelectItem>
                  <SelectItem value="party">Festa</SelectItem>
                  <SelectItem value="aperitivo">Aperitivo</SelectItem>
                  <SelectItem value="special">Evento Speciale</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Data</label>
              <Select value={dateFilter} onValueChange={setDateFilter}>
                <SelectTrigger className="min-h-[44px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti</SelectItem>
                  <SelectItem value="upcoming">Futuri</SelectItem>
                  <SelectItem value="past">Passati</SelectItem>
                  <SelectItem value="today">Oggi</SelectItem>
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
                    checked={selectedEvents.length === events.length && events.length > 0}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead>Titolo</TableHead>
                <TableHead>Locale</TableHead>
                <TableHead>Data Inizio</TableHead>
                <TableHead>Tipo</TableHead>
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
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-16 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : events.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    Nessun evento trovato
                  </TableCell>
                </TableRow>
              ) : (
                events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedEvents.includes(event.id)}
                        onCheckedChange={() => toggleSelectEvent(event.id)}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{event.title}</TableCell>
                    <TableCell>
                      {event.place?.name || '-'}
                      {event.place?.city && <span className="text-muted-foreground text-sm"> • {event.place.city}</span>}
                    </TableCell>
                    <TableCell>{formatDate(event.start_datetime)}</TableCell>
                    <TableCell className="capitalize">{event.event_type?.replace('_', ' ')}</TableCell>
                    <TableCell>{getVerificationBadge(event.verification_status)}</TableCell>
                    <TableCell>
                      <Badge variant={event.is_published ? 'default' : 'secondary'}>
                        {event.is_published ? 'Sì' : 'No'}
                      </Badge>
                    </TableCell>
                    <TableCell>{getEmbeddingBadge(event.embeddings_status)}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/admin/events/${event.id}`}>Modifica</Link>
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
          ) : events.length === 0 ? (
            <div className="border rounded-lg p-8 text-center text-muted-foreground">
              Nessun evento trovato
            </div>
          ) : (
            events.map((event) => (
              <div key={event.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    <Checkbox
                      checked={selectedEvents.includes(event.id)}
                      onCheckedChange={() => toggleSelectEvent(event.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium truncate">{event.title}</h3>
                      <p className="text-sm text-muted-foreground">
                        {event.place?.name} • {event.place?.city}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  {formatDate(event.start_datetime)}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="capitalize">
                    {event.event_type?.replace('_', ' ')}
                  </Badge>
                  {getVerificationBadge(event.verification_status)}
                  <Badge variant={event.is_published ? 'default' : 'secondary'}>
                    {event.is_published ? 'Pubblicato' : 'Non Pubblicato'}
                  </Badge>
                  {getEmbeddingBadge(event.embeddings_status)}
                </div>

                <div className="flex justify-end pt-2 border-t">
                  <Button asChild variant="outline" size="sm" className="min-h-[36px]">
                    <Link href={`/admin/events/${event.id}`}>Modifica</Link>
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
    </ProtectedRoute>
  )
}
