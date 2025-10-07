# Test Notifiche Push - Guida Rapida 🧪

## Test Appena Eseguito

### Evento Creato
- **ID:** `58f9b12f-db29-4312-934b-37ce821205e2`
- **Titolo:** Live Jazz Night - Test
- **Locale:** Vineria dei Chiacchieroni (Palermo)
- **Data:** 15 Ottobre 2025, ore 21:00
- **Status:** Pubblicato ✅

### Utenti Target
- **Totale utenti con push token:** 1
- **Email:** vincibusa@gmail.com
- **Platform:** iOS
- **Push Token:** `ExponentPushToken[ShuseUFs3_mdIaPZdS3oBb]`

### Cosa Verificare

1. **Logs Server (admin):**
   ```
   Controlla il terminale dove sta girando npm run dev in /admin
   
   Dovresti vedere:
   [Event Notifications] Processing notifications for event "Live Jazz Night - Test"
   [Event Notifications] Found 1 eligible users within 20km
   [Event Notifications] Push notification results: { sent: 1, failed: 0 }
   [Admin Events] Notification result: { sent: 1, failed: 0 }
   ```

2. **Notifica Mobile App:**
   - Apri l'app mobile sul tuo iPhone
   - La notifica dovrebbe apparire come banner/alert
   - **Titolo:** 🎉 Live Jazz Night - Test
   - **Corpo:** 15 ott • Vineria dei Chiacchieroni
   - Tap sulla notifica → Dovrebbe aprire l'evento

3. **Se la notifica NON arriva:**
   ```bash
   # Verifica che l'app abbia i permessi
   # iPhone: Impostazioni > Nexo > Notifiche > Abilitate
   
   # Verifica che push_enabled sia true
   SELECT metadata->>'push_enabled' FROM profiles 
   WHERE email = 'vincibusa@gmail.com';
   
   # Verifica token valido
   SELECT push_tokens FROM profiles 
   WHERE email = 'vincibusa@gmail.com';
   ```

## Test Successivi

### Test 1: Creare evento NON pubblicato (non dovrebbe inviare notifiche)
```bash
curl -X POST http://localhost:3000/api/admin/events \
  -H "Content-Type: application/json" \
  -H "Cookie: [il tuo cookie]" \
  -d '{
    "title": "Evento Non Pubblicato",
    "place_id": "2a0e8646-7fb3-4603-b81a-c65772a2abe5",
    "event_type": "concert",
    "start_datetime": "2025-10-20T20:00:00Z",
    "end_datetime": "2025-10-20T23:00:00Z",
    "is_published": false
  }'
```
**Risultato atteso:** NO notifiche inviate (logs dovrebbero mostrare skip)

### Test 2: Pubblicare evento esistente (dovrebbe inviare notifiche)
```bash
# Prima crea evento non pubblicato, poi aggiornalo:
curl -X PATCH http://localhost:3000/api/admin/events/[ID_EVENTO] \
  -H "Content-Type: application/json" \
  -H "Cookie: [il tuo cookie]" \
  -d '{ "is_published": true }'
```
**Risultato atteso:** Notifiche inviate quando passa da false → true

### Test 3: Multiple Devices
Se hai più dispositivi (iPhone + Android):
1. Login con stesso account su entrambi
2. Registra push token su entrambi
3. Crea nuovo evento
4. Verifica che arrivino notifiche su TUTTI i dispositivi

## Debug Notifiche Expo

Puoi verificare lo stato delle notifiche su:
https://expo.dev/accounts/[tuo-username]/projects/nexo-mobile/push-notifications

Qui vedi:
- Notifiche inviate
- Delivery status (delivered/failed)
- Errori se presenti

## Comandi Utili

```bash
# Verifica utenti con push
SELECT email, 
  array_length(push_tokens, 1) as num_tokens,
  metadata->>'push_enabled' as enabled
FROM profiles 
WHERE push_tokens IS NOT NULL;

# Test funzione RPC geografica
SELECT * FROM get_users_for_event_notification(
  38.1161::double precision,  -- lat Palermo
  13.3603::double precision,  -- lon Palermo
  20.0::double precision      -- 20km radius
);

# Verifica eventi pubblicati oggi
SELECT id, title, is_published, created_at 
FROM events 
WHERE created_at > CURRENT_DATE 
ORDER BY created_at DESC;
```

## Risultati Attesi

✅ **Success Case:**
- Evento creato con `is_published=true`
- Logs mostrano "Processing notifications..."
- Logs mostrano "Found 1 eligible users"
- Logs mostrano "sent: 1, failed: 0"
- Notifica arriva su mobile app entro 5 secondi
- Tap notifica apre schermata evento

❌ **Fallback Case (utente senza location):**
- Se l'utente non ha `metadata.location` salvato
- La funzione RPC usa fallback: invia a TUTTI gli utenti con push_enabled
- Questo è OK per ora (feature futuro: salvare ultima posizione utente)

