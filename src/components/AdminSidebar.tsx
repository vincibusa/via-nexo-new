'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  MapPin,
  Calendar,
  Users,
  UserCheck,
  MessageSquare,
  BarChart3,
  Settings,
  LogOut,
  Menu,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { useUser } from '@/hooks/useUser'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { RoleBadge } from '@/components/RoleBadge'
import { useState, useEffect } from 'react'

const getInitials = (displayName?: string, email?: string) => {
  if (displayName) {
    return displayName
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }
  return email?.slice(0, 2).toUpperCase() || 'U'
}

const navigation = [
  { name: 'Dashboard', href: '/admin', icon: LayoutDashboard },
  { name: 'Places', href: '/admin/places', icon: MapPin },
  { name: 'Eventi', href: '/admin/events', icon: Calendar },
  { name: 'Manager', href: '/admin/managers', icon: Users },
  { name: 'Richieste Manager', href: '/admin/manager-requests', icon: UserCheck },
  { name: 'Suggerimenti', href: '/admin/suggestions', icon: MessageSquare },
  { name: 'Analytics', href: '/admin/analytics', icon: BarChart3 },
  { name: 'Impostazioni', href: '/admin/settings', icon: Settings },
]

interface AdminSidebarProps {
  isMobileMenuOpen?: boolean
  setIsMobileMenuOpen?: (open: boolean) => void
}

export function AdminSidebar({ isMobileMenuOpen = false, setIsMobileMenuOpen }: AdminSidebarProps = {}) {
  const pathname = usePathname()
  const { logout } = useAuth()
  const { user } = useUser()
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkIsMobile = () => {
      setIsMobile(window.innerWidth < 768)
    }
    
    checkIsMobile()
    window.addEventListener('resize', checkIsMobile)
    
    return () => window.removeEventListener('resize', checkIsMobile)
  }, [])

  const handleLinkClick = () => {
    if (isMobile && setIsMobileMenuOpen) {
      setIsMobileMenuOpen(false)
    }
  }

  const sidebarContent = (
    <>
      {/* Logo/Brand */}
      <div className="flex h-16 items-center border-b px-6">
        <h1 className="text-xl font-bold">Nexo Admin</h1>
        {isMobile && setIsMobileMenuOpen && (
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto md:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>

      {/* User Info */}
      {user && (
        <div className="border-b p-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={user.avatarUrl || undefined} />
              <AvatarFallback>{getInitials(user.displayName, user.email)}</AvatarFallback>
            </Avatar>
            <div className="flex-1 overflow-hidden">
              <p className="truncate text-sm font-medium">{user.displayName || user.email}</p>
              <RoleBadge role={user.role} size="sm" />
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto p-4">
        {navigation.map((item) => {
          const isActive = pathname === item.href
          const Icon = item.icon
          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={handleLinkClick}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors min-h-[44px]',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <Icon className="h-5 w-5 flex-shrink-0" />
              {item.name}
            </Link>
          )
        })}
      </nav>

      {/* Logout Button */}
      <div className="border-t p-4">
        <Button
          variant="ghost"
          className="w-full justify-start min-h-[44px]"
          onClick={() => logout()}
        >
          <LogOut className="mr-3 h-5 w-5" />
          Logout
        </Button>
      </div>
    </>
  )

  if (isMobile) {
    return (
      <>
        {/* Mobile overlay */}
        {isMobileMenuOpen && (
          <div 
            className="fixed inset-0 z-40 bg-black/50 md:hidden" 
            onClick={() => setIsMobileMenuOpen?.(false)}
          />
        )}
        
        {/* Mobile sidebar */}
        <div className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ease-in-out md:hidden",
          isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        )}>
          <div className="flex h-screen w-64 flex-col border-r bg-card">
            {sidebarContent}
          </div>
        </div>
      </>
    )
  }

  // Desktop sidebar
  return (
    <div className="hidden md:flex h-screen w-64 flex-col border-r bg-card">
      {sidebarContent}
    </div>
  )
}
