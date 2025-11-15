# CORS Configuration

Il progetto ora gestisce correttamente le richieste CORS (Cross-Origin Resource Sharing) per tutte le API routes.

## Configurazione

La configurazione CORS si trova in `src/lib/cors.ts` e può essere personalizzata tramite variabili d'ambiente:

- **Default**: Permette tutte le origini (`*`) sia in development che in production
- **Restrizione**: Se necessario, puoi limitare le origini usando la variabile `ALLOWED_ORIGINS`

### Variabili d'ambiente

```env
# Opzionale: per limitare le origini consentite (separate da virgole)
# Se non specificato, tutte le origini sono consentite
ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
```

**Nota**: Di default, il sistema permette richieste da tutte le origini per massima flessibilità. Se hai bisogno di restringere l'accesso, configura `ALLOWED_ORIGINS`.

## Utilizzo nelle API Routes

### Esempio base

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { handleCorsPreflight, withCors } from '@/lib/cors'

// Gestisci preflight OPTIONS
export async function OPTIONS(request: NextRequest) {
  const preflightResponse = handleCorsPreflight(request)
  if (preflightResponse) {
    return preflightResponse
  }
  return new Response(null, { status: 204 })
}

export async function GET(request: NextRequest) {
  // Gestisci preflight anche nelle richieste normali
  const preflightResponse = handleCorsPreflight(request)
  if (preflightResponse) {
    return preflightResponse
  }

  try {
    // La tua logica qui
    const data = { message: 'Hello' }
    
    // Aggiungi CORS headers alla risposta
    return withCors(request, NextResponse.json(data))
  } catch (error) {
    return withCors(
      request,
      NextResponse.json({ error: 'Error' }, { status: 500 })
    )
  }
}
```

### Per streaming responses (SSE)

```typescript
import { getCorsHeaders } from '@/lib/cors'

export async function GET(request: NextRequest) {
  const stream = new ReadableStream({...})
  
  const corsHeaders = getCorsHeaders(request)
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      ...corsHeaders,
    },
  })
}
```

## Route già aggiornate

Le seguenti route sono già configurate con CORS:

- ✅ `/api/auth/login`
- ✅ `/api/places`
- ✅ `/api/suggest`
- ✅ `/api/chat/suggest-stream`

## Route da aggiornare

Le seguenti route devono ancora essere aggiornate per supportare CORS:

- `/api/auth/signup`
- `/api/auth/logout`
- `/api/auth/me`
- `/api/events`
- `/api/favorites`
- `/api/notifications/*`
- Tutte le route `/api/admin/*`
- Tutte le route `/api/manager/*`
- Altre route API

## Headers CORS configurati

- `Access-Control-Allow-Origin`: Origin consentita (o `*` in dev)
- `Access-Control-Allow-Methods`: GET, POST, PUT, DELETE, PATCH, OPTIONS
- `Access-Control-Allow-Headers`: Content-Type, Authorization, X-Requested-With, Accept, Origin, x-app-version, accept-language
- `Access-Control-Allow-Credentials`: true (se origin è specificata)
- `Access-Control-Max-Age`: 86400 (24 ore)

## Testing CORS

Per testare CORS in locale:

```bash
# In un'altra porta o dominio
curl -X OPTIONS http://localhost:3000/api/places \
  -H "Origin: http://localhost:3001" \
  -H "Access-Control-Request-Method: GET" \
  -v
```

Dovresti vedere gli headers CORS nella risposta.

