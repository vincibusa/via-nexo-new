/**
 * CSV Export Utilities
 * Provides functions for exporting reservations and event data to CSV format
 */

export async function exportReservationsToCSV(
  eventId: string,
  eventTitle: string
): Promise<void> {
  try {
    const response = await fetch(
      `/api/reservations/export/csv?event_id=${eventId}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'text/csv',
        },
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to export CSV');
    }

    // Get the CSV content
    const csvContent = await response.text();

    // Create a blob from the CSV content
    const blob = new Blob([csvContent], { type: 'text/csv; charset=utf-8' });

    // Create download link
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.href = url;
    link.download = `prenotazioni-${eventTitle.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.csv`;

    // Trigger download
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Clean up
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('CSV export error:', error);
    throw error;
  }
}

export function formatCSVValue(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);

  // Escape quotes and wrap in quotes if contains special characters
  if (
    stringValue.includes(',') ||
    stringValue.includes('"') ||
    stringValue.includes('\n')
  ) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}
