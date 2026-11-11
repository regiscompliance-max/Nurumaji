const LABELS = {
  insulationMohm: "Insulation resistance, MΩ",
  zsOhm: "Earth loop impedance Zs, Ω",
  rcdMs: "RCD trip time, ms",
  polarity: "Polarity",
  pressureBar: "Pressure test, bar",
  durationMin: "Duration, minutes",
  leakCheck: "Leak check",
};

export function jobReference(id) {
  return String(id).replace(/-/g, "").slice(0, 8).toUpperCase();
}

export function returnVisitDescription(readings, notes) {
  const lines = Object.entries(readings || {}).map(([key, value]) => `${LABELS[key] || key}: ${value}`);
  let text = "Follow-up visit.\n\nReadings recorded by the technician:";
  text += lines.length ? `\n${lines.join("\n")}` : "";
  const note = String(notes || "").trim();
  if (note) text += `\n\nNotes: ${note}`;
  return text;
}

// The original technician is offered first only when they are already eligible.
export function preferOriginalTechnician(ranked, originalUserId) {
  if (!originalUserId) return ranked;
  const index = ranked.findIndex((row) => row.userId === originalUserId);
  if (index <= 0) return ranked;
  return [ranked[index], ...ranked.slice(0, index), ...ranked.slice(index + 1)];
}
