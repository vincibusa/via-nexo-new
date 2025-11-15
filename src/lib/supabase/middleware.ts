import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  try {
    // Check for required environment variables
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('[Middleware] Missing Supabase environment variables')
      // Return response without auth if env vars are missing
      return NextResponse.next({ request })
    }

    let supabaseResponse = NextResponse.next({
      request,
    })

    const supabase = createServerClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
            supabaseResponse = NextResponse.next({
              request,
            })
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            )
          },
        },
      }
    )

    // IMPORTANT: Avoid writing any logic between createServerClient and
    // supabase.auth.getUser(). A simple mistake could make it very hard to debug
    // issues with users being randomly logged out.

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    // If auth fails, continue without user (non-blocking)
    if (authError) {
      console.error('[Middleware] Auth error:', authError.message)
    }

    // Protection for /admin and /manager routes
    if (request.nextUrl.pathname.startsWith('/admin') && user) {
      try {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single()

        if (profileError) {
          console.error('[Middleware] Profile fetch error:', profileError.message)
          // If profile fetch fails, deny access to be safe
          const url = request.nextUrl.clone()
          url.pathname = '/'
          return NextResponse.redirect(url)
        }

        if (profile?.role !== 'admin') {
          const url = request.nextUrl.clone()
          url.pathname = '/'
          return NextResponse.redirect(url)
        }

        // Log admin access (non-blocking, fire and forget)
        supabase.from('audit_logs').insert({
          actor_id: user.id,
          action: 'ACCESS_ADMIN_PANEL',
          entity_type: 'route',
          entity_id: null,
          changes: { path: request.nextUrl.pathname },
          ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
          user_agent: request.headers.get('user-agent') || 'unknown',
        }).catch((err) => {
          console.error('[Middleware] Audit log error:', err.message)
          // Don't block request if audit log fails
        })
      } catch (error) {
        console.error('[Middleware] Admin route protection error:', error)
        // On error, deny access to be safe
        const url = request.nextUrl.clone()
        url.pathname = '/'
        return NextResponse.redirect(url)
      }
    }

    if (request.nextUrl.pathname.startsWith('/manager') && user) {
      try {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single()

        if (profileError) {
          console.error('[Middleware] Profile fetch error:', profileError.message)
          // If profile fetch fails, deny access to be safe
          const url = request.nextUrl.clone()
          url.pathname = '/'
          return NextResponse.redirect(url)
        }

        if (!['manager', 'admin'].includes(profile?.role || '')) {
          const url = request.nextUrl.clone()
          url.pathname = '/'
          return NextResponse.redirect(url)
        }
      } catch (error) {
        console.error('[Middleware] Manager route protection error:', error)
        // On error, deny access to be safe
        const url = request.nextUrl.clone()
        url.pathname = '/'
        return NextResponse.redirect(url)
      }
    }

    // Redirect to login if accessing protected routes without auth
    if (!user && (request.nextUrl.pathname.startsWith('/admin') || request.nextUrl.pathname.startsWith('/manager'))) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      return NextResponse.redirect(url)
    }

    return supabaseResponse
  } catch (error) {
    console.error('[Middleware] Unexpected error:', error)
    // On any unexpected error, return a response to prevent middleware failure
    return NextResponse.next({ request })
  }
}
