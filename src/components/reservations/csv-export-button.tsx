'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { exportReservationsToCSV } from '@/lib/utils/csv-export';
import { Download, Loader2 } from 'lucide-react';

interface CSVExportButtonProps {
  eventId: string;
  eventTitle: string;
  disabled?: boolean;
}

export function CSVExportButton({
  eventId,
  eventTitle,
  disabled = false,
}: CSVExportButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    try {
      setIsLoading(true);
      setError(null);
      await exportReservationsToCSV(eventId, eventTitle);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Export failed';
      setError(errorMessage);
      console.error('Export error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        onClick={handleExport}
        disabled={isLoading || disabled}
        variant="outline"
        size="sm"
        className="gap-2"
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Esportazione...
          </>
        ) : (
          <>
            <Download className="h-4 w-4" />
            Esporta CSV
          </>
        )}
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
