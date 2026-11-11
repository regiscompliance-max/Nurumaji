export const STUCK_DEFAULTS = {
  awaitingMinutes: 30,
  notStartedHours: 4,
  inProgressHours: 8,
  sms: false,
};

const REASONS = {
  awaiting_acceptance: "No technician accepted",
  not_started: "Accepted, not started",
  in_progress: "In progress a long time",
};

function wholeNumber(value) {
  const text = String(value ?? "").trim();
  if (!/^[0-9]+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseStuckSettings(input) {
  const awaitingMinutes = wholeNumber(input.awaitingMinutes);
  const notStartedHours = wholeNumber(input.notStartedHours);
  const inProgressHours = wholeNumber(input.inProgressHours);
  if (awaitingMinutes == null || awaitingMinutes < 1 || awaitingMinutes > 1440) {
    return { error: "Waiting time must be a whole number of minutes from 1 to 1440." };
  }
  if (notStartedHours == null || notStartedHours < 1 || notStartedHours > 72) {
    return { error: "Not-started time must be a whole number of hours from 1 to 72." };
  }
  if (inProgressHours == null || inProgressHours < 1 || inProgressHours > 168) {
    return { error: "In-progress time must be a whole number of hours from 1 to 168." };
  }
  const sms = input.sms === true || input.sms === "1" || input.sms === "on";
  return { awaitingMinutes, notStartedHours, inProgressHours, sms };
}

export function thresholdsFromSettings(values) {
  const parsed = parseStuckSettings({
    awaitingMinutes: values.stuck_awaiting_minutes ?? String(STUCK_DEFAULTS.awaitingMinutes),
    notStartedHours: values.stuck_not_started_hours ?? String(STUCK_DEFAULTS.notStartedHours),
    inProgressHours: values.stuck_in_progress_hours ?? String(STUCK_DEFAULTS.inProgressHours),
    sms: values.stuck_alert_sms === "1",
  });
  if (parsed.error) return { ...STUCK_DEFAULTS };
  return parsed;
}

// One reason per job. Flagged jobs with nobody assigned use the same waiting rule.
export function classifyStuck(job, thresholds, now) {
  const assigned = Boolean(job.assignedTechId);
  if ((job.status === "new" || job.status === "offered") && !assigned) {
    const ageSeconds = now - job.createdAt;
    if (ageSeconds >= thresholds.awaitingMinutes * 60) {
      return { reason: "awaiting_acceptance", ageSeconds, anchorAt: job.createdAt };
    }
    return null;
  }
  if (job.status === "assigned") {
    const anchorAt = job.assignedAt ?? job.updatedAt ?? job.createdAt;
    const ageSeconds = now - anchorAt;
    if (ageSeconds >= thresholds.notStartedHours * 3600) {
      return { reason: "not_started", ageSeconds, anchorAt };
    }
    return null;
  }
  if (job.status === "en_route" || job.status === "on_site") {
    const anchorAt = job.startedAt ?? job.updatedAt ?? job.createdAt;
    const ageSeconds = now - anchorAt;
    if (ageSeconds >= thresholds.inProgressHours * 3600) {
      return { reason: "in_progress", ageSeconds, anchorAt };
    }
    return null;
  }
  return null;
}

export function isNewEpisode(openAlerts, jobId, reason) {
  return !openAlerts.some((row) => row.jobId === jobId && row.reason === reason && row.resolvedAt == null);
}

export function reasonLabel(reason) {
  return REASONS[reason] || "Needs a look";
}

export function formatAge(seconds) {
  const mins = Math.max(0, Math.floor(seconds / 60));
  if (mins < 90) return mins === 1 ? "1 min" : `${mins} min`;
  const hours = Math.floor(mins / 60);
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

export function stuckAlertSms(items) {
  const count = items.length;
  const head = `Nuru & Maji: ${count} stuck job${count === 1 ? "" : "s"}.`;
  const lines = items.slice(0, 4).map((item) => {
    const place = item.area ? `${String(item.area).slice(0, 40)} ` : "";
    return `${place}${item.trade} · ${reasonLabel(item.reason)} · ${formatAge(item.ageSeconds)}.`;
  });
  const more = count > 4 ? ` ${count - 4} more on the board.` : "";
  return `${head} ${lines.join(" ")}${more}`.slice(0, 320);
}
