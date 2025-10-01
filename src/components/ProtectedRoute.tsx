'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/hooks/useUser'
import { Skeleton } from '@/components/ui/skeleton'

interface ProtectedRouteProps {
  children: React.ReactNode
  requiredRole?: 'user' | 'manager' | 'admin'
  redirectTo?: string
}

export function ProtectedRoute({
  children,
  requiredRole,
  redirectTo = '/login',
}: ProtectedRouteProps) {
  const router = useRouter()
  const { user, loading } = useUser()

  useEffect(() => {
    if (loading) return

    // Not authenticated
    if (!user) {
      router.push(redirectTo)
      return
    }

    // Check role requirements
    if (requiredRole) {
      const roleHierarchy: Record<string, number> = {
        user: 1,
        manager: 2,
        admin: 3,
      }

      const userLevel = roleHierarchy[user.role] || 0
      const requiredLevel = roleHierarchy[requiredRole] || 0

      if (userLevel < requiredLevel) {
        router.push('/')
      }
    }
  }, [user, loading, requiredRole, redirectTo, router])

  if (loading) {
    return (
      <div className="container mx-auto p-8">
        <div className="space-y-4">
          <Skeleton className="h-12 w-[250px]" />
          <Skeleton className="h-4 w-[300px]" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  // Check role
  if (requiredRole) {
    const roleHierarchy: Record<string, number> = {
      user: 1,
      manager: 2,
      admin: 3,
    }

    const userLevel = roleHierarchy[user.role] || 0
    const requiredLevel = roleHierarchy[requiredRole] || 0

    if (userLevel < requiredLevel) {
      return (
        <div className="container mx-auto p-8">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <h2 className="text-lg font-semibold text-red-900">Access Denied</h2>
            <p className="text-sm text-red-700">
              You don't have permission to access this page.
            </p>
          </div>
        </div>
      )
    }
  }

  return <>{children}</>
}
