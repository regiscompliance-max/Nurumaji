export const UNRATED_RANKING_SCORE: number;
export const RATING_EDIT_SECONDS: number;
export const RATING_LINK_SECONDS: number;
export function rankingScore(avg: number | null, count: number | null): number;
export function canEditRating(createdAt: number | null, now: number): boolean;
export function isLowRating(score: number): boolean;
export function ratingInviteDue(input: {
  completedAt: number | null;
  now: number;
  delayHours: number;
  hour: number;
  alreadySent: boolean;
  alreadyRated: boolean;
}): boolean;
