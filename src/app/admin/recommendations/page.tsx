'use client';

import { useEffect, useState } from 'react';
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
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Calendar, Plus, Trash2, Loader2 } from 'lucide-react';
import Link from 'next/link';

interface Recommendation {
  id: string;
  entity_type: 'place' | 'event';
  entity_id: string;
  featured_date: string;
  source: 'automatic' | 'admin';
  priority: number;
  reason: string | null;
  created_at: string;
}

export default function RecommendationsPage() {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [filterSource, setFilterSource] = useState<'all' | 'automatic' | 'admin'>('all');
  const [filterType, setFilterType] = useState<'all' | 'place' | 'event'>('all');

  useEffect(() => {
    loadRecommendations();
  }, [selectedDate, filterSource, filterType]);

  const loadRecommendations = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const params = new URLSearchParams();
      params.set('startDate', selectedDate);
      params.set('endDate', selectedDate);
      if (filterSource !== 'all') params.set('source', filterSource);
      if (filterType !== 'all') params.set('entityType', filterType);

      const response = await fetch(`/api/admin/recommendations?${params}`);

      if (!response.ok) {
        throw new Error('Failed to load recommendations');
      }

      const data = await response.json();
      setRecommendations(data.recommendations || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error loading recommendations');
      setRecommendations([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Eliminare questo consigliato?')) return;

    try {
      const response = await fetch(`/api/admin/recommendations/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete recommendation');
      }

      setRecommendations(recommendations.filter((r) => r.id !== id));
    } catch (err) {
      console.error('Delete error:', err);
      alert('Errore durante l\'eliminazione');
    }
  };

  const sourceLabel = (source: string) => {
    return source === 'admin' ? 'Manuale' : 'Automatico';
  };

  const sourceBadge = (source: string) => {
    return source === 'admin'
      ? 'bg-amber-100 text-amber-800'
      : 'bg-green-100 text-green-800';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Consigliati del Giorno</h1>
          <p className="text-gray-500 mt-1">
            Gestisci i consigliati automatici e manuali
          </p>
        </div>
        <Link href="/admin/recommendations/new">
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            Aggiungi Consigliato
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Data</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Tipo</label>
              <Select value={filterType} onValueChange={(value: any) => setFilterType(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti</SelectItem>
                  <SelectItem value="place">Locali</SelectItem>
                  <SelectItem value="event">Eventi</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Fonte</label>
              <Select value={filterSource} onValueChange={(value: any) => setFilterSource(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti</SelectItem>
                  <SelectItem value="automatic">Automatici</SelectItem>
                  <SelectItem value="admin">Manuali</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recommendations Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            Consigliati ({recommendations.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center items-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          ) : error ? (
            <div className="text-center py-8 text-red-600">{error}</div>
          ) : recommendations.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              Nessun consigliato per questa data
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>ID Entità</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Fonte</TableHead>
                    <TableHead>Priorità</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead>Azioni</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recommendations.map((rec) => (
                    <TableRow key={rec.id}>
                      <TableCell>
                        <Badge variant="outline">
                          {rec.entity_type === 'place' ? '📍 Locale' : '🎉 Evento'}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {rec.entity_id.substring(0, 8)}...
                      </TableCell>
                      <TableCell>
                        {new Date(rec.featured_date).toLocaleDateString('it-IT')}
                      </TableCell>
                      <TableCell>
                        <Badge className={sourceBadge(rec.source)}>
                          {sourceLabel(rec.source)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {rec.priority > 0 ? (
                          <Badge variant="default">{rec.priority}</Badge>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{rec.reason || '-'}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(rec.id)}
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cron Job Info */}
      <Card className="bg-blue-50 border-blue-200">
        <CardHeader>
          <CardTitle className="text-blue-900">Automazione Giornaliera</CardTitle>
        </CardHeader>
        <CardContent className="text-blue-800">
          <p className="text-sm">
            I consigliati vengono generati automaticamente ogni giorno alle 00:05 basandosi su metriche di engagement (suggerimenti, preferiti, interesse). Puoi aggiungere consigliati manuali che verranno preservati.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
