import { Badge } from '@/components/ui/badge'

interface RoleBadgeProps {
  role: 'user' | 'manager' | 'admin'
  size?: 'sm' | 'md' | 'lg'
}

export function RoleBadge({ role, size = 'md' }: RoleBadgeProps) {
  const getColor = () => {
    switch (role) {
      case 'admin':
        return 'bg-red-500 hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-700 text-white'
      case 'manager':
        return 'bg-blue-500 hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700 text-white'
      default:
        return 'bg-gray-500 hover:bg-gray-600 dark:bg-gray-600 dark:hover:bg-gray-700 text-white'
    }
  }

  const getLabel = () => {
    switch (role) {
      case 'admin':
        return 'Admin'
      case 'manager':
        return 'Manager'
      default:
        return 'User'
    }
  }

  const getSizeClass = () => {
    switch (size) {
      case 'sm':
        return 'text-xs px-1.5 py-0.5'
      case 'lg':
        return 'text-base px-3 py-1.5'
      default:
        return 'text-sm px-2 py-1'
    }
  }

  return (
    <Badge className={`${getColor()} ${getSizeClass()}`}>
      {getLabel()}
    </Badge>
  )
}
