import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { getCorsHeaders, handleCorsPreflight } from '@/lib/cors'

export async function middleware(request: NextRequest) {
  try {
    // API: applica CORS a tutte le route /api (preflight + header su ogni response)
    if (request.nextUrl.pathname.startsWith('/api')) {
      const preflight = handleCorsPreflight(request)
      if (preflight) return preflight
      const response = NextResponse.next()
      Object.entries(getCorsHeaders(request)).forEach(([key, value]) => {
        response.headers.set(key, value)
      })
      return response
    }
    return await updateSession(request)
  } catch (error) {
    console.error('[Middleware] Top-level error:', error)
    return NextResponse.next({ request })
  }
}

export const config = {
  matcher: [
    '/api/:path*',
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
