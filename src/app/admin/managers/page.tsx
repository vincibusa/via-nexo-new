'use client'

import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Search, Users, MapPin, Building2, ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'

interface Manager {
  id: string
  email: string
  display_name: string | null
  created_at: string
  places_count: number
}

export default function ManagersPage() {
  const [managers, setManagers] = useState<Manager[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({
    total: 0,
    totalPages: 0,
    limit: 20,
  })

  useEffect(() => {
    fetchManagers()
  }, [page, search])

  const fetchManagers = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: pagination.limit.toString(),
        search,
      })

      const response = await fetch(`/api/admin/managers?${params}`)
      if (response.ok) {
        const data = await response.json()
        setManagers(data.managers)
        setPagination(data.pagination)
      }
    } catch (error) {
      console.error('Error fetching managers:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = (value: string) => {
    setSearch(value)
    setPage(1)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Manager Attivi</h1>
        <p className="text-muted-foreground mt-2">Gestisci i manager della piattaforma</p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex items-center gap-4 rounded-lg border p-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
            <Users className="h-6 w-6 text-primary" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Manager Totali</p>
            <p className="text-2xl font-bold">{pagination.total}</p>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Cerca per nome o email..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-9 min-h-[44px]"
          />
        </div>
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Manager</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Locali Gestiti</TableHead>
              <TableHead>Data Registrazione</TableHead>
              <TableHead className="w-[100px]">Azioni</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8">
                  Caricamento...
                </TableCell>
              </TableRow>
            ) : managers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8">
                  Nessun manager trovato
                </TableCell>
              </TableRow>
            ) : (
              managers.map((manager) => (
                <TableRow key={manager.id}>
                  <TableCell className="font-medium">
                    {manager.display_name || '-'}
                  </TableCell>
                  <TableCell>{manager.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      <MapPin className="h-3 w-3 mr-1" />
                      {manager.places_count}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {new Date(manager.created_at).toLocaleDateString('it-IT')}
                  </TableCell>
                  <TableCell>
                    <Button asChild variant="ghost" size="sm" className="min-h-[44px]">
                      <Link href={`/admin/managers/${manager.id}`}>
                        Dettagli
                      </Link>
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
          <div className="text-center py-8">Caricamento...</div>
        ) : managers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Nessun manager trovato
          </div>
        ) : (
          managers.map((manager) => (
            <div key={manager.id} className="border rounded-lg p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="font-medium">{manager.display_name || 'Senza nome'}</p>
                  <p className="text-sm text-muted-foreground">{manager.email}</p>
                </div>
                <Badge variant="secondary">
                  <MapPin className="h-3 w-3 mr-1" />
                  {manager.places_count}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Registrato il</span>
                <span>{new Date(manager.created_at).toLocaleDateString('it-IT')}</span>
              </div>
              <Button asChild variant="outline" className="w-full min-h-[44px]">
                <Link href={`/admin/managers/${manager.id}`}>
                  Vedi Dettagli
                </Link>
              </Button>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t pt-4">
          <p className="text-sm text-muted-foreground">
            Pagina {page} di {pagination.totalPages} ({pagination.total} totali)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="min-h-[44px]"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Precedente
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
              disabled={page === pagination.totalPages}
              className="min-h-[44px]"
            >
              Successiva
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
