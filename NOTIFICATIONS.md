# Sistema di Notifiche Push Automatiche 🔔

## Panoramica

Il sistema invia automaticamente notifiche push agli utenti della app mobile quando vengono pubblicati nuovi eventi nelle loro vicinanze.

## Funzionalità Implementate

### 1. Notifiche Automatiche per Nuovi Eventi

**Quando vengono inviate:**
- Quando un nuovo evento viene creato E pubblicato (`is_published=true`, `is_listed=true`, `is_cancelled=false`)
- Quando un evento esistente viene aggiornato da "non pubblicato" a "pubblicato"

**Destinatari:**
- Utenti entro 20km dall'evento (basato su coordinate GPS del locale)
- Solo utenti con push notifications abilitate (`metadata.push_enabled = true`)
- Solo utenti con almeno un push token registrato

**Contenuto Notifica:**
- **Titolo:** `🎉 [Nome Evento]`
- **Corpo:** `[Data] • [Nome Locale]`
- **Deep Link:** Apre direttamente l'evento nella app

### 2. Endpoints Coinvolti

Le notifiche vengono inviate automaticamente da:

- ✅ `POST /api/admin/events` - Admin crea nuovo evento
- ✅ `PATCH /api/admin/events/[id]` - Admin pubblica evento esistente
- ✅ `POST /api/manager/events` - Manager crea nuovo evento
- ✅ `PATCH /api/manager/events/[id]` - Manager pubblica evento esistente

## Architettura Tecnica

### File Chiave

1. **`admin/src/lib/notifications/event-notifications.ts`**
   - `notifyUsersAboutNewEvent()` - Logica principale notifiche
   - `sendFavoriteEventReminders()` - Reminder eventi preferiti (future implementation)

2. **Funzioni RPC Database:**
   - `get_users_for_event_notification(lat, lon, radius_km)` - Trova utenti entro raggio con push abilitato
   - `get_profiles_with_push_tokens()` - Ottiene tutti i profili con push tokens

3. **API Endpoints:**
   - `POST /api/notifications/send` - Invio manuale notifiche (admin only)
   - `POST /api/notifications/register` - Registrazione push token (mobile app)
   - `POST /api/notifications/test` - Test notifiche (dev only)

### Flusso Notifica

```
1. Evento creato/pubblicato
   ↓
2. Fetch coordinate locale (lat, lon)
   ↓
3. Query RPC: get_users_for_event_notification(lat, lon, 20km)
   ↓
4. Raccogli push tokens validi
   ↓
5. Invia batch a Expo Push Notification Service
   ↓
6. Log risultati (successi/fallimenti)
```

### Gestione Errori

Il sistema è **fail-safe**: se l'invio delle notifiche fallisce:
- L'operazione di creazione/aggiornamento evento **NON fallisce**
- L'errore viene solo loggato in console
- L'utente riceve comunque la conferma dell'operazione

## Configurazione Database

### Tabella `profiles`

Campo `push_tokens` (JSONB array):
```json
[
  {
    "token": "ExponentPushToken[xxxxx]",
    "platform": "ios",
    "created_at": "2025-01-07T12:00:00Z"
  },
  {
    "token": "ExponentPushToken[yyyyy]",
    "platform": "android",
    "created_at": "2025-01-07T13:00:00Z"
  }
]
```

Campo `metadata` (JSONB):
```json
{
  "push_enabled": true,
  "language": "it",
  "default_radius_km": 5,
  "location": {
    "lat": 41.9028,
    "lon": 12.4964
  }
}
```

## Testing

### Test Manuale (Development)

1. **Assicurati che la mobile app sia in esecuzione:**
   ```bash
   cd mobile
   npm run dev
   ```

2. **Login sulla mobile app** e accetta i permessi notifiche

3. **Verifica registrazione push token:**
   ```bash
   # In Supabase SQL Editor
   SELECT id, email, push_tokens, metadata->>'push_enabled' as push_enabled
   FROM profiles
   WHERE push_tokens IS NOT NULL AND array_length(push_tokens, 1) > 0;
   ```

4. **Crea un nuovo evento tramite admin dashboard:**
   - Vai su `/admin/events/new`
   - Compila form con tutti i campi obbligatori
   - **IMPORTANTE:** Spunta "Pubblicato" prima di salvare
   - Salva evento

5. **Verifica notifica sulla mobile app:**
   - La notifica dovrebbe apparire entro pochi secondi
   - Tap sulla notifica dovrebbe aprire l'evento

### Test con API Diretta

```bash
# Test endpoint (solo development)
curl -X POST http://localhost:3000/api/notifications/test \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Evento",
    "body": "Questo è un test di notifica",
    "data": {
      "type": "new_event",
      "entity_id": "uuid-evento",
      "entity_type": "event"
    }
  }'
```

### Verifica Logs

Controlla i log della console del server Next.js:
```
[Event Notifications] Processing notifications for event "..." (uuid)
[Event Notifications] Found X eligible users within 20km
[Event Notifications] Push notification results: { sent: X, failed: 0 }
[Admin Events] Notification result: { sent: X, failed: 0 }
```

## Parametri Configurabili

### Raggio di Notifica

Attualmente hardcoded a **20km**. Per modificare, cambia in `event-notifications.ts`:

```typescript
const notificationResult = await notifyUsersAboutNewEvent(supabase, {
  // ... payload
}, 50) // <-- Cambia qui il raggio in km
```

### Timeout & Retry

Le notifiche vengono inviate una sola volta. Non ci sono retry automatici se Expo Push Service fallisce.

## Limitazioni

1. **Filtro Geografico:** Richiede che gli utenti abbiano `metadata.location` salvato nel profilo
2. **Fallback:** Se la query geografica fallisce, le notifiche vengono inviate a TUTTI gli utenti con push abilitato
3. **Rate Limiting:** Expo ha limiti di rate (600 notifiche/secondo). Con molti utenti potrebbe essere necessario implementare batching

## Future Enhancements

### Notifiche Reminder (TODO)
```typescript
// Cron job da eseguire ogni 15 minuti
await sendFavoriteEventReminders(supabase, 2) // 2 ore prima
```

### Filtri Personalizzati
- Notifiche solo per generi musicali preferiti
- Notifiche solo per fascia di prezzo specifica
- Opt-out per specifici tipi di eventi

### Analytics
- Tracking click-through rate
- A/B testing titoli notifiche
- Personalizzazione messaggi con AI

## Troubleshooting

### Le notifiche non arrivano

1. **Verifica push token registrato:**
   ```sql
   SELECT email, push_tokens FROM profiles WHERE id = 'user-uuid';
   ```

2. **Verifica push_enabled:**
   ```sql
   SELECT email, metadata->>'push_enabled' FROM profiles WHERE id = 'user-uuid';
   ```

3. **Verifica permessi app mobile:**
   - iOS: Settings > Nexo > Notifications
   - Android: Settings > Apps > Nexo > Notifications

4. **Controlla logs Expo:**
   - Vai su https://expo.dev/accounts/[username]/projects/nexo/push-notifications
   - Verifica eventuali errori di delivery

5. **Verifica formato token:**
   ```
   ✅ Corretto: ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]
   ❌ Errato: solo "xxxxxx" senza prefisso
   ```

### Errori Comuni

**"No users with push tokens found"**
- Nessun utente ha registrato push token
- Soluzione: Apri la mobile app e fai login

**"Failed to fetch place coordinates"**
- Il place_id dell'evento non esiste o manca lat/lon
- Soluzione: Verifica che il locale abbia coordinate valide

**"Database query failed"**
- Funzione RPC non esiste o ha errori
- Soluzione: Riesegui la migration `add_event_notification_geolocation_function`

## Sicurezza

- Le notifiche vengono inviate solo per eventi `is_published=true` e `is_listed=true`
- Gli utenti possono disabilitare le push notifications dalle impostazioni profilo
- I push tokens sono criptati e salvati in modo sicuro
- Solo admin possono inviare notifiche manuali via `/api/notifications/send`

