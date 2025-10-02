'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { ArrowLeft, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import Link from 'next/link'

interface ManagerRequest {
  id: string
  user_id: string
  business_name: string
  vat_number: string
  phone_number: string
  notes: string | null
  status: 'pending' | 'approved' | 'rejected'
  review_notes: string | null
  created_at: string
  reviewed_at: string | null
  reviewed_by: string | null
  user: {
    email: string
    display_name: string | null
  }
}

export default function ManagerRequestDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const [request, setRequest] = useState<ManagerRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [reviewNotes, setReviewNotes] = useState('')

  useEffect(() => {
    fetchRequest()
  }, [params.id])

  const fetchRequest = async () => {
    try {
      const response = await fetch(`/api/admin/manager-requests/${params.id}`)
      if (response.ok) {
        const data = await response.json()
        setRequest(data)
        setReviewNotes(data.review_notes || '')
      }
    } catch (error) {
      console.error('Error fetching request:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async () => {
    if (!confirm('Sei sicuro di voler approvare questa richiesta?')) return

    setActionLoading(true)
    try {
      const response = await fetch(`/api/admin/manager-requests/${params.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_notes: reviewNotes }),
      })

      if (response.ok) {
        router.push('/admin/manager-requests')
        router.refresh()
      } else {
        const error = await response.json()
        alert(error.error || 'Errore durante l\'approvazione')
      }
    } catch (error) {
      console.error('Error approving request:', error)
      alert('Errore durante l\'approvazione')
    } finally {
      setActionLoading(false)
    }
  }

  const handleReject = async () => {
    if (!reviewNotes.trim()) {
      alert('Inserisci le note di revisione per il rifiuto')
      return
    }

    if (!confirm('Sei sicuro di voler rifiutare questa richiesta?')) return

    setActionLoading(true)
    try {
      const response = await fetch(`/api/admin/manager-requests/${params.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_notes: reviewNotes }),
      })

      if (response.ok) {
        router.push('/admin/manager-requests')
        router.refresh()
      } else {
        const error = await response.json()
        alert(error.error || 'Errore durante il rifiuto')
      }
    } catch (error) {
      console.error('Error rejecting request:', error)
      alert('Errore durante il rifiuto')
    } finally {
      setActionLoading(false)
    }
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive'> = {
      approved: 'default',
      pending: 'secondary',
      rejected: 'destructive',
    }
    const labels: Record<string, string> = {
      approved: 'Approvata',
      pending: 'In Attesa',
      rejected: 'Rifiutata',
    }
    return <Badge variant={variants[status]}>{labels[status]}</Badge>
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (!request) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm" className="min-h-[44px]">
          <Link href="/admin/manager-requests">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Torna alle richieste
          </Link>
        </Button>
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">Richiesta non trovata</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const isPending = request.status === 'pending'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <Button asChild variant="ghost" size="sm" className="w-fit min-h-[44px]">
          <Link href="/admin/manager-requests">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Torna alle richieste
          </Link>
        </Button>
        <div className="flex-1" />
        {getStatusBadge(request.status)}
      </div>

      {/* Request Details */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* User Info */}
        <Card>
          <CardHeader>
            <CardTitle>Informazioni Utente</CardTitle>
            <CardDescription>Dati dell'utente richiedente</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground">Nome</Label>
              <p className="font-medium">{request.user.display_name || '-'}</p>
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">Email</Label>
              <p className="font-medium">{request.user.email}</p>
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">Telefono</Label>
              <p className="font-medium">{request.phone_number}</p>
            </div>
          </CardContent>
        </Card>

        {/* Business Info */}
        <Card>
          <CardHeader>
            <CardTitle>Informazioni Business</CardTitle>
            <CardDescription>Dati dell'attività</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground">Nome Attività</Label>
              <p className="font-medium">{request.business_name}</p>
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">Partita IVA</Label>
              <p className="font-medium">{request.vat_number}</p>
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">Data Richiesta</Label>
              <p className="font-medium">
                {new Date(request.created_at).toLocaleDateString('it-IT', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Notes */}
      <Card>
        <CardHeader>
          <CardTitle>Note della Richiesta</CardTitle>
          <CardDescription>Note aggiuntive fornite dal richiedente</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm whitespace-pre-wrap">{request.notes || 'Nessuna nota fornita'}</p>
        </CardContent>
      </Card>

      {/* Review Section */}
      {isPending ? (
        <Card>
          <CardHeader>
            <CardTitle>Revisiona Richiesta</CardTitle>
            <CardDescription>Approva o rifiuta la richiesta del manager</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="review-notes">
                Note di Revisione {request.status === 'rejected' && '*'}
              </Label>
              <Textarea
                id="review-notes"
                placeholder="Inserisci eventuali note sulla decisione..."
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                rows={4}
                className="min-h-[44px]"
              />
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                onClick={handleApprove}
                disabled={actionLoading}
                className="flex-1 min-h-[44px]"
              >
                {actionLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                Approva
              </Button>
              <Button
                onClick={handleReject}
                variant="destructive"
                disabled={actionLoading}
                className="flex-1 min-h-[44px]"
              >
                {actionLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <XCircle className="h-4 w-4 mr-2" />
                )}
                Rifiuta
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Dettagli Revisione</CardTitle>
            <CardDescription>Informazioni sulla decisione presa</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground">Note di Revisione</Label>
              <p className="text-sm whitespace-pre-wrap">{request.review_notes || 'Nessuna nota fornita'}</p>
            </div>
            {request.reviewed_at && (
              <div className="space-y-2">
                <Label className="text-muted-foreground">Data Revisione</Label>
                <p className="text-sm">
                  {new Date(request.reviewed_at).toLocaleDateString('it-IT', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
