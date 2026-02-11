/**
 * Distance calculation utilities
 * Shared functions for distance-based operations
 */

/**
 * Calculate distance between two geographic points using Haversine formula
 * @param lat1 Latitude of first point
 * @param lon1 Longitude of first point
 * @param lat2 Latitude of second point
 * @param lon2 Longitude of second point
 * @returns Distance in kilometers
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Convert degrees to radians
 */
function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Format distance for UI display
 * @param distanceKm Distance in kilometers
 * @returns Formatted string (e.g., "2.5 km", "< 1 km")
 */
export function formatDistance(distanceKm: number): string {
  if (distanceKm < 1) {
    return '< 1 km';
  }
  return `${distanceKm.toFixed(1)} km`;
}

/**
 * Check if user is within booking radius
 * @param userLat User's latitude
 * @param userLon User's longitude
 * @param venueLat Venue's latitude
 * @param venueLon Venue's longitude
 * @param maxRadiusKm Maximum booking radius in kilometers
 * @returns Object with boolean result and calculated distance
 */
export function isWithinBookingRadius(
  userLat: number,
  userLon: number,
  venueLat: number,
  venueLon: number,
  maxRadiusKm: number
): { isWithin: boolean; distanceKm: number } {
  const distance = calculateDistance(userLat, userLon, venueLat, venueLon);
  return {
    isWithin: distance <= maxRadiusKm,
    distanceKm: parseFloat(distance.toFixed(2)),
  };
}
