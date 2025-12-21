'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { Scanner } from '@yudiel/react-qr-scanner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ArrowLeft, Check, X, Loader2, Video, Keyboard } from 'lucide-react';

interface ScannedReservation {
  id: string;
  owner_id: string;
  qr_code_token: string;
  status: string;
  total_guests: number;
  checked_in_at?: string;
  event?: {
    id: string;
    title: string;
  };
  owner?: {
    id: string;
    display_name: string;
    avatar_url?: string;
  };
  guests: Array<{
    id: string;
    guest_id: string;
    status: string;
    profile?: {
      display_name: string;
    };
  }>;
}

export default function ScannerPage() {
  const params = useParams();
  const router = useRouter();
  const eventId = params.id as string;
  const manualInputRef = useRef<HTMLInputElement>(null);
  const [manualToken, setManualToken] = useState('');
  const [scannedHistory, setScannedHistory] = useState<ScannedReservation[]>(
    []
  );
  const [currentReservation, setCurrentReservation] =
    useState<ScannedReservation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCheckInDialog, setShowCheckInDialog] = useState(false);
  const [useScannerMode, setUseScannerMode] = useState(true);

  const handleQRCodeScanned = async (token: string) => {
    await processQRCode(token);
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (manualToken.trim()) {
      await processQRCode(manualToken.trim());
      setManualToken('');
      manualInputRef.current?.focus();
    }
  };

  const processQRCode = async (qrToken: string) => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch('/api/reservations/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ qr_code_token: qrToken }),
      });

      if (!response.ok) {
        setError('QR code non valido');
        return;
      }

      const data = await response.json();
      setCurrentReservation(data);
      setShowCheckInDialog(true);

      // Add to history
      setScannedHistory((prev) => {
        const existing = prev.findIndex((r) => r.id === data.id);
        if (existing >= 0) {
          prev.splice(existing, 1);
        }
        return [data, ...prev.slice(0, 9)];
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Errore durante la scansione'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmCheckIn = async () => {
    if (!currentReservation) return;

    try {
      setIsLoading(true);

      const response = await fetch(
        `/api/reservations/${currentReservation.id}/checkin`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ guest_ids: [] }),
        }
      );

      if (!response.ok) {
        throw new Error('Impossibile effettuare il check-in');
      }

      const data = await response.json();
      setCurrentReservation(data);

      // Update history
      setScannedHistory((prev) =>
        prev.map((r) => (r.id === data.id ? data : r))
      );

      setShowCheckInDialog(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Errore durante il check-in'
      );
    } finally {
      setIsLoading(false);
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
          <h1 className="text-3xl font-bold">Scanner QR Code</h1>
          <p className="text-gray-500">
            Scansiona i QR code delle prenotazioni per il check-in
          </p>
        </div>
      </div>

      {/* Mode Toggle */}
      <div className="flex gap-2">
        <Button
          variant={useScannerMode ? 'default' : 'outline'}
          className="gap-2"
          onClick={() => setUseScannerMode(true)}
        >
          <Video className="h-4 w-4" />
          Scansione Webcam
        </Button>
        <Button
          variant={!useScannerMode ? 'default' : 'outline'}
          className="gap-2"
          onClick={() => setUseScannerMode(false)}
        >
          <Keyboard className="h-4 w-4" />
          Inserimento Manuale
        </Button>
      </div>

      {/* QR Scanner */}
      {useScannerMode && (
        <Card>
          <CardHeader>
            <CardTitle>Scanner QR Code</CardTitle>
            <p className="text-sm text-gray-500 mt-1">
              Consenti l'accesso alla webcam per scannerizzare i QR code
            </p>
          </CardHeader>
          <CardContent>
            <div className="w-full max-w-md mx-auto">
              <Scanner
                onDecode={(result) => {
                  const text = result.getText();
                  if (text) {
                    handleQRCodeScanned(text);
                  }
                }}
                onError={(error) => {
                  console.error('QR Scanner error:', error);
                }}
                components={{
                  tracker: true,
                }}
                styles={{
                  container: {
                    width: '100%',
                    maxWidth: '100%',
                  },
                }}
              />
            </div>
            {error && <p className="text-red-600 text-sm mt-4 text-center">{error}</p>}
          </CardContent>
        </Card>
      )}

      {/* Manual Input */}
      {!useScannerMode && (
        <Card>
          <CardHeader>
            <CardTitle>Inserimento Manuale</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleManualSubmit} className="flex gap-2">
              <Input
                ref={manualInputRef}
                type="text"
                placeholder="Inserisci il token QR o incolla da scanner..."
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                autoFocus
              />
              <Button type="submit" disabled={isLoading || !manualToken.trim()}>
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Verifica'
                )}
              </Button>
            </form>
            {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
          </CardContent>
        </Card>
      )}

      {/* Current Scan Result */}
      {currentReservation && !showCheckInDialog && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-lg font-semibold">
                  {currentReservation.owner?.display_name}
                </p>
                <p className="text-sm text-gray-600">
                  {currentReservation.total_guests} persone
                </p>
                {currentReservation.status === 'checked_in' && (
                  <div className="flex items-center gap-2 mt-2 text-green-600">
                    <Check className="h-4 w-4" />
                    <span className="text-sm font-medium">Già registrato</span>
                  </div>
                )}
              </div>
              <Badge
                className={
                  currentReservation.status === 'checked_in'
                    ? 'bg-green-100 text-green-800'
                    : 'bg-blue-100 text-blue-800'
                }
              >
                {currentReservation.status === 'checked_in'
                  ? 'Registrato'
                  : 'Confermato'}
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Scans */}
      {scannedHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Scansioni Recenti</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {scannedHistory.map((reservation) => (
                <div
                  key={reservation.id}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50"
                >
                  <div>
                    <p className="font-medium">
                      {reservation.owner?.display_name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {reservation.total_guests} persone
                    </p>
                  </div>
                  {reservation.status === 'checked_in' ? (
                    <div className="flex items-center gap-2 text-green-600">
                      <Check className="h-4 w-4" />
                      <span className="text-sm">Registrato</span>
                    </div>
                  ) : (
                    <Badge variant="secondary">Confermato</Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Check-in Dialog */}
      <AlertDialog open={showCheckInDialog}>
        <AlertDialogContent>
          <AlertDialogTitle>Conferma Check-in</AlertDialogTitle>
          <AlertDialogDescription>
            <div className="space-y-3">
              <div>
                <p className="font-semibold text-foreground">
                  {currentReservation?.owner?.display_name}
                </p>
                <p className="text-sm text-gray-600">
                  Persone: {currentReservation?.total_guests}
                </p>
              </div>
              {currentReservation?.status === 'checked_in' && (
                <div className="p-3 bg-green-50 border border-green-200 rounded text-sm text-green-800">
                  ✓ Questa prenotazione è già stata registrata
                </div>
              )}
            </div>
          </AlertDialogDescription>
          <div className="flex gap-3">
            <AlertDialogCancel
              onClick={() => {
                setShowCheckInDialog(false);
                setCurrentReservation(null);
                setError(null);
                manualInputRef.current?.focus();
              }}
            >
              Chiudi
            </AlertDialogCancel>
            {currentReservation?.status !== 'checked_in' && (
              <AlertDialogAction
                onClick={handleConfirmCheckIn}
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Registrando...
                  </>
                ) : (
                  'Conferma Check-in'
                )}
              </AlertDialogAction>
            )}
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
