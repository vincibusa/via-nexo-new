'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MapPin, Calendar, TrendingUp, Plus, Eye } from 'lucide-react'
import Link from 'next/link'

interface DashboardStats {
  placesCount: number
  eventsCount: number
  upcomingEventsCount: number
}

interface Place {
  id: string
  name: string
  category: string
  city: string
  verification_status: string
  is_published: boolean
}

export default function ManagerDashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    placesCount: 0,
    eventsCount: 0,
    upcomingEventsCount: 0,
  })
  const [places, setPlaces] = useState<Place[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchDashboardData()
  }, [])

  const fetchDashboardData = async () => {
    try {
      const [statsResponse, placesResponse] = await Promise.all([
        fetch('/api/manager/dashboard/stats'),
        fetch('/api/manager/places?limit=5'),
      ])

      if (statsResponse.ok) {
        const statsData = await statsResponse.json()
        setStats(statsData)
      }

      if (placesResponse.ok) {
        const placesData = await placesResponse.json()
        setPlaces(placesData.places || [])
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  const getVerificationBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive'> = {
      approved: 'default',
      pending: 'secondary',
      rejected: 'destructive',
    }
    const labels: Record<string, string> = {
      approved: 'Verificato',
      pending: 'In Attesa',
      rejected: 'Rifiutato',
    }
    return <Badge variant={variants[status]}>{labels[status]}</Badge>
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 md:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Dashboard Manager</h1>
          <p className="text-muted-foreground mt-2">Gestisci i tuoi locali ed eventi</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button asChild className="min-h-[44px]">
            <Link href="/manager/places/new">
              <Plus className="h-4 w-4 mr-2" />
              Nuovo Locale
            </Link>
          </Button>
          <Button asChild variant="outline" className="min-h-[44px]">
            <Link href="/manager/events/new">
              <Plus className="h-4 w-4 mr-2" />
              Nuovo Evento
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">I Miei Locali</CardTitle>
            <MapPin className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.placesCount}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Locali totali gestiti
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Eventi Totali</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.eventsCount}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Eventi creati
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Prossimi Eventi</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.upcomingEventsCount}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Eventi in programma
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Links */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Button asChild variant="outline" className="h-auto flex-col gap-2 p-6 min-h-[44px]">
          <Link href="/manager/places">
            <MapPin className="h-6 w-6" />
            <span className="font-medium">Gestisci Locali</span>
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-auto flex-col gap-2 p-6 min-h-[44px]">
          <Link href="/manager/events">
            <Calendar className="h-6 w-6" />
            <span className="font-medium">Gestisci Eventi</span>
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-auto flex-col gap-2 p-6 min-h-[44px]">
          <Link href="/manager/places/new">
            <Plus className="h-6 w-6" />
            <span className="font-medium">Aggiungi Locale</span>
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-auto flex-col gap-2 p-6 min-h-[44px]">
          <Link href="/manager/events/new">
            <Plus className="h-6 w-6" />
            <span className="font-medium">Crea Evento</span>
          </Link>
        </Button>
      </div>

      {/* Recent Places */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>I Tuoi Locali</CardTitle>
              <CardDescription>Ultimi 5 locali creati</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm" className="min-h-[44px]">
              <Link href="/manager/places">
                Vedi Tutti
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center py-4 text-muted-foreground">Caricamento...</p>
          ) : places.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground mb-4">Non hai ancora creato locali</p>
              <Button asChild className="min-h-[44px]">
                <Link href="/manager/places/new">
                  <Plus className="h-4 w-4 mr-2" />
                  Crea il Primo Locale
                </Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {places.map((place) => (
                <div
                  key={place.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border rounded-lg"
                >
                  <div className="space-y-1">
                    <p className="font-medium">{place.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {place.category} • {place.city}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {getVerificationBadge(place.verification_status)}
                    <Badge variant={place.is_published ? 'default' : 'secondary'}>
                      {place.is_published ? 'Pubblicato' : 'Bozza'}
                    </Badge>
                    <Button asChild variant="ghost" size="sm" className="min-h-[44px]">
                      <Link href={`/manager/places/${place.id}`}>
                        <Eye className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
