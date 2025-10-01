'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import {
  Building2,
  Calendar,
  Users,
  UserCheck,
  CheckCircle,
  Clock,
  TrendingUp
} from 'lucide-react'

interface DashboardStats {
  totalPlaces: number
  totalEvents: number
  totalManagers: number
  totalUsers: number
  pendingManagerRequests: number
  placesNeedingVerification: number
  suggestionsLast7Days: number
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchStats()
  }, [])

  const fetchStats = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/admin/dashboard/stats')
      if (response.ok) {
        const data = await response.json()
        setStats(data)
      }
    } catch (error) {
      console.error('Error fetching stats:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <ProtectedRoute requiredRole="admin">
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">Admin Dashboard</h1>
            <p className="text-sm sm:text-base text-muted-foreground">Pannello di gestione Nexo</p>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            title="Locali Totali"
            value={stats?.totalPlaces}
            icon={<Building2 className="h-4 w-4 text-muted-foreground" />}
            loading={loading}
            link="/admin/places"
          />
          <StatsCard
            title="Eventi Totali"
            value={stats?.totalEvents}
            icon={<Calendar className="h-4 w-4 text-muted-foreground" />}
            loading={loading}
            link="/admin/events"
          />
          <StatsCard
            title="Manager Attivi"
            value={stats?.totalManagers}
            icon={<UserCheck className="h-4 w-4 text-muted-foreground" />}
            loading={loading}
            link="/admin/managers"
          />
          <StatsCard
            title="Utenti Totali"
            value={stats?.totalUsers}
            icon={<Users className="h-4 w-4 text-muted-foreground" />}
            loading={loading}
          />
        </div>

        {/* Action Cards */}
        <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          <ActionCard
            title="Richieste Manager"
            description={`${stats?.pendingManagerRequests || 0} richieste in attesa`}
            icon={<Clock className="h-8 w-8" />}
            link="/admin/manager-requests"
            variant="warning"
            loading={loading}
          />
          <ActionCard
            title="Locali da Verificare"
            description={`${stats?.placesNeedingVerification || 0} locali non verificati`}
            icon={<CheckCircle className="h-8 w-8" />}
            link="/admin/places?filter=unverified"
            variant="info"
            loading={loading}
          />
          <ActionCard
            title="Suggerimenti (7gg)"
            description={`${stats?.suggestionsLast7Days || 0} raccomandazioni generate`}
            icon={<TrendingUp className="h-8 w-8" />}
            link="/admin/analytics"
            variant="success"
            loading={loading}
          />
        </div>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Azioni Rapide</CardTitle>
            <CardDescription>Accedi rapidamente alle funzionalità principali</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Button asChild variant="outline" className="h-16 sm:h-20 flex-col gap-2 min-h-[44px]">
              <Link href="/admin/places/new">
                <Building2 className="h-4 sm:h-5 w-4 sm:w-5" />
                <span className="text-xs sm:text-sm">Nuovo Locale</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-16 sm:h-20 flex-col gap-2 min-h-[44px]">
              <Link href="/admin/events/new">
                <Calendar className="h-4 sm:h-5 w-4 sm:w-5" />
                <span className="text-xs sm:text-sm">Nuovo Evento</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-16 sm:h-20 flex-col gap-2 min-h-[44px]">
              <Link href="/admin/places">
                <Building2 className="h-4 sm:h-5 w-4 sm:w-5" />
                <span className="text-xs sm:text-sm">Gestisci Locali</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-16 sm:h-20 flex-col gap-2 min-h-[44px]">
              <Link href="/admin/analytics">
                <TrendingUp className="h-4 sm:h-5 w-4 sm:w-5" />
                <span className="text-xs sm:text-sm">Analytics</span>
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  )
}

interface StatsCardProps {
  title: string
  value?: number
  icon: React.ReactNode
  loading: boolean
  link?: string
}

function StatsCard({ title, value, icon, loading, link }: StatsCardProps) {
  const content = (
    <Card className={link ? 'cursor-pointer hover:bg-accent transition-colors' : ''}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs sm:text-sm font-medium truncate pr-2">{title}</CardTitle>
        <div className="flex-shrink-0">{icon}</div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-6 sm:h-8 w-16 sm:w-20" />
        ) : (
          <div className="text-xl sm:text-2xl font-bold">{value?.toLocaleString() || 0}</div>
        )}
      </CardContent>
    </Card>
  )

  if (link) {
    return <Link href={link}>{content}</Link>
  }

  return content
}

interface ActionCardProps {
  title: string
  description: string
  icon: React.ReactNode
  link: string
  variant: 'warning' | 'info' | 'success'
  loading: boolean
}

function ActionCard({ title, description, icon, link, variant, loading }: ActionCardProps) {
  const variantColors = {
    warning: 'border-orange-200 bg-orange-50 hover:bg-orange-100',
    info: 'border-blue-200 bg-blue-50 hover:bg-blue-100',
    success: 'border-green-200 bg-green-50 hover:bg-green-100',
  }

  return (
    <Link href={link}>
      <Card className={`cursor-pointer transition-colors min-h-[80px] ${variantColors[variant]}`}>
        <CardHeader className="pb-4">
          <div className="flex items-start gap-3 sm:gap-4">
            <div className="flex-shrink-0 mt-1">{icon}</div>
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base sm:text-lg truncate">{title}</CardTitle>
              {loading ? (
                <Skeleton className="h-4 w-24 sm:w-32 mt-1" />
              ) : (
                <CardDescription className="text-sm break-words">{description}</CardDescription>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>
    </Link>
  )
}
