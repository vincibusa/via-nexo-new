'use client'

import { useEffect, useState } from 'react'

export interface User {
  id: string
  email: string | null
  role: 'user' | 'manager' | 'admin'
  displayName: string | null
  avatarUrl: string | null
  locale: string | null
  createdAt: string
  metadata: Record<string, any>
}

export function useUser() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchUser()
  }, [])

  const fetchUser = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/auth/me')

      if (!response.ok) {
        if (response.status === 401) {
          setUser(null)
          setError(null)
          return
        }
        throw new Error('Failed to fetch user')
      }

      const data = await response.json()
      setUser(data.user)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  const refetch = () => {
    fetchUser()
  }

  return {
    user,
    loading,
    error,
    refetch,
    isAdmin: user?.role === 'admin',
    isManager: user?.role === 'manager' || user?.role === 'admin',
    isAuthenticated: !!user,
  }
}
