'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, QrCode, Check, X } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { CSVExportButton } from '@/components/reservations/csv-export-button';

interface Reservation {
  id: string;
  owner_id: string;
  qr_code_token: string;
  status: string;
  total_guests: number;
  checked_in_at?: string;
  created_at: string;
  event?: {
    id: string;
    title: string;
  };
  owner: {
    id: string;
    display_name: string;
    avatar_url?: string;
    email: string;
  };
  guests: Array<{
    id: string;
    guest_id: string;
    status: string;
    profile?: {
      id: string;
      display_name: string;
      avatar_url?: string;
    };
  }>;
}

export default function ReservationsPage() {
  const params = useParams();
  const eventId = params.id as string;
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [error, setError] = useState<string | null>(null);
  const [eventTitle, setEventTitle] = useState<string>('Prenotazioni');

  useEffect(() => {
    loadReservations();
  }, [eventId, filterStatus]);

  const loadReservations = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const url = new URL(
        `/api/events/${eventId}/reservations`,
        window.location.origin
      );

      if (filterStatus !== 'all') {
        url.searchParams.set('status', filterStatus);
      }

      const response = await fetch(url.toString());

      if (!response.ok) {
        throw new Error('Impossibile caricare le prenotazioni');
      }

      const data = await response.json();
      setReservations(data.reservations || []);

      // Extract event title from first reservation if available
      if (data.reservations && data.reservations.length > 0 && data.reservations[0].event) {
        setEventTitle(data.reservations[0].event.title);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Errore durante il caricamento'
      );
      console.error('Load reservations error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredReservations = reservations.filter((r) =>
    r.owner.display_name
      .toLowerCase()
      .includes(searchQuery.toLowerCase()) ||
    r.owner.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
        <Link href={`/manager/events/${eventId}`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">Prenotazioni Lista Nominativa</h1>
          <p className="text-gray-500">
            Gestisci le prenotazioni e il check-in degli ospiti
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-between items-center gap-4">
        <div className="flex gap-4">
          <Link href={`/manager/events/${eventId}/scanner`}>
            <Button className="gap-2">
              <QrCode className="h-4 w-4" />
              Apri Scanner QR
            </Button>
          </Link>
        </div>
        <CSVExportButton eventId={eventId} eventTitle={eventTitle} />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <Input
              placeholder="Cerca per nome o email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1"
            />
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Stato" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti gli stati</SelectItem>
                <SelectItem value="confirmed">Confermata</SelectItem>
                <SelectItem value="checked_in">Registrata</SelectItem>
                <SelectItem value="cancelled">Cancellata</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Reservations Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            Prenotazioni ({filteredReservations.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center items-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          ) : error ? (
            <div className="text-center py-8 text-red-600">{error}</div>
          ) : filteredReservations.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              Nessuna prenotazione trovata
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Prenotante</TableHead>
                    <TableHead>Ospiti</TableHead>
                    <TableHead>Stato</TableHead>
                    <TableHead>Registrato</TableHead>
                    <TableHead>Data prenotazione</TableHead>
                    <TableHead>Azioni</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredReservations.map((reservation) => (
                    <TableRow key={reservation.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {reservation.owner.display_name}
                          </span>
                          <span className="text-xs text-gray-500">
                            {reservation.owner.email}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>{reservation.total_guests}</TableCell>
                      <TableCell>
                        <Badge className={statusBadgeColor(reservation.status)}>
                          {statusLabel(reservation.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {reservation.status === 'checked_in' ? (
                          <div className="flex items-center gap-2 text-green-600">
                            <Check className="h-4 w-4" />
                            {new Date(
                              reservation.checked_in_at || ''
                            ).toLocaleDateString('it-IT')}
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {new Date(reservation.created_at).toLocaleDateString(
                          'it-IT'
                        )}
                      </TableCell>
                      <TableCell>
                        <Link href={`/manager/events/${eventId}/reservations/${reservation.id}`}>
                          <Button variant="ghost" size="sm">
                            Dettagli
                          </Button>
                        </Link>
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
