'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ArrowLeft, Check, Loader2 } from 'lucide-react';

interface ReservationGuest {
  id: string;
  guest_id: string;
  status: string;
  checked_in_at?: string;
  invited_at: string;
  profile?: {
    id: string;
    display_name: string;
    avatar_url?: string;
  };
}

interface Reservation {
  id: string;
  owner_id: string;
  qr_code_token: string;
  status: string;
  total_guests: number;
  checked_in_at?: string;
  created_at: string;
  owner: {
    id: string;
    display_name: string;
    avatar_url?: string;
    email: string;
  };
  guests: ReservationGuest[];
}

export default function ReservationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const eventId = params.id as string;
  const reservationId = params.reservationId as string;
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadReservation();
  }, [reservationId]);

  const loadReservation = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(
        `/api/reservations/${reservationId}`
      );

      if (!response.ok) {
        throw new Error('Impossibile caricare la prenotazione');
      }

      const data = await response.json();
      setReservation(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Errore durante il caricamento'
      );
      console.error('Load reservation error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCheckIn = async (guestIds?: string[]) => {
    try {
      setIsCheckingIn(true);

      const response = await fetch(
        `/api/reservations/${reservationId}/checkin`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            guest_ids: guestIds || [],
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Impossibile effettuare il check-in');
      }

      const data = await response.json();
      setReservation(data);
    } catch (err) {
      alert(
        err instanceof Error ? err.message : 'Errore durante il check-in'
      );
    } finally {
      setIsCheckingIn(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error || !reservation) {
    return (
      <div className="space-y-4">
        <Link href={`/manager/events/${eventId}/reservations`}>
          <Button variant="ghost" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Torna alle prenotazioni
          </Button>
        </Link>
        <div className="text-center py-8 text-red-600">
          {error || 'Prenotazione non trovata'}
        </div>
      </div>
    );
  }

  const statusBadgeColor = (status: string) => {
    switch (status) {
      case 'confirmed':
        return 'bg-blue-100 text-blue-800';
      case 'checked_in':
        return 'bg-green-100 text-green-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case 'confirmed':
        return 'Confermata';
      case 'checked_in':
        return 'Registrata';
      case 'cancelled':
        return 'Cancellata';
      default:
        return status;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={`/manager/events/${eventId}/reservations`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">Dettagli Prenotazione</h1>
          <p className="text-gray-500">
            Prenotante: {reservation.owner.display_name}
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-gray-500 text-sm mb-1">Persone</p>
              <p className="text-3xl font-bold">
                {reservation.total_guests}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-gray-500 text-sm mb-1">Stato</p>
              <Badge className={statusBadgeColor(reservation.status)}>
                {statusLabel(reservation.status)}
              </Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-gray-500 text-sm mb-1">
                Data Prenotazione
              </p>
              <p className="font-semibold">
                {new Date(reservation.created_at).toLocaleDateString(
                  'it-IT'
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Prenotante Info */}
      <Card>
        <CardHeader>
          <CardTitle>Prenotante</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            {reservation.owner.avatar_url && (
              <img
                src={reservation.owner.avatar_url}
                alt={reservation.owner.display_name}
                className="w-12 h-12 rounded-full"
              />
            )}
            <div>
              <p className="font-semibold">
                {reservation.owner.display_name}
              </p>
              <p className="text-gray-500">{reservation.owner.email}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Check-in Button */}
      {reservation.status !== 'checked_in' && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button className="gap-2 w-full" size="lg">
              <Check className="h-4 w-4" />
              Registra Check-in
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>Conferma Check-in</AlertDialogTitle>
            <AlertDialogDescription>
              Sei sicuro di voler registrare il check-in per{' '}
              {reservation.total_guests} persone?
            </AlertDialogDescription>
            <div className="flex gap-3">
              <AlertDialogCancel>Annulla</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => handleCheckIn()}
                disabled={isCheckingIn}
              >
                {isCheckingIn ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Registrando...
                  </>
                ) : (
                  'Conferma'
                )}
              </AlertDialogAction>
            </div>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* Guests Table */}
      <Card>
        <CardHeader>
          <CardTitle>Ospiti ({reservation.guests.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {reservation.guests.length === 0 ? (
            <p className="text-center text-gray-500 py-4">
              Nessun ospite aggiunto
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Stato</TableHead>
                    <TableHead>Data Invito</TableHead>
                    <TableHead>Check-in</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reservation.guests.map((guest) => (
                    <TableRow key={guest.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {guest.profile?.avatar_url && (
                            <img
                              src={guest.profile.avatar_url}
                              alt={guest.profile.display_name}
                              className="w-8 h-8 rounded-full"
                            />
                          )}
                          <span>
                            {guest.profile?.display_name || 'Sconosciuto'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={
                            guest.status === 'confirmed'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-green-100 text-green-800'
                          }
                        >
                          {guest.status === 'confirmed'
                            ? 'Confermato'
                            : 'Registrato'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {new Date(guest.invited_at).toLocaleDateString(
                          'it-IT'
                        )}
                      </TableCell>
                      <TableCell>
                        {guest.status === 'checked_in' ? (
                          <div className="flex items-center gap-2 text-green-600">
                            <Check className="h-4 w-4" />
                            {new Date(
                              guest.checked_in_at || ''
                            ).toLocaleDateString('it-IT')}
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleCheckIn([guest.guest_id])}
                            disabled={isCheckingIn}
                          >
                            Registra
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
