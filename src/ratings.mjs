export const UNRATED_RANKING_SCORE = 4;
export const RATING_EDIT_SECONDS = 24 * 60 * 60;
export const RATING_LINK_SECONDS = 14 * 24 * 60 * 60;

// A technician with no ratings sorts as 4 out of 5. Distance is still first,
// so a nearer person is chosen. The stored average stays 0 until a rating exists.
export function rankingScore(avg, count) {
  const ratings = Number(count);
  if (!Number.isFinite(ratings) || ratings <= 0) return UNRATED_RANKING_SCORE;
  const score = Number(avg);
  return Number.isFinite(score) ? score : UNRATED_RANKING_SCORE;
}

export function canEditRating(createdAt, now) {
  if (createdAt == null || !Number.isFinite(Number(createdAt))) return false;
  const age = now - Number(createdAt);
  return age >= 0 && age <= RATING_EDIT_SECONDS;
}

export function isLowRating(score) {
  return score === 1 || score === 2;
}

export function ratingInviteDue({ completedAt, now, delayHours, hour, alreadySent, alreadyRated }) {
  if (alreadySent || alreadyRated || completedAt == null) return false;
  if (hour < 8 || hour >= 19) return false;
  return now - completedAt >= delayHours * 3600;
}
