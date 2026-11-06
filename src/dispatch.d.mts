export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number;
export function rankCandidates<T extends { distanceKm: number; ratingAvg: number; userId: string }>(candidates: T[]): T[];
export function offerSlots(input: { urgency: string; existingOffers: number; openOffers: number; maxOffers?: number }): number;
export function shouldFlag(input: { existingOffers: number; openOffers: number; remainingCandidates: number; maxOffers?: number }): boolean;
