'use client';

import { FormEvent, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';

interface Event {
  id: string;
  title: string;
  start_datetime: string;
  place?: {
    id: string;
    name: string;
    city: string;
  };
}

export default function NewRecommendationPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [selectedEventId, setSelectedEventId] = useState<string>('');

  const [formData, setFormData] = useState({
    entityId: '',
    featuredDate: '',
    priority: '0',
  });

  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    try {
      setLoadingEvents(true);
      const response = await fetch('/api/admin/events?limit=100&dateFilter=upcoming');
      if (response.ok) {
        const data = await response.json();
        setEvents(data.events || []);
      } else {
        setError('Errore nel caricamento degli eventi');
      }
    } catch (err) {
      console.error('Error fetching events:', err);
      setError('Errore nel caricamento degli eventi');
    } finally {
      setLoadingEvents(false);
    }
  };

  const handleEventChange = (eventId: string) => {
    setSelectedEventId(eventId);
    const selectedEvent = events.find((e) => e.id === eventId);
    if (selectedEvent) {
      // Estrai la data da start_datetime (timestamptz) e convertila in formato YYYY-MM-DD
      const eventDate = new Date(selectedEvent.start_datetime).toISOString().split('T')[0];
      setFormData({
        ...formData,
        entityId: selectedEvent.id,
        featuredDate: eventDate,
      });
    }
  };

  const formatEventDisplay = (event: Event) => {
    const date = new Date(event.start_datetime);
    const formattedDate = date.toLocaleDateString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const placeInfo = event.place ? ` - ${event.place.name}` : '';
    return `${event.title} - ${formattedDate}${placeInfo}`;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.entityId.trim()) {
      setError('Seleziona un evento');
      return;
    }

    if (!formData.featuredDate) {
      setError('Data consigliato richiesta');
      return;
    }

    try {
      setIsSubmitting(true);

      const response = await fetch('/api/admin/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityId: formData.entityId,
          featuredDate: formData.featuredDate,
          priority: parseInt(formData.priority) || 0,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Errore nella creazione del consigliato');
      }

      router.push('/admin/recommendations');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore nella creazione del consigliato');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/admin/recommendations">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">Nuovo Consigliato</h1>
          <p className="text-gray-500 mt-1">Aggiungi un consigliato manuale</p>
        </div>
      </div>

      {/* Form */}
      <Card>
        <CardHeader>
          <CardTitle>Dettagli Consigliato</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Event Selection */}
            <div>
              <label className="text-sm font-medium mb-2 block">Evento *</label>
              {loadingEvents ? (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Caricamento eventi...
                </div>
              ) : events.length === 0 ? (
                <div className="text-sm text-gray-500">
                  Nessun evento disponibile
                </div>
              ) : (
                <Select
                  value={selectedEventId}
                  onValueChange={handleEventChange}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleziona un evento" />
                  </SelectTrigger>
                  <SelectContent>
                    {events.map((event) => (
                      <SelectItem key={event.id} value={event.id}>
                        {formatEventDisplay(event)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <p className="text-xs text-gray-500 mt-1">
                Seleziona l'evento da consigliare
              </p>
            </div>

            {/* Featured Date - Read Only */}
            <div>
              <label className="text-sm font-medium mb-2 block">Data Consigliato *</label>
              <Input
                type="date"
                value={formData.featuredDate}
                readOnly
                className="bg-gray-50 cursor-not-allowed"
              />
              <p className="text-xs text-gray-500 mt-1">
                Auto-popolata dalla data dell'evento selezionato
              </p>
            </div>

            {/* Priority */}
            <div>
              <label className="text-sm font-medium mb-2 block">Priorità</label>
              <Input
                type="number"
                min="0"
                max="100"
                placeholder="0"
                value={formData.priority}
                onChange={(e) =>
                  setFormData({ ...formData, priority: e.target.value })
                }
              />
              <p className="text-xs text-gray-500 mt-1">
                Numeri più alti appariranno prima
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={isSubmitting}
                className="gap-2"
              >
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {isSubmitting ? 'Creazione...' : 'Crea Consigliato'}
              </Button>
              <Link href="/admin/recommendations">
                <Button variant="outline">Annulla</Button>
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
