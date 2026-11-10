// Pure dispatch rules from the portal spec. No database access.

const LIVE_POSITION_SECONDS = 30 * 60;

// A fresh shared position is used for distance. Otherwise the saved base is used.
export function positionForDispatch({ baseLat, baseLng, liveLat, liveLng, liveUpdatedAt, now, freshSeconds = LIVE_POSITION_SECONDS }) {
  const fresh = Number.isFinite(liveLat) && Number.isFinite(liveLng) && Number.isFinite(liveUpdatedAt)
    && now >= liveUpdatedAt && now - liveUpdatedAt <= freshSeconds;
  if (fresh) return { lat: liveLat, lng: liveLng, live: true };
  if (Number.isFinite(baseLat) && Number.isFinite(baseLng)) return { lat: baseLat, lng: baseLng, live: false };
  return null;
}

export function haversineKm(lat1, lng1, lat2, lng2) {
  const radius = 6371;
  const rad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function rankCandidates(candidates) {
  return [...candidates].sort((a, b) => {
    if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
    if (a.ratingAvg !== b.ratingAvg) return b.ratingAvg - a.ratingAvg;
    return String(a.userId).localeCompare(String(b.userId));
  });
}

// Standard and urgent jobs are offered to one technician at a time.
// Emergency jobs are offered to the top three at once.
// Nobody is offered the same job more than once, and the total stops at 3.
export function offerSlots({ urgency, existingOffers, openOffers, maxOffers = 3 }) {
  const room = Math.max(0, maxOffers - existingOffers);
  if (room === 0) return 0;
  if (urgency === "emergency") return Math.max(0, Math.min(3, room) - openOffers);
  if (openOffers > 0) return 0;
  return Math.min(1, room);
}

export function shouldFlag({ existingOffers, openOffers, remainingCandidates, maxOffers = 3 }) {
  if (openOffers > 0) return false;
  if (existingOffers >= maxOffers) return true;
  return remainingCandidates === 0;
}
