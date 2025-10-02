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
import { Search, Eye } from 'lucide-react'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'

interface ManagerRequest {
  id: string
  user_id: string
  business_name: string
  business_type: string
  vat_number: string
  phone: string
  notes: string | null
  status: 'pending' | 'approved' | 'rejected'
  review_notes: string | null
  created_at: string
  user: {
    email: string
    display_name: string | null
  }
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export default function ManagerRequestsPage() {
  const [requests, setRequests] = useState<ManagerRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  })
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => {
    fetchRequests()
  }, [pagination.page, statusFilter])

  const fetchRequests = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        search,
        ...(statusFilter !== 'all' && { status: statusFilter }),
      })

      const response = await fetch(`/api/admin/manager-requests?${params}`)
      if (response.ok) {
        const data = await response.json()
        setRequests(data.requests)
        setPagination(data.pagination)
      }
    } catch (error) {
      console.error('Error fetching manager requests:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = () => {
    setPagination({ ...pagination, page: 1 })
    fetchRequests()
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive'> = {
      approved: 'default',
      pending: 'secondary',
      rejected: 'destructive',
    }

    const labels: Record<string, string> = {
      approved: 'Approvato',
      pending: 'In Attesa',
      rejected: 'Rifiutato',
    }

    return (
      <Badge variant={variants[status] || 'secondary'}>
        {labels[status] || status}
      </Badge>
    )
  }

  return (
    <ProtectedRoute requiredRole="admin">
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">Richieste Manager</h1>
            <p className="text-sm sm:text-base text-muted-foreground">
              Gestisci le richieste di accesso come manager
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Cerca</label>
            <div className="flex gap-2">
              <Input
                placeholder="Email, nome azienda..."
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

          <div className="w-full sm:w-48">
            <label className="text-sm font-medium mb-2 block">Stato</label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="min-h-[44px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti</SelectItem>
                <SelectItem value="pending">In Attesa</SelectItem>
                <SelectItem value="approved">Approvati</SelectItem>
                <SelectItem value="rejected">Rifiutati</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Desktop Table */}
        <div className="hidden md:block border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Utente</TableHead>
                <TableHead>Nome Azienda</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Stato</TableHead>
                <TableHead>Data Richiesta</TableHead>
                <TableHead className="text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-16 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : requests.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Nessuna richiesta trovata
                  </TableCell>
                </TableRow>
              ) : (
                requests.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{request.user.display_name || request.user.email}</p>
                        {request.user.display_name && (
                          <p className="text-sm text-muted-foreground">{request.user.email}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{request.business_name}</TableCell>
                    <TableCell className="capitalize">{request.business_type}</TableCell>
                    <TableCell>{getStatusBadge(request.status)}</TableCell>
                    <TableCell>
                      {format(new Date(request.created_at), 'dd MMM yyyy', { locale: it })}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm" className="min-h-[36px]">
                        <Link href={`/admin/manager-requests/${request.id}`}>
                          <Eye className="h-4 w-4 mr-2" />
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
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="border rounded-lg p-4">
                <Skeleton className="h-5 w-32 mb-2" />
                <Skeleton className="h-4 w-24 mb-1" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))
          ) : requests.length === 0 ? (
            <div className="border rounded-lg p-8 text-center text-muted-foreground">
              Nessuna richiesta trovata
            </div>
          ) : (
            requests.map((request) => (
              <div key={request.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium truncate">{request.business_name}</h3>
                    <p className="text-sm text-muted-foreground truncate">
                      {request.user.display_name || request.user.email}
                    </p>
                    <p className="text-xs text-muted-foreground capitalize mt-1">
                      {request.business_type}
                    </p>
                  </div>
                  {getStatusBadge(request.status)}
                </div>

                <div className="text-xs text-muted-foreground">
                  Richiesta: {format(new Date(request.created_at), 'dd MMM yyyy', { locale: it })}
                </div>

                <div className="flex justify-end pt-2 border-t">
                  <Button asChild variant="outline" size="sm" className="min-h-[36px]">
                    <Link href={`/admin/manager-requests/${request.id}`}>
                      <Eye className="h-4 w-4 mr-2" />
                      Dettagli
                    </Link>
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
